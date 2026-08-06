---
title: 生成执行生命周期完整修复计划
description: 以交付语义划分同步流与可恢复异步执行，补齐执行尝试、供应商操作、媒体 Blob 与领域交付边界。
status: in_progress
---

## 1. 背景与目标

当前图片、视频已经具备 `GenerationRun`、lease/epoch fencing、Worker callback、
Coordinator 与 Artifact-first 交付的基础链路。该链路解决了部分本地重复投递和终态竞争，
但尚未形成完整的异步执行平台：文本存在 SSE 同步流与后台 polling 两种交付语义；
Provider 的远端状态尚未被完整建模；对象存储也仍是数据库事务中的外部副作用。

当前文档对 SSE 存在两种历史模型：真实架构中的请求内短流不创建 `GenerationTask`，
而统一编排方案曾提出 hidden durable run。本计划不默认选其中之一；P0 必须先以 ADR
确定各文本入口的断线、重启、取消与重连承诺，之后才允许实现迁移。

本计划的目标不是把所有任务塞进 `GenerationRun`，而是建立以下稳定边界：

```text
Task（用户意图、取消、稳定结果）
  ├─ inline：短事务同步命令
  ├─ streaming：SSE 连接内文本流
  └─ durable_async：ExecutionAttempt
       ├─ ProviderOperation：远端 create / poll / cancel
       └─ DeliveryHandler：按操作完成领域交付
            ├─ 图片 / 视频：Artifact → MediaBlob → CAS Publisher
            ├─ 文本 polling：消息 / 结果投影
            └─ 脚本：版本化领域命令 / CAS
```

## 2. 核心不变量

- `Task` 是用户可见的请求、取消意图与稳定结果真相，不是每次执行的并发控制实体。
- 仅 `durable_async` 任务拥有 `ExecutionAttempt`；一个 Task 同时最多一个有效 lease。
- callback 必须携带 `attempt_id + lease_epoch`；旧 epoch 不读取领域目标，也不产生副作用。
- Task 的最终状态只能由统一 Coordinator 条件写入；Worker 不直接写 Task 终态或领域投影。
- 图片/视频 Artifact 只表示逻辑生成结果；物理字节必须由独立 Blob 状态与存储操作管理。
- SSE 是传输方式而非默认后台任务：仅连接内流式交付时不承诺恢复；需要重连、任务中心或跨进程恢复时，必须转为 durable async。
- 取消意图、本地终态、远端取消请求和远端实际停止必须分别记录，不能互相冒充。
- 不假设任何 Provider 都支持统一幂等 header、按 client key 查询或远端取消。

## 3. 当前基线

以下已落地，作为后续迁移的约束而非重做目标：

- 图片/视频 `GenerationRun`、Artifact Run 归属、lease heartbeat、epoch fencing。
- 图片/视频 `Executor → Worker → Coordinator` 主链与 callback 唯一终态收口。
- cancel API 只记录 intent；图片/视频由 Coordinator 决定最终 cancelled/succeeded/failed。
- Run 级 dispatch、稳定 Celery work id、reaper 持久化重投递事件。
- 已持久化 `provider_task_id` 的图片/视频恢复轮询。
- `generation_delivery` API、OpenAPI client 与图片/视频前端消费。

已知限制：Provider create 结果不确定时不能安全重发；Blob 保留期与孤儿扫描策略尚未落地；
脚本后台任务仍使用旧终态写入路径。

## 4. 交付策略分类（先于任何迁移）

| 策略 | 适用范围 | 是否有 Attempt | 恢复承诺 | 示例 |
| --- | --- | --- | --- | --- |
| `inline` | 本地短事务、幂等查询 | 否 | 无 | 即时校验、元数据更新 |
| `streaming` | SSE 连接内文本输出 | 默认否 | 仅当前连接 | 即时文本聊天 |
| `durable_async` | 后台、可轮询、可取消、可恢复执行 | 是 | lease/reaper/fencing | 图片、视频、后台文本、脚本 |

SSE 若需要断线续传、后台继续或可靠最终落库，必须在提交时选择 `durable_async`；
此时 SSE 仅订阅 hidden Attempt 的事件流，默认不进入任务中心。纯 streaming 不得承诺
重启恢复。单一路由不得按 body 动态切换 JSON、SSE 和任务响应，避免客户端契约不稳定。

