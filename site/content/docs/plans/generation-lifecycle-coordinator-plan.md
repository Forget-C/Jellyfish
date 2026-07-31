---
title: 生成生命周期协调器重构计划
description: 将生成执行、取消、重试和终态交付收口到 GenerationRun、Executor 与 Coordinator。
status: in_progress
---

## 目标架构

```text
Submitter → GenerationTask + Outbox → GenerationExecutor → GenerationRun
→ GenerationWorker → WorkerCallback → GenerationLifecycleCoordinator
→ ArtifactStore + WorkflowHandler + GenerationTask
```

`GenerationTask` 是用户任务与最终结果真相；`GenerationRun` 是一次执行尝试、lease 与 epoch 真相；
`GenerationRunDispatch` 以 Celery work id 连接投递与实际领取。
Executor 是领取、取消、重试和续租唯一拥有者；Worker 只执行 Provider；Coordinator 是唯一归档、领域交付和
终态写入口；Handler 仅表达实验室、资产和分镜的业务差异。

## 不变量

- 一个 Task 同时最多一个未过期有效 Run。
- callback 必须携带 `run_id + lease_epoch`；旧 epoch 零副作用。
- Cancel API 只记录取消意图，不能直接决定终态。
- 成功、失败、取消只由 Coordinator 条件写入一次。
- Artifact 是产物真相，Task.result 是稳定投影，TaskLink 只负责导航。
- 实验室仅投影 ExperimentMessage；槽位目标才调用 CAS Publisher。

## 阶段任务

### L0：语义冻结

- [x] 固化 Task / Artifact / Link / Outbox / Handler 职责。
- [x] 识别 Worker、Finalizer、取消 API 的旧直写入口。
- [x] 建立旧入口删除台账，禁止新增直写调用。

#### 旧入口删除台账

| 入口 | 当前原因 | 收口目标 | 删除阶段 |
| --- | --- | --- | --- |
| `api/v1/routes/film/task_status.py:cancel_task` | API 仍会撤销并直写取消状态/实验室消息 | 仅登记 cancel intent 并向 Executor 发信号 | L3 |
| `services/worker/async_task_support.py:cancel_if_requested_async` | 兼容未解析快照的历史任务 | 仅由 Coordinator 投影取消终态 | L3/L4 |
| `services/studio/image_task_runner.py` | 图片 Runner 仍归档并 Finalize | Worker 只返回 callback | L4 |
| `services/film/generated_video.py` | 视频 Runner 仍归档并 Finalize | Worker 只返回 callback | L4 |
| `services/worker/task_executor.py` | 历史通用执行器仍直写 Task 取消 | 生命周期任务改由 Executor/Coordinator 处理 | L3/L5 |

新增生成代码不得直接调用 TaskStore 的 `complete_success`、`complete_failure`、
`mark_cancelled` 或更新业务投影；这些写入在迁移后仅允许通过 Coordinator。

### L1：Run 数据与契约

- [x] `GenerationRunStatus`、Worker callback 契约。
- [x] `GenerationRun` ORM、expand migration、queued/claim Repository 骨架。
- [x] attempt 并发、claim、epoch、heartbeat、callback fencing 测试。
- [x] Artifact 的 `generation_run_id` FK、回填和唯一约束迁移。

### L2：Executor 与 Coordinator

- [x] Executor 创建/claim Run、heartbeat、调度 Worker、接收取消。
- [x] Coordinator 校验 Run epoch，归档、调用 Handler、写 Run/Task 终态。
- [x] 将 TaskFinalizer 收为 Coordinator 内部组件。

#### L2 当前切片

- [x] `GenerationExecutor` 领取 Run 并生成携带 `run_id + lease_epoch` 的
  `GenerationWorkerCommand`；重复投递不生成第二条命令。
- [x] `GenerationLifecycleCoordinator` 仅接受当前 epoch 的 callback，并通过内部
  `TaskFinalizer` 写入 Handler、Task 与 Run 终态；旧 epoch 与重复 callback 零副作用。
- [x] 成功 callback 遇到已登记的取消意图时收口为 cancelled，禁止成功投影。
- [x] Celery 已执行 `WorkerCommand → Provider → callback` 主链；图片/视频 Worker
  的结果归档与取消终态均由 Coordinator 收口。

### L3：终态竞争统一裁决

- [ ] Cancel API 改为 cancel intent + signal。
- [ ] 成功/失败/取消 callback 仅由 Coordinator 收口。
- [ ] 删除 Worker 与 API 的 Task 状态直写。

#### L3 当前切片

- [x] 取消 API 仅登记 intent，不再 revoke Celery、`mark_cancelled` 或直写
  `ExperimentMessage`。
