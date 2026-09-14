---
title: "任务与文件表结构简化方案"
description: "将任务执行、远端跟踪和媒体历史相关的 11 张表收敛为四张核心表，去掉重复状态与恢复模型。"
status: completed
date: 2026-09-11
---

## 结论与范围

建议采用 **tasks、task_inputs、task_outputs、files** 四张核心表。

初始评估检查了 ORM、提交/领取/轮询/交付代码、文件上传删除、文件使用关系和实验室消息投影；随后按目标结构实施，并在隔离 MySQL、对象存储与浏览器环境验证。未检查或升级实际开发及线上数据库。

改造前范围内共有 11 张直接相关表：任务、任务关联、Run、RunDispatch、ProviderOperation、生成 outbox、Artifact、任务媒体引用、Blob、存储 outbox、File。目标减少为四张，不把项目、业务槽位、供应商配置、file_usages、会话和消息等必要业务表计入删减数字。

用户已授权按本方案落地。实施不考虑旧表名、旧字段、旧 API 或历史数据转换的兼容成本；新模型仍然必须保证后续形成的任务历史可查。新增迁移已在隔离 MySQL 执行验证；Vidu 图片与视频真实生成验证已执行，本地开发库已升级；生产环境未部署。

执行语义固定如下：

- 异步供应商成功返回必须有任务 ID。没有 ID 或缺必要数据，任务直接失败，不引入 unknown 状态、恢复对账或自动重新提交。
- 有 ID 的异步图片/视频继续查询，服务重启后也查询同一 ID，并收取产物。
- 文本和同步返回内容的图片没有本地执行恢复；中断后失败，重新提交创建新 Task。
- 本地失败不等于远端必然未受理或已经停止；错误说明准确记录本地失败原因即可，不增加另一套恢复机制。

## 落地进度与验证边界

工作区实现与验证已完成，本地开发库已升级；生产环境未部署。后文旧实现分析是改造依据，当前实现以任务执行架构文档为准。

已落地：

- 四表 ORM、TaskService 唯一生命周期维护口，以及轻量任务查询、结果查询、历史游标与取消接口。任务关联、Run/Attempt、ProviderOperation、Blob、Outbox、旧 TaskManager 和 Celery 执行模块已移除。
- 图片、视频和脚本提交保存一次参数快照，媒体文件使用 task_inputs 记录分组与顺序；供应商路由和模型名冻结，凭据不进入快照。
- 独立异步 Worker 复用 HTTP 客户端，分别限制文本、提交、轮询、下载容量，并独立限制远端在途任务。同步脚本 Agent 在有界线程池内运行；取消或超时后，实际线程退出前继续占用名额，并阻止后续模型请求。单轮查询和结果收取增加总时限。远端 ID 登记后只查询同一 ID，本地执行不恢复。
- 输出使用稳定对象 key 与 task_outputs 主键，网络 I/O 不占数据库事务；所有输出保存完成后才通过 TaskService 原子交付业务结果与终态。
- 业务发布保留版本 CAS，手动采用或清空也递增版本；生成状态不写入 shot.status。候选模式只保留结果，不自动覆盖业务槽位。
- 文件上传使用独立身份；删除登记保留文件行，引用路径锁定文件并拒绝已删除内容。后台分页清理删除请求与超过一天宽限期的孤儿对象，排除已登记文件和活动任务；清理不占生成并发名额。MySQL 使用 READ COMMITTED，避免文件行锁后的引用检查沿用旧快照。
- 实验消息在读取时批量派生任务状态与结果，校验会话归属；会话活动状态直接查询 tasks，不依赖消息存在。提交与清空/删除会话使用同一会话行锁。
- 前端活动任务完整读取所有页，刷新失败保留旧快照；资产图片、关键帧和视频候选历史使用生成客户端的任务输出接口。任务中心新增独立历史窗口，按状态、类型、项目、日期筛选，服务端游标翻页；未知进度留空，已取消任务不再因取消标记排在运行任务前。列表批量解析轻量来源，前端直接回跳镜头工作室、角色、资产、项目、章节及实验室；来源删除时保留历史并隐藏回跳，不再逐条请求来源详情。媒体提交按镜头或角色归属写入项目，共享资产及实验室不猜测项目。
- 新增 `13b6a9d2e401` 收缩迁移，保留业务与文件记录，移除旧执行历史；开发初始化和 Compose 统一使用迁移链，非空未纳管库不再自动 stamp。完整迁移链已在临时 MySQL 9 执行。
- 旧执行层测试已按目标语义迁移或移除。当前架构测试检查 TaskService 外不能直接创建、批量更新或删除 Task，以及 Worker 不直接赋值任务状态。