## 5. 阶段计划

### P0：架构冻结与安全护栏

目标：在继续扩展功能前固定边界，阻止两套终态语义继续扩散。

- [x] 新增 ADR：确定 `Task / ExecutionAttempt / ProviderOperation / DeliveryHandler / MediaBlob` 职责。
- [x] 为每个 `task_kind` 标注 execution policy（inline / streaming / durable_async）。
- [x] 对所有 SSE 入口明确选择“请求内短流”或“hidden durable stream”，并定义断线、
  重启、重连、取消和事件保留语义；协调现有架构文档与统一编排计划的历史冲突。
- [x] 建立 Provider capability matrix：同步/异步、任务 ID、幂等 create、按 key 查询、poll、cancel、结果保留期。
- [x] 为已迁移图片/视频 Worker 增加架构测试，禁止直接调用 TaskStore 终态方法、
  ArtifactStore 或领域 Delivery；文本/脚本旧 Worker 在 P4 单独迁移。
- [x] 将当前图片/视频 `GenerationRun` 视作未来通用 Attempt 的兼容实现，禁止新增媒体专属字段。

验收：ADR、能力矩阵和任务分类均进入文档；新增任务必须显式选择 policy；架构测试能拒绝新增直接终态写入。

### P1：通用 ExecutionAttempt 与终态协调接口

目标：统一 durable async 的执行控制面，不把 Artifact 假设扩散到文本和脚本。

- [x] 定义中立 `ExecutionAttempt` 契约与模型别名；当前物理存储仍为
  `generation_runs`，避免破坏 Artifact/dispatch 外键和历史迁移。
- [x] 提供 `ExecutionAttemptRepository` facade，复用既有 claim、heartbeat、reaper
  与 fencing 条件更新；新 durable 代码可逐步依赖中立名称。
- [x] 定义 `TaskExecutionDriver` 命令/输出协议与 `AttemptTerminalCoordinator` fencing
  壳；媒体 Coordinator 暂作为兼容适配器保留。
- [x] 将既有图片/视频 `GenerationWorkerCommand → execute_worker_command` 封装为
  `MediaTaskExecutionDriver`；继续复用生成基类的 create/poll 标准能力与媒体
  Coordinator 的 Artifact 交付，不复制 Provider 实现。
- [x] 定义 `DeliveryHandler` 协议：成功/失败/取消交付只返回稳定 Task.result，
  不拥有 lease 或 Task 终态写权限；`AttemptTerminalCoordinator` 已在首个文本迁移中
  原子收口 Attempt、领域投影与 Task 终态。
- [x] 保持 `GenerationRun` 数据表和 API 兼容；通过适配层或渐进迁移引入通用 Attempt，禁止大爆炸重命名。
- [x] 将 Task 的 `executor_task_id` 明确降级为“最近一次诊断信息”，不再作为执行真相。

验收：重复 Celery delivery 只能取得一个 Attempt lease；旧 callback 零副作用；任意 DeliveryHandler 均不能绕过 Coordinator 写 Task 终态。

### P2：ProviderOperation 状态机与能力化恢复

目标：将外部 Provider 副作用从普通函数调用提升为可恢复状态机。