- [x] 已登记 intent 的未执行任务仍创建并领取 Run，直接生成 cancelled callback；
  运行中任务等待 callback，由 Coordinator 统一裁决。
- [ ] 历史文本/脚本执行器仍含各自的 Task 直写；它们不属于图片/视频生命周期迁移
  范围，后续需独立收口。

### L4：图片与视频迁移

- [x] Image/Video Worker 仅输入 WorkerCommand、输出 callback。
- [x] Coordinator 复用 ArtifactStore、WorkflowHandler、CAS Publisher。
- [x] 删除图片/视频 Runner 中 TaskStore、commit、取消与领域写回。

#### L4 当前切片

- [x] `task.execute` 对图片/视频分流到 `GenerationExecutor → WorkerCommand →
  GenerationLifecycleCoordinator`，不再经 `TaskExecutorRegistry` 的旧 async
  delegating executor。
- [x] 图片/视频 Worker 仅调用 Provider 并返回内存 callback/result；Coordinator
  以 `generation_run_id + ordinal` 归档 Artifact，再调用 WorkflowHandler/Publisher。
- [x] 历史 `run_image_generation_task` / `run_video_generation_task` 及仅覆盖其
  TaskStore/commit/取消直写行为的专项测试已删除；Worker 仅保留 Provider helper。

### L5：可靠恢复

- [x] stale-run reaper、lease renewal、epoch fencing、本地 Provider 幂等键。
- [ ] Outbox dispatch/run 追踪、重试策略、对象存储补偿与可观测性。

#### L5 当前切片

- [x] Worker 独立 heartbeat 续租；Beat 每 30 秒回收 `claimed/executing` 的过期
  Run，提升 epoch、重新排队并投递对应 Task。
- [x] 新 Run 创建稳定的本地 `provider_idempotency_key`，跨 epoch 接管保持不变；
  尚未将该字段发送给供应商 HTTP API。
- [x] 每次 Celery 投递以 `GenerationRunDispatch.work_id` 记录来源；成功领取后绑定
  `task_id + run_id + lease_epoch`，重复消息标记为 ignored，便于追踪 outbox/reaper
  重投递。
- [x] reaper 在回收 Run 的同一事务创建 `pending` dispatch；提交后由独立 dispatcher
  用预分配的稳定 `work_id` 发布，broker 失败保留事件、累计 attempts 后重试，避免
  “Run 已恢复但进程在直接投递前退出”造成的消息丢失。
- [x] 支持具备稳定供应商任务 ID 的图片/视频适配器将 `create → provider_task_id`
  与 `poll(provider_task_id)` 分离；创建成功后以 Run fencing 条件立即持久化 ID，
  reaper 恢复时只轮询该 ID，不重复创建远端任务。
- [ ] Provider create/poll 分离、已受理任务恢复、对象存储补偿与指标仍待实现。当前
  OpenAI 图片等同步接口没有可恢复的任务 ID；“供应商已受理但本地尚未写入 ID”的
  窗口也不能在缺少可验证供应商幂等键时盲目重试 create。对象存储补偿与指标仍待实现；
  投递事件仍是至少一次语义，broker 成功但发布状态尚未来得及确认的窗口由固定 work
  id、Run 条件领取与 callback fencing 兜底。

### L6：API 与清理

- [x] 任务结果 API 增加强类型 `generation_delivery`，保留旧 result 兼容。
- [x] 同步 OpenAPI、generated client、前端消费。
- [x] 删除图片/视频旧 payload、relation_type 写回及兼容入口。

#### L6 当前切片

- [x] 图片/视频任务的 `/result` 只在已持久化 result 可校验为
  `GenerationDeliveryResult` 时返回 `generation_delivery`；普通任务与历史形状
  不匹配结果继续返回 null 并保留原 result。
- [x] 已运行 OpenAPI 生成；实验室图片/视频轮询优先读取
  `generation_delivery`，回退兼容历史 result。
- [x] 删除未调用的图片/视频旧 Runner 包装及其基于 `relation_type` 的直接 Artifact、
  任务关联、资产槽位写回；`relation_type` 仍保留为提交期可信目标关联和任务中心导航
  语义，通用任务的 `result` 兼容字段也不在本次删除范围内。

## 验收矩阵

- 重复投递：一次有效 Run、一次 Provider、一次领域交付。
- 取消先到：不发布领域结果。
- 成功先提交：取消幂等返回成功。
- 失败与取消竞争：唯一终态为 cancelled。
- 旧 callback：不改变 Task、Artifact、消息或槽位。
- CAS 冲突：Artifact 保留，Task succeeded，交付状态 conflicted。
- 实验室图片/视频：只更新消息投影，不触发 CAS。