- Worker 容量、总时限和同步线程名额审查已完成；异步提取移除无效 refresh_cache 参数，未实现的 shot_frame_prompt 类型及恒为空的运行时提示词任务标记已移除。

当前验证：

- 浏览器隔离联调通过，临时 API、前端和浏览器页已关闭。
- `JELLYFISH_TEST_STORAGE=1 pytest backend/tests/services/test_storage_integration.py -q`：1 项真实对象存储隔离联调通过，不调用生成供应商。

- `backend/.venv/bin/python -m pytest backend/tests -m 'not integration' -q`：373 项通过，4 项 MySQL/对象存储集成测试按 marker 排除；无跳过与警告。
- `cd front && pnpm exec tsc --noEmit`：通过。
- `cd front && pnpm run build`：通过；Vite 提示主包超过 500 kB，未做与任务体系无关的拆包优化。
- 应用和 Worker 导入检查、`git diff --check`、Compose 示例环境 `config --quiet`：通过。
- 本轮已运行 `pnpm run openapi:update`，同步任务来源 DTO 与生成客户端；仅使用临时接口描述服务，没有执行业务请求。
- `JELLYFISH_TEST_MYSQL_URL=... pytest backend/tests/services/test_task_mysql.py -q`：隔离 MySQL 9 中 3 项通过，验证迁移后的结构与多连接领取/终态竞争；4 个领取者仅一个成功，4 个完成请求仅一次交付。另验证文件删除会拒绝事务早先查询之后才提交的新任务引用；MySQL 运行连接改为 READ COMMITTED。未调用真实对象存储或供应商。

补充验证与审查：

- 历史窗口已完成隔离浏览器验证：跨页历史、状态/项目/日期筛选、取消与历史保留、章节回跳、断连保留旧结果及恢复刷新。修复浮层遮挡、长列表挤出翻页按钮，以及本地 env.js 覆盖 VITE_BACKEND_URL 的问题。
- 文件引用、删除和孤儿扫描已审查；结果元信息允许为空，输入 MIME 不再默认猜测 PNG/MP4，已上传输出复用也检查内容类型。隔离对象存储联调已通过：真实上传、分页、读取、删除和历史保留；随机前缀内测试对象已清理。
- 任务执行、数据库迁移、开发运行指南和中英文部署说明已同步；最终静态检查通过；Vidu 真实生成验证结果见下文。

部署边界：

- 本地开发库已从 f2a3b4c5d6e7 升级到 13b6a9d2e401，API 已恢复，单实例开发 Worker 已启动并核验存活。生产环境部署不在本次完成范围内。

2026-09-14 经用户明确允许，仅调用 Vidu，累计 **3/3** 次真实生成；未调用文本供应商。

| 请求 | 本地结果 | 验证结论 |
| --- | --- | --- |
| 图片，远端 ID 996901634812432384 | failed | 首次轮询暴露 created/queueing 未识别；修复后只查询原 ID，远端 succeeded、1 个产物。保留原失败历史。 |
| 视频，远端 ID 996901636058124288 | failed | 同一状态适配缺陷；修复后查询原 ID，远端 succeeded、1 个产物。保留原失败历史。 |
| 修复后视频，远端 ID 996902537414057984 | succeeded | 更换 Worker 后查询原 ID，无再次提交；完成 MP4 保存与 TaskOutput 登记，本地成功。文件 718028 字节，实验室交付为 skipped（保留候选）。 |