- [x] 新增 `ProviderOperation` expand 模型与迁移：冻结非敏感 provider identity、模型/路由、请求摘要 hash、远端 ID、状态、能力版本、下一次 poll、错误分类与审计字段；旧 `GenerationRun` checkpoint 暂保留 dual-read 兼容。
- [x] 定义状态：`not_started`、`create_uncertain`、`accepted`、`polling`、`succeeded_remote`、`failed_remote`、`cancel_requested_remote`、`cancelled_remote`、`unknown`；单次 poll 只写 ProviderOperation，不能绕过 Coordinator 终态化 Task。
- [x] 定义统一 adapter 契约：`start_or_recover`、`poll`、`request_cancel`，并让 capability 显式驱动分支；未注册的具体 Provider adapter 一律安全拒绝，不猜测 URL 或 create 恢复方式。
- [x] durable 媒体提交期要求 Provider 同时具备远端句柄、按句柄 poll 与按句柄重取结果能力；同步图片 Provider 在 P3 receipt-to-bytes 交付前明确拒绝，不创建不可恢复任务。
- [ ] 先迁移具备稳定远端 ID 和 poll 的异步视频/图片 Provider；恢复时只 poll 已 accepted 的 operation。
- [ ] 对支持可验证 idempotency key 或 client-key lookup 的 Provider，实现 create 不确定后的恢复查询。
- [ ] 对不支持上述能力的 Provider，`create_uncertain` 必须进入可见诊断/人工处理队列，禁止 reaper 盲目重发 create。
- [ ] Provider 配置冻结非敏感身份（provider、endpoint route、model deployment、capability version）；凭据通过可轮换的 secret reference 在执行时解析。
- [ ] 引入远端取消协作：本地 cancel intent 触发 capability-aware 的 cancel request；unsupported/unknown 必须单独可见。

验收：create 成功后崩溃、poll 中崩溃、远端失败、远端取消 unsupported、create uncertain 均有确定状态和操作路径；不会因恢复创建第二个已知远端任务。

### P3：媒体 Blob 与存储操作可靠性

目标：从 Coordinator 的数据库事务中移除下载、上传、删除等长时间外部 I/O。

- [x] 新增 `MediaBlob` / `StorageObject`：稳定 key、content type、size、checksum/ETag、状态、保留期、删除墓碑与审计。
- [x] 新增 `StorageOperationOutbox`：materialize、verify、delete，包含 attempts、lease、error、not-before 与幂等键。
- [x] 定义 receipt-backed 的物化来源协议：outbox 仅保存 `provider_operation_id`；Provider URL、令牌、原始响应和未注册 Provider 均不得进入可重试存储链路。
- [x] 由 Coordinator 只创建“物化意图”；独立 Worker 按 receipt 重取 Provider 结果、上传、HEAD 校验，并在全部 Blob 就绪后绑定 Blob、FileItem、Artifact。
- [x] 使用 `attempt_id + ordinal` 生成稳定对象 key，避免重试产生无限随机对象。
- [x] 将删除改为逻辑墓碑 + 删除 outbox；删除前执行引用校验，成功后才标记物理删除。
- [ ] 定义 Blob 引用与保留策略：已发布、冲突未采用、取消/失败、输入快照、项目删除的不同保留期。
- [ ] 对象存储扫描仅作为登记表之外的兜底修复：支持分页、宽限期、限速、审计和 dry-run。

验收：上传后 DB rollback、多个产物中途失败、commit 失败、删除失败、重复 materialize 均可恢复且不会无审计丢失或误删对象。

### P4：文本与脚本 durable async 迁移

目标：收口后台文本/脚本的重复投递、崩溃恢复与终态竞争，同时保留 SSE 同步语义。

- [x] 先迁移无复杂领域副作用的后台文本任务，使用 typed result delivery，不创建伪 Artifact。
- [x] 将 async-polling text chat 迁入 Attempt + DeliveryHandler；`ExperimentMessage` 只作为交付投影。
- [x] 保持纯 SSE 文本流为 `streaming`；断线即取消，不后台继续或跨进程重连，策略已在 ADR 固化。
- [x] 将无领域写回的 `script_consistency`、`script_variant`、`script_merge` 迁入 Attempt + Driver + DeliveryHandler；结果仅写入稳定 Task.result。
- [ ] 最后迁移 divide/extract/merge 等领域写入任务；先为章节、候选与合并结果补 expected version / CAS / operation idempotency key。
- [x] 删除旧 `AbstractWorkerTaskExecutor` 对已迁移 `text_chat` 的 Task 终态直写；脚本 task_kind 仍在注册表台账中，待独立迁移。

验收：后台文本/脚本的重复投递、worker crash、cancel-vs-success、cancel-vs-failure 均满足 Attempt fencing；重试不会覆盖人工修订。

### P5：投递收敛、API 与前端状态呈现

目标：使用户可见状态和内部诊断一致，但不将任务中心变成业务调试页。

- [ ] 合并 task-level Outbox 与 Attempt dispatch 的职责：旧 Outbox 仅作为兼容入口，所有 durable 执行最终归入 Attempt dispatch。
- [ ] 定义稳定 API：Task 返回用户状态、进度、取消意图、结果和回跳；Attempt/Provider/Blob 诊断仅在业务诊断端点暴露。
- [ ] 统一前端状态文案：信息确认状态、runtime task status、视频准备度、远端 operation 状态不得混用。
- [ ] SSE 事件协议显式携带 sequence / resumability capability；不支持恢复的流不得宣称可续传。
- [ ] 清理图片/视频、文本/脚本的历史 payload 与 executor 兼容入口，并保留有期限的迁移读兼容。

验收：任务中心仅展示通用状态与回跳；业务界面展示 Artifact/Provider/诊断；OpenAPI、generated client、前端类型同步通过。

### P6：运维、数据迁移与发布治理

目标：让状态机在生产故障、升级和回滚中可观测、可演练。

- [ ] 为 Attempt、ProviderOperation、StorageOperation 建立指标：队列积压、lease 过期、create uncertain、poll age、物化/删除失败、孤儿候选。
- [ ] 建立结构化日志和关联 ID：task_id、attempt_id、work_id、provider_operation_id、blob_id、lease_epoch。
- [ ] 迁移采用 expand → dual-read/dual-write → backfill → cutover → contract 顺序；每一步提供 rollback 条件。
- [ ] 为历史 `GenerationRun`、Artifact、Outbox 建立回填与校验脚本；禁止无审计的批量删除。
- [ ] 增加故障演练：broker 重复/丢失、worker kill、DB rollback、S3 timeout、Provider timeout、旧 callback、人工取消。
- [ ] 发布前完成全量后端测试、OpenAPI 更新、前端 `tsc`、Alembic upgrade/downgrade 验证与灰度观察。

验收：仪表盘与告警可定位卡住的阶段；迁移可回滚；故障演练不产生重复领域交付或不可追踪的 Blob。

## 6. 推荐实施顺序与依赖

```text
P0 架构冻结
 ├─ P1 通用 ExecutionAttempt ──> P4 后台文本/脚本迁移 ──> P5 投递/API 收敛
 ├─ P2 ProviderOperation ──────> P3 Blob/存储操作 ────────> P6 运维治理
 └─ P6 的迁移/观测设计应在 P1/P2/P3 设计时同步准备
```

- P1 与 P2 可以并行设计，但 P4 必须依赖 P1。
- P3 可以在 P2 已定义远端结果 receipt 后实施；不要等待所有 Provider 支持幂等 create。
- P5 只能在至少一个文本/脚本 durable task 成功迁移后切换公共语义。
- P6 不是最后才考虑：每个新状态表上线时都要有指标、迁移与回滚方案。

## 7. 明确不做的事项

- 不把所有文本都迁入 durable async；连接内 SSE 默认保持 streaming。
- 不把文本/脚本结果伪造成媒体 Artifact。
- 不为所有 Provider 猜测同一个幂等 HTTP header。
- 不在 `provider_task_id` 缺失时盲目重试远端 create。
- 不通过单个 GC cron 解决存储一致性。
- 不在任务中心展示 Provider prompt、图文映射或完整诊断上下文。

## 8. 总体验收矩阵

| 场景 | 预期 |
| --- | --- |
| 重复 delivery | 只有一个有效 Attempt 获得 lease；领域交付一次 |
| 旧 callback | 不改变 Task、Artifact、消息、Blob 或业务槽位 |
| create uncertain | 进入可见状态，不盲目重复创建 |
| 已 accepted Provider 重启 | 只 poll 原远端任务 |
| Provider 不支持取消 | 本地取消可完成，远端状态标记 unsupported/unknown |
| 上传后 DB rollback | Blob 可经补偿记录回收，不形成无审计孤儿 |
| 删除存储失败 | 数据库不误称已物理删除；删除操作可重试 |
| SSE 断线 | 行为符合 policy；仅 streaming 不承诺恢复 |
| 脚本重试 | CAS/版本保护人工编辑，领域写入不重复 |
| 灰度回滚 | 新旧路径可并存、可观测、可恢复 |