适配器补齐 Vidu created/queueing 中间态，并增加图片/视频共 4 个回归用例；后端全套 373 项通过。该批次未重跑修复后的图片完整链路，文本未做真实调用；后续图片实测见下文。该批次额度已用尽，后续请求使用用户另行授权的额度。隔离任务库保留三条历史，复制的供应商 key/secret 已清空。状态语义依据 [Vidu 官方文档](https://platform.vidu.com/docs/tasks-list)。

## 开发库升级与图片完整链路补验（2026-09-14）

用户另行授权无历史包袱迁移开发库，以及最多 3 次 Vidu 生成。本轮实际使用 **1/3 次**。

- 停止旧开发 API 后备份完整 MySQL 数据库，备份为 2880217 字节，保存在 `/private/tmp/jellyfish-dev-upgrade-20260914/before.sql`，目录与文件限制访问权限。
- 预检发现 3 组重复 key、9 条文件记录，其对象均返回 404。保留文件 ID 和业务引用，为这些记录分配独立 key；升级后明确标为已删除，没有伪造或覆盖对象内容。其他文件记录保留。
- 完成迁移 f2a3b4c5d6e7 → 13b6a9d2e401；预处理后迁移前后 33 张保留表、57 行数据摘要一致。旧执行历史表已移除，新任务表可读写。原始库完整备份保留迁移前记录。
- 在升级后的开发库，通过图片实验室 HTTP API 创建会话、提交 Vidu 图片；Worker 领取后提交一次，取得远端 ID 后更换 Worker 继续查询。
- 实际观察 created、queueing、processing、success。任务 `2d65db016f134ca4a92b638e8b754b05` 成功；远端 ID `996907941258858496`，重启未增加提交次数。
- 产物文件 `fd46090e6ebc5a318cec613ae50d96e8` 为 PNG、1882808 字节。读取对象字节后，大小、SHA-256 与数据库一致；输出关系、任务结果接口、历史列表和实验室任务消息全部验证成功。实验室候选交付为 skipped，不表示生成失败。
- 会话 `0887bce0-faeb-4f66-bcee-7196e1f3c84e` 与产物保留在开发库供查看。验证报告位于 `/private/tmp/jellyfish-image-validation-20260914/report.json`。
- 本轮后端 373 项测试通过、4 项独立集成测试排除。未修改 API 契约或前端代码。

## 改造前的不必要复杂度

### 执行数据重复

`GenerationTask`、`GenerationRun` 和 `ProviderOperation` 分别保存状态、时间、错误；远端 ID 同时存在于 Run 的 `provider_task_id`、ProviderOperation 的 `remote_id` 和 receipt。统一 Celery 入口还需要在媒体 Run 与通用 ExecutionAttempt 别名之间适配。

在“一次任务只提交一次、不恢复本地步骤”的边界下，无需独立执行尝试表。媒体任务跟踪一个远端 ID 即可；文本 handler 内部可能有多次 LLM 调用，但本次不要求每次调用单独成为持久化执行实体。

### 文件身份重复

`GenerationArtifact` 同时关联 `generation_run_id`、`blob_id`、`file_id`；媒体完成物化后，`MediaDeliveryCoordinator._bind_file_items` 再把 Blob 的 storage_key 复制到新 File。File 与 Blob 没有直接外键，关联绕经 Artifact 或 storage_key。

当前没有看到需要让多个逻辑 File 共享同一物理 Blob 的内容去重体系。现有分层主要支撑“先登记逻辑结果、后续可靠物化”的流程。改为上传完成后登记文件，单一 files 表即可维护文件身份和物理对象信息。

### 任务来源与采用结果混在一起

`generation_task_links` 同时承担来源导航、业务反查、file_id 和 accepted/todo/rejected。多产物另由 Artifact 保存，实际采用文件又在图片槽位、镜头等业务表中记录，产生多份“结果/采用状态”。

该表头注释声称业务对象有强外键，但当前 `relation_type + relation_entity_id` 实际是通用逻辑引用，只有 task_id 和 file_id 有外键。目标应明确选择逻辑来源字段，避免为这种关系再套一层表并误称有强约束。

### 可变文件引入额外校验

`files.content_version/content_hash` 被复制到 `generation_task_media_references`，执行前再做版本漂移比较。当前上传使用 `files/{原始文件名}` 作为 key，不同上传记录可能写到同一 key，单靠 DB 中的版本字段无法保证字节不变。

建议以文件内容不可变替代跨表版本比较：每次上传/替换生成新 file_id 与独立 storage_key；显示名称、标签可修改，文件字节不能覆盖。

代码依据：

- `backend/app/models/task.py`、`generation_runs.py`、`provider_operations.py`
- `backend/app/models/generation_artifacts.py`、`media_blobs.py`
- `backend/app/models/task_links.py`、`studio_prompts_files_timeline.py`
- `backend/app/services/generation/runtime/media_delivery.py`
- `backend/app/services/generation/files/resolver.py`
- `backend/app/services/studio/files.py`

## 逐表取舍

| 当前表 | 目标 | 处理理由 |
| --- | --- | --- |
| generation_tasks | 重设计为 tasks | 唯一任务状态、输入、文本结果、远端跟踪与历史 |
| generation_runs | 删除 | 不存在多次执行尝试或租约恢复 |
| generation_run_dispatches | 删除 | 无需消息投递与 Run 领取审计实体 |
| provider_operations | 合并进 tasks | 当前每个异步媒体任务跟踪一个远端任务；保留必要查询字段 |
| generation_dispatch_outbox | 删除 | tasks 的 queued 行就是待办，事务提交即入队 |
| storage_operation_outbox | 删除 | 结果收取由未完成 Task 驱动；文件删除由 files 上的删除标记驱动 |
| media_blobs | 合并进 files | 同一物理文件只维护一个身份与存储元数据 |
| generation_task_links | 删除 | 一个任务一个明确主目标；生成时交付结果与后续业务使用关系分开 |
| generation_task_media_references | 精简为 task_inputs | 保留多参考图、顺序、分组及删除保护，删除版本快照 |
| generation_artifacts | 精简为 task_outputs | 只表示媒体输出文件及生成时交付结果，不承载执行和物化状态 |
| files | 保留并补全 | 上传和生成文件共用；不可变内容、唯一 key、完整元数据 |

这些删表取舍以数据库队列和同进程结果收取方案为前提。若最终保留 Celery broker，需重新考虑数据库与 broker 的提交间隙，不能直接照搬删除 outbox 的结论。

## 四张表的目标职责与字段

```text
tasks
  ├── task_inputs  ──→ files（参考文件）
  └── task_outputs ──→ files（生成文件）

业务槽位 / file_usages ──→ files（当前使用位置）
experiment_messages ──→ tasks（关联任务，按需读取状态）
```

## 唯一真相源与唯一维护入口

**本地任务生命周期的唯一真相源是 `tasks.status`，唯一写入边界是 `TaskService`。** `stage`、progress、取消意图、错误、时间和远端查询信息同样由 TaskService 维护，不能只统一 status 而让其他模块各自更新伴随字段。

这与供应商维护远端真实生成状态不冲突：供应商回答“生成到哪一步”，Task 回答“本应用是否已经完成这次请求”。tasks.remote_status 是最近一次查询快照，附 last_polled_at；它不能直接取代本地 status。远端 succeeded 但文件尚未保存时，Task 仍为 running/stage=saving；存储失败可以使 Task failed，同时保留远端成功的观察值。

其他数据只维护自身事实：task_outputs 表示输出及生成时交付结论，files 表示文件，业务槽位表示当前采用位置；这些表不各自维护一份任务状态。前端、实验室消息、runtime summary 从 Task 派生展示，不能凭“有文件”“有远端 ID”或旧缓存反向覆盖任务状态。

### 写入边界

| 调用方 | 交给 TaskService 的操作或事实 | 不允许自行做的事 |
| --- | --- | --- |
| API / 业务提交服务 | submit、request_cancel | 直接修改 ORM 状态，自己裁决已执行任务终态 |
| 本地执行器 / 提交器 | claim、record_submission、报告成功结果或异常 | 独立写 running/succeeded/failed |
| 远端轮询器 | record_poll_result，包括远端状态、错误及下次查询信息 | 把远端成功直接写成本地 succeeded |
| 结果收取器 | 提交已保存文件引用、报告收取结果 | 先发布业务结果，再检查 Task 是否取消或结束 |
| 超时 / 重启清理 | 请求失败终结，附超时、中断或缺数据原因 | 用独立批处理 SQL 绕过状态规则 |

建议公开少量语义方法：`submit`、`claim`、`record_submission`、`record_poll_result`、`request_cancel`、`finish`；进度需要时通过受控方法更新。`finish` 根据事实、取消意图和交付结果统一决定终态。原子更新 SQL 可以是 TaskService 内部实现，不另建对业务公开的 `set_status(task_id, arbitrary_status)` 接口。

API、Worker、Poller 可以运行在不同调用上下文，使用相同 TaskService 规则；唯一维护口不意味着必须建一个全局单例进程、消息总线或额外协调服务。

### 状态与事务规则

- 提交只创建 queued；claim 原子执行 queued → running。
- queued 可因取消、排队过期或缺必要数据进入终态；running 可进入 succeeded/failed/cancelled，绝不回 queued。
- succeeded/failed/cancelled 均不可再改写；重复终结返回已结束，迟到 poll/progress 也不得修改已结束任务。
- 所有终结路径复用一个内部终结函数：先在短事务中锁定 Task、检查当前状态和取消意图，再调用领域 service 完成 DB 交付，最后写 status/result/error/finished_at。
- 领域 service 负责修改业务实体、判定版本冲突；无权改任务状态。TaskService 负责事务边界和生命周期规则，不实现各领域的业务细节。
- 需要原子可见的输出登记、领域发布和任务终态同事务提交；已提前保存的部分文件可留作历史，不能提前自动发布。
- 网络查询、下载、上传都在终结事务外完成；文件可用性和任务完成所需的输出完整性在 TaskService 终结前校验。
- 取消与成功竞争以事务内判定为准：取消先被接受则不再自动发布；成功先提交则后续取消无操作。
- 重新提交创建新 Task，不重新打开旧终态。

### 当前实现与目标的差距

当前 GenerationTask 已承担本地任务查询与状态持久化，但没有贯穿全生命周期的唯一维护入口：GenerationExecutor 直接写 running，TaskFinalizer/AttemptTerminalCoordinator 等路径分别完成终结，SqlAlchemyTaskStore 与 SyncSqlAlchemyTaskStore 都暴露状态修改方法。局部的 Coordinator 唯一回调入口不等于所有任务、所有状态的唯一写入口。

后续实施需要将创建、领取、受理记录、轮询观察、取消、超时和终态全部收口到 TaskService，并删除旧入口。验收既检查合法状态转换与终态竞争，也检查 API、Worker、Poller、清理器没有绕过 TaskService 直接写 Task 生命周期字段。

### tasks：一条提交，一条历史

| 字段组 | 字段 | 说明 |
| --- | --- | --- |
| 身份 | id、kind、title | kind 显式注册，无 generic 兜底；title 是提交时来源摘要 |
| 主目标 | target_type、target_id、expected_target_version | target_type 区分实际实体/槽位类别；version 仅适用于需要并发保护的业务目标 |
| 查询范围 | project_id | 可空；项目历史筛选；章节、父对象等导航上下文放 input_snapshot 的来源段 |
| 生命周期 | status、stage、progress | 五个主状态；stage 用于 submitting/polling/saving 等展示与调度；没有可靠进度时 progress 可空 |
| 执行策略 | execution_mode、worker_instance_id | direct 或 remote；策略在提交时固定，进程 ID 只用于本地中断识别，不是租约 |
| 输入与文本输出 | input_snapshot、result | 输入 JSON 按 kind 校验；result 保存文本/脚本结构化结果和必要 usage，媒体列表不再重复保存 |
| 供应商查询 | provider_id、provider_task_id、remote_status | provider_id 指向实际账号配置，不能只保存 provider 名称；远端状态仅为最近观察值 |
| 调度 | next_poll_at、last_polled_at、deadline_at | 到期查询与收取；deadline 在不同阶段表示明确的等待/执行/跟踪期限 |
| 取消 | cancel_requested_at、cancel_reason | 是否请求取消由时间是否为空推导 |
| 错误 | error_code、error_message、last_poll_error | 终态错误与暂时轮询错误分开，暂时错误不改变主状态 |
| 时间 | created_at、updated_at、started_at、finished_at | 统一 UTC；耗时查询时计算 |
| 重试关联 | retry_of_task_id | 可空；新建任务关联旧任务，不修改旧历史 |

输入快照仅保存一份有效输入：最终提示词、参数、模板/模型身份、来源上下文和提交使用的非敏感供应商路由。主目标与文件排列由结构化列/关联行提供，执行时组合成命令；不再重复保存 command、snapshot、run_args 三份可重建数据，也不保存 task_class。

Provider 的密钥继续在现有配置表中管理。input_snapshot 冻结实际使用的非敏感路由身份，后续按同一 provider_id 的账号凭据查询，不能换用当前默认供应商。尚有远端任务时禁止删除或更换该配置的账号/路由；同一账号的密钥轮换允许。纯同步本地任务不要求 provider_task_id。

`target_type` 必须包含具体类型，例如 character_image_slot 与 scene_image_slot 不能只写成相同的 asset_image_slot：不同表的数字槽位 ID 可能相同。目标存在性和父对象归属由提交 service 校验。这里明确采用逻辑引用，业务对象删除不会级联删除任务历史，title/来源快照仍能解释任务来源。

当前 API 允许给 Task 追加通用多目标 link；目标方案主动移除这一通用能力。一次提交只有一个主目标，产物后续用于多个对象走业务关系/file_usages；剧本提取产生多个实体属于结果，不意味着提交有多个主目标。若以后确实需要一份任务多目标自动发布，应单独定义该产品需求，不提前保留泛化多对多表。

本次不增加用户、租户、全局事件、worker 实体或账号表。现有系统没有用户领域，不能仅为任务规划空的 owner_id 体系。

可直接去掉的字段：`mode`、`visibility`、`executor_type`、`executor_task_id`、`lease_*`、`heartbeat_at`、`cancel_requested` 布尔值、`cancelled_at`、attempt 序号、callback payload、派发次数及 create_uncertain 字段。SSE 不建 Task；cancelled 的结束时间就是 finished_at。

`execution_mode` 与旧 `mode` 不同：前者区别一次请求执行与远端任务查询；后者是给前端的 streaming/async_polling 交付方式，目标异步 Task 不需要存后一维。

### task_inputs：只保存参考文件关系

字段为 `task_id、role_path、ordinal、file_id`。

- 主键 `(task_id, role_path, ordinal)`，file_id 外键指向 files。
- role_path 表示 references、first_frame、subjects.character_a 等实际输入位置，ordinal 表示组内顺序；同一 file 可在多个位置使用。
- 索引 `(file_id, task_id)` 支持判断是否被未完成任务引用，以及文件来源反查。
- 文件排列只在这里保存，input_snapshot 不再复制另一份媒体 ID 树。创建 Task 和输入行处于同一事务。
- 删除 media_kind、file_content_version、file_content_hash：类型和哈希从不可变 files 读取，文件替换必定换 ID。

保留这张表有实际价值。若把所有 file_id 放进 JSON，文件删除保护和反向引用查询就要扫描 JSON，复杂度只是转移到了代码与查询中。

### task_outputs：只保存生成文件与交付记录

字段为 `task_id、ordinal、file_id、delivery_status、delivery_reason`。

- 主键 `(task_id, ordinal)` 保证同一媒体结果只登记一次；file_id 非空外键，另建 file_id 索引。
- file_id 是文件身份；任务输出的身份是 `(task_id, ordinal)`，无需再增加独立 Artifact UUID。
- 只在完整文件已上传后写入，不保存 pending Blob 或半成品物化状态。批量图片逐个成功保存可逐个登记，整组完整且交付结束才标记 Task succeeded；最终失败时已经保存的部分输出仍可查。
- delivery_status 表示本次生成时自动交付的结论：published、conflicted、skipped；delivery_reason 记录版本冲突、候选等待采用等原因。尚未执行交付时两者可空。
- 后续手动采用或替换图片修改业务槽位，不把这份历史结论改成“当前采用状态”。当前采用情况由业务引用判断。
- 去掉 generation_run_id、blob_id、modality、text_content、provider_result。媒体类型在 files，文本/脚本结果在 tasks.result；必要供应商诊断放 Task，临时 URL 不落库。

不把 task_outputs 直接合入 files：上传文件没有生成来源，同一文件还能被多处使用；生成顺序和交付记录属于任务关系，名称、标签和存储信息属于文件。两张窄表比一张混合大量可空执行字段的文件表更清晰。

### files：唯一文件身份，内容不可变

| 字段组 | 字段 | 说明 |
| --- | --- | --- |
| 身份与展示 | id、type、name、tags | name/tag 可改，type 随内容固定 |
| 对象位置 | storage_key、thumbnail_key | storage_key 非空、区分大小写且唯一；缩略图可空；URL 查询时生成 |
| 内容属性 | content_type、size_bytes、content_hash、width、height、duration_ms | MIME 与字节数一次记录，尺寸/时长按类型可空；hash 可空且不作内容去重约束 |
| 删除 | delete_requested_at、deleted_at | 区分删除意图与物理对象已经删除，均可空；不另建删除任务表 |
| 时间 | created_at、updated_at | 元信息更新不代表文件内容变化 |

size_bytes 使用足够容纳大视频的 BIGINT，ID、枚举和 key 长度有明确上限，时间统一 UTC。存储 key 使用应用控制的有界格式，不再以用户文件名作为物理身份。当前是统一对象存储配置，不预建多存储 backend 抽象。

上传：先分配 file_id，用该 ID 生成唯一 key；新内容必须新 ID。生成：用 task_id + ordinal 生成稳定 key，重复收取先检查对象完整性，并在 DB 中唯一登记文件和输出。完整文件不覆盖；不完整临时上传仅在落库前清理或重做。

文件只有完整可用后才登记，因此不需要 Blob 的 pending/materializing/materialized 状态。删除 content_version、materialized_at、verified_at、独立 Blob 错误状态和保留期状态机；content_hash 可用于完整性验证，不能把 S3 ETag 当作通用内容哈希。

## 必须保留的业务关系

- `file_usages`：保留文件在项目中的多处使用/来源关系，不与任务输入输出合并。它服务文件库按项目检索，不表示生成成功或采用状态。
- 图片槽位、关键帧、镜头视频引用：保留 file_id 与业务 version_id。文件内容不可变不能替代“旧任务不得覆盖新编辑”的业务版本保护。
- 实验室会话与消息：保留会话顺序、用户输入、助手内容与 task_id。关联 Task 的消息不再独立维护另一份任务状态和完整媒体结果，接口从 Task 与 outputs 组装；请求内 SSE 消息自身的状态仍按消息协议处理。
- providers/models：继续表达配置，不因合并 ProviderOperation 而删除供应商账号配置。

`FileUsage` 改造前的唯一键是 `(file_id, usage_kind, source_ref)`，没有 project_id，而 upsert 会改写 project_id。相同文件、用途、source_ref 跨项目使用时可能覆盖旧归属。目标结构将 project_id 纳入关系键；当前 ORM 与迁移已落实。source_ref 表示业务来源，不应成为替代槽位主表的第二份当前采用状态。

槽位里的图片 width/height/format 若表示实际文件属性，应改从 files 读取；槽位只留视角、精度、提示词覆盖等业务配置。若字段表示期望生成规格则仍属槽位，应改用清晰名称，不与实际文件尺寸混用。

## 删除、引用和重复收取

任务输入输出外键指向 files，物理删除默认不移除 files 行。活动任务和当前业务引用的文件不可删除；只有历史引用时，可通过明确的文件删除操作清理字节并保留元信息，让历史显示“文件已删除”。默认不按 TTL 清理成功产物。

请求删除时，在同一短事务锁定文件、检查活动引用并设置 delete_requested_at。所有新建文件引用的路径也必须锁定文件并拒绝已申请删除的行，避免“检查无引用后又被使用”的竞争。后台只扫描删除标记，删除成功后写 deleted_at；删除失败可重复扫描，文件不能重新进入可用状态，无需 outbox 的租约/epoch。

未登记到 DB 的上传对象由安全宽限期后的孤儿扫描处理，排除正在执行和收取的任务。执行中再次收取时，稳定 key、files.storage_key 唯一键和 task_outputs 主键共同防止重复文件行及输出；Task 终态与业务交付在同一事务条件更新。

这里的文件不可变是必要前提。若继续允许同名 key 覆盖，删除版本表会降低正确性，不能单独删表而保留原上传行为。

## 查询和索引

- 排队领取：tasks `(status, created_at, id)`。
- 到期轮询：tasks `(status, next_poll_at, id)`，非远端查询任务 next_poll_at 为空。
- 超时处理：tasks `(status, deadline_at)`。
- 历史分页：tasks `(created_at, id)`，项目历史增加 `(project_id, created_at, id)`。
- 主目标反查：tasks `(target_type, target_id, created_at)`。
- 文件反查：task_inputs / task_outputs 的 file_id 索引。
- 文件删除扫描：files `(deleted_at, delete_requested_at)`；对象身份由 storage_key 唯一键保证。

不为每个枚举、每个 JSON 属性创建索引；其他组合只有真实查询计划证明需要时再加。远端 ID 不假设全供应商全账号唯一，也不必先建独立远端索引：调度按本地任务查即可。

活动列表直接投影 tasks 的轻量列及 input_snapshot 中的 target_parent_id 标量，不加载完整快照或 result；状态轮询仅查询任务轻量列，不再经过 task_links 取最新一行猜导航目标。历史详情加载 Task，再各查一次输入、输出并批量关联 files；实验室列表批量查询相关 tasks，避免逐条 N+1。

## 实施验收边界

1. 缺少 ID/必要数据直接 failed，不存在 unknown 状态、自动重发或人工恢复队列。
2. 远端 ID 已持久化后重启，create 次数不增加；继续查询并收取同一任务。
3. 文本中断后失败，新建重试不覆盖旧任务；同步图片也不假装支持远端轮询。
4. 同名上传产生不同 ID/key，旧任务参考文件字节不变；同一文件在多个输入分组使用时顺序正确。
5. 重复轮询、重复收取只产生一组 task_outputs；部分媒体成功而整任务失败仍保留已有输出。
6. 文件与结果保存完整后才成功；业务目标冲突保留输出，不覆盖新版槽位。
7. 删除来源对象不丢任务历史；删除字节仍保留文件记录；活动引用与删除竞争得到保护。
8. 跨项目复用文件不会覆盖原使用关系；消息与 Task 不出现两份可独立变化的任务状态。
9. 目标范围只剩四张核心表及必要业务表，无 Run/Attempt/Blob/ProviderOperation 的别名兼容、双写或空壳适配层。

状态、输出 DTO、文件引用和任务关联 API 已按目标结构调整，OpenAPI、generated client、相关 architecture 与计划已同步。剩余验证及部署边界以上文进度为准；当前实现细节以 architecture/task-execution 为准。
