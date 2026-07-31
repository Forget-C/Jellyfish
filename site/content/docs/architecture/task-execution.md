---
title: "任务执行架构"
description: "记录当前真实生效的长耗时任务执行层、任务真相层与 Celery 接入范围。"
weight: 7
---

## 当前执行分层

当前长耗时任务执行采用两层结构：

```text
业务任务真相层
├── GenerationTask
├── GenerationTaskLink
├── /api/v1/film/tasks
├── /api/v1/film/tasks/{task_id}/status
└── /api/v1/film/tasks/{task_id}/result

执行层
├── FastAPI 负责创建任务与返回 task_id
├── Redis 作为 Celery broker
└── Celery Worker 执行长耗时任务

执行协议层
├── GenerationTask.task_kind
├── task.execute（统一 Celery 入口）
└── TaskExecutorRegistry（task_kind → executor）

运行时分层
├── Web Runtime
│   ├── async SQLAlchemy
│   └── FastAPI dependencies
└── Worker Runtime
    ├── sync SQLAlchemy
    └── Celery task wrappers + worker services
```

约束如下：

- `GenerationTask` 是异步任务的状态、结果、错误、取消请求与参数快照的唯一真相源；同步文本 SSE 不创建该记录
- `/api/v1/film/tasks` 当前作为前端全局任务中心的主数据源
- `GenerationTaskLink` 当前承担任务与业务实体的关联信息查询
- `GenerationTask` 当前也记录运行时指标：`started_at`、`finished_at`
- 任务状态接口当前直接暴露：
  - `started_at_ts`
  - `finished_at_ts`
  - `elapsed_ms`
- 前端不直接读取 Celery task 状态
- Celery 只负责执行，不负责对前端暴露业务状态
- 任务投递统一使用 `task_kind` 识别具体执行器

实验室中的所有用户可见对话由 `ExperimentMessage` 保存。图片、视频等异步生成在消息中通过 `task_id` 关联 `GenerationTask`：任务保存权威执行数据，Worker 将用户可见的状态摘要和产物引用投影回消息；消息 payload 不作为 Worker 输入。文本 SSE 只追加用户与助手消息，不进入任务中心。

全局任务列表接口当前规则：

- 默认返回：
  - 活跃任务（`pending / running / streaming`）
  - 最近结束的任务（按 `recent_seconds` 控制）
- 支持按以下维度过滤：
  - `statuses`
  - `task_kind`
  - `relation_type`
  - `relation_entity_id`
- 返回项同时包含：
  - 任务状态与进度
  - started / finished / elapsed 指标
  - executor 信息
  - relation 信息
  - 前端默认导航对象信息（用于任务中心回到对应章节/镜头/资产）

当前前端任务中心以该接口为主列表来源，页面自身只补充：

- 当前页面关联对象的高亮上下文
- 任务标题、来源、跳转等即时 UI 元信息

## 当前基础设施

当前最小执行层方案为：

```text
业务库：MySQL
Broker：Redis
执行器：Celery Worker
```

配置规则：

- `DATABASE_URL` 继续指向 MySQL
- `CELERY_BROKER_URL` 若未显式指定，则按 Redis 配置自动拼接
- `backend/.env` 由 `app.config` 按绝对路径加载，避免 worker 因工作目录变化回退到默认 SQLite

## 已切到 Celery 的任务

当前已从本地 `asyncio.create_task(...)` 切到 Celery worker 的任务包括：

- `divide`
- `extract`
- `check-consistency`
- `optimize-script`
- `simplify-script`
- `analyze-character-portrait`
- `analyze-prop-info`
- `analyze-scene-info`
- `analyze-costume-info`
- `image-generation`
- `video-generation`
- `shot-frame-prompt`

其中又分两类：

### 已切到 sync worker runtime

- `divide`
- `extract`
- `check-consistency`
- `optimize-script`
- `simplify-script`
- `analyze-character-portrait`
- `analyze-prop-info`
- `analyze-scene-info`
- `analyze-costume-info`

这些任务当前通过：

- `db_sync.py`
- `SyncSqlAlchemyTaskStore`
- worker 专用同步 LLM runtime
- `script_processing_worker.py`

执行，不再在 Celery worker 中承载 async DB runtime。

### 已切到 async delegating executor

- `image-generation`
- `video-generation`
- `shot-frame-prompt`

这些任务当前也通过 `task.execute(task_id)` 进入统一 Celery 执行层，
但执行器使用 `AbstractAsyncDelegatingExecutor` 作为桥接：

- 每次任务执行前重建 async DB runtime
- 在独立 event loop 中运行既有 async service
- 任务结束后主动释放 async engine
- 在执行前、结果生成后、结果持久化后执行统一取消检查
- 通过 executor 统一配置任务超时
- 输出统一任务事件日志（started / running / cancelled / succeeded / failed）

这样可以先把执行从 Web 进程迁出，同时保持图片 / 视频 provider 调用链的现有 async 实现。

当前这三类 async worker 已补最小专项测试，重点锁定：

- 启动前取消请求会直接转 `cancelled`
- 不再进入后续 provider / agent 调用

### 图片与视频的目标工作流

图片和视频的 async worker 现在按“模态执行复用、目标领域交付分离”组织：

```text
GenerationSubmitter
  → operation × target.kind × delivery 能力校验
  → WorkflowHandler 提交期入口
  → GenerationTask / Outbox
  → GenerationExecutor / GenerationRun
  → ImageGenerationWorker 或 VideoGenerationWorker
  → WorkflowHandler 执行前入口
  → Provider callback
  → GenerationLifecycleCoordinator
  → ArtifactStore / TaskFinalizer / WorkflowHandler 成功交付
```

`WorkflowHandlerRegistry` 以 `(operation, target.kind)` 选择领域规则。当前图片、视频支持的
组合是：

- `image_generation × experiment_session`：归档 Artifact，并投影关联 `ExperimentMessage`；不调用
  资产、分镜或镜头 CAS Publisher。
- `image_generation × asset_image_slot`：通过 `AssetImagePublisher` CAS 自动采用主产物。
- `image_generation × shot_frame_slot`：通过 `ShotFramePublisher` CAS 自动采用主产物。
- `video_generation × experiment_session`：归档 Artifact，并投影关联 `ExperimentMessage`；不读取或修改
  `Shot`。
- `video_generation × shot_video`：通过 `ShotVideoPublisher` CAS 自动采用主产物。

实验室 Handler 在提交期和执行期都复核 `ExperimentSession.lab_type` 与 operation 的对应关系；执行期还会
验证 `ExperimentMessage.task_id` 仍指向同一会话。分镜帧目标的实体门禁同时验证帧槽位属于目标镜头。上述
复核不比较 CAS 版本，版本变化仍应保留产物并由 Publisher 标记为冲突。

图片、视频任务成功结果使用 Artifact-first 的 `GenerationDeliveryResult`：`outcome` 表示任务终态，
`primary_file_id` 用于主预览，`artifacts[]` 保留每个文件的 `publish_state` 和冲突原因。实验室消息只投影
`primary_file_id` 等最小预览字段；完整结果以 `GenerationTask.result` 为准。前端读取新字段时兼容历史
`file_id`，用于已完成任务的展示。

图片、视频轮询任务由 `GenerationExecutor` 创建并领取 `GenerationRun`：仅一个有效 Run 可以进入
`executing`，WorkerCommand 必须携带 `run_id + lease_epoch`。重复投递不会再次调用 Provider；Worker 只执行
Provider 并返回 callback，不直接写 Task、Artifact 或领域投影。Worker 每隔 lease TTL 的三分之一独立续租；
Celery Beat 每 30 秒回收过期 Run、提升 epoch 并重新投递对应任务，旧执行者的 heartbeat/callback 均会被
fencing 拒绝。每条新 Run 还保存稳定的本地 `provider_idempotency_key` 用于恢复审计；该键当前不会被假定为
任何供应商的 HTTP 幂等字段。

对于供应商返回稳定异步任务 ID 的图片、视频能力，Worker 已将 Provider 调用分为创建和轮询两步：创建成功后
使用当前 Run 的 owner/epoch 条件更新立即保存 `provider_task_id`，再开始轮询。过期 Run 恢复后，Worker 读取
该 ID 并只轮询原远端任务，避免重复创建。同步图片接口没有可恢复 ID；若创建请求已被供应商受理但进程在本地
持久化 ID 前退出，系统不会猜测统一幂等 header 或盲目重发创建请求，仍需人工诊断或逐供应商补齐幂等契约。

每次 Celery 投递还会留下 `GenerationRunDispatch` 审计记录：以 Celery `work_id` 为主键，保存投递来源
（`outbox` 或 `reaper`）与时间；Executor 成功领取后将其绑定到 `task_id`、`generation_run_id` 和
`lease_epoch`。同一消息的重复执行不会再次调用 Provider，并会在事件上标记为 `ignored`。该记录用于关联
投递、领取和 epoch 接管。过期 Run 的回收会在同一数据库事务创建 `pending` 事件；独立 dispatcher 在短事务
中认领事件、以预分配 work id 发布 Celery 消息，再确认 `published`。Broker 失败时事件保留为 `pending` 并
累计 attempts，以同一 work id 重试；Broker 已接收但发布状态尚未来得及确认时，Run 的条件领取与 epoch fencing
保证该至少一次窗口不产生第二次有效执行。

`GenerationLifecycleCoordinator` 是图片、视频 callback 的唯一终态写入口。它先校验 Run 的 epoch，再在短
事务中归档 Artifact、调用内部 `TaskFinalizer`、写入领域投影以及 Run/Task 终态。旧 epoch 或重复 callback
不读取业务目标也不产生副作用；取消意图先于成功 callback 时，Coordinator 收口为 `cancelled`。

取消 API 只登记 `cancel_requested` 意图，不撤销 Celery、不直写 Task 或 `ExperimentMessage`。尚未调用
Provider 的任务会由 Executor 生成 fenced cancelled callback；已在运行的任务等待当前 Worker callback，再由
Coordinator 统一裁决为 cancelled、failed 或 succeeded。

`GenerationTask.result` 已开始保存 `artifacts[]` 的稳定投影，同时保留 `file_id` 作为当前轮询调用方的
主产物兼容字段。完整产物以 `GenerationArtifact` 为准；`GenerationTaskLink` 仍只承担任务目标关联与
导航，不承载多产物结果。

## 当前 Celery 主链路特征

当前主链采用：

- API 层创建 `GenerationTask`
- API 层写入 `task_kind`
- 通过 `spawn_*_task(...)` 投递到 Celery
- Celery 统一走 `task.execute(task_id)`
- 图片/视频在 `task.execute(task_id)` 内走 `GenerationExecutor → Worker → Coordinator`；其他任务仍通过
  `TaskExecutorRegistry` 按 `task_kind` 路由
- worker 执行后把状态与结果回写到 MySQL
- 页面继续通过既有任务状态接口轮询和恢复

对核心任务（如 `divide`）进一步采用两阶段模型：

```text
阶段 A：生成结果
→ 调 LLM / Agent
→ GenerationTask.result

阶段 B：应用结果
→ 写业务表
→ 更新业务状态
```

当前有真实前端入口的 script-processing 文本任务，已统一挂到：

- `AbstractWorkerTaskExecutor`
- `AbstractLLMResultGenerator`
- `TaskExecutorRegistry`

其中 sync executor 当前提供：

- 统一 started / succeeded / failed / cancelled 日志
- 统一阶段边界超时检查

这里的超时语义是“阶段边界超时”，不是执行中强中断：

- 在进入执行前检查
- 在生成结果后检查
- 在 apply 后检查

当前已模板化的 executor 包括：

- `script_divide`
- `script_extract`
- `script_consistency`
- `script_character_portrait`
- `script_prop_info`
- `script_scene_info`
- `script_costume_info`
- `script_optimize`
- `script_simplify`

当前已接入 registry 的非文本生成 executor 包括：

- `image_generation`
- `video_generation`
- `shot_frame_prompt`

## 当前前端任务状态展示

当前前端任务状态展示采用“页面局部反馈 + 轻量全局提示”：

- 旧的页面内大块任务提示组件已退出主流程，不再作为默认交互形态

- 触发任务的按钮负责：
  - `loading`
  - 防重复点击
  - 帮助用户确认是哪个动作正在运行
- 任务详情通过 Notification 展示：
  - 当前状态
  - 进度
  - 开始时间
  - 已运行/累计耗时
  - 任务结束后的成功、失败、取消反馈
  - 支持直接跳回来源页面
- 取消入口当前优先放在：
  - 触发区域旁的轻量按钮
  - Notification 内的小型取消动作
- 悬浮任务中心当前统一展示全局任务列表：
  - 默认隐藏，是否展开会按本地历史状态恢复
  - 首次进入时，悬浮按钮默认位于左下角
  - 浮动按钮支持在视窗范围内拖动，并在拖动结束后自动吸附到左侧或右侧边缘
  - 悬浮按钮会记住最近一次位置
  - 展开面板会根据按钮位置自动调整展开方向与对齐方式，避免超出当前视窗
  - 查看当前运行中的任务
  - 查看最近刚结束的任务
  - 显示任务所属对象或来源页面
  - 查看进度、开始时间和耗时
  - 统一执行取消操作
  - 支持回到对应来源页面
  - 任务结束后会短暂保留，便于确认刚刚的执行结果
  - 支持按当前页面 / 运行中 / 最近结束与任务类型做轻量筛选
  - 面板保持轻量化，当前每页最多展示 3 条任务
  - 翻页使用紧凑箭头控件，不引入大体积分页栏
- 当前页面只负责向任务中心提供“高亮哪些任务与当前对象有关”的上下文，不再决定任务是否存在
- 当前页面高亮匹配当前优先使用任务的默认导航对象：
  - `navigate_relation_type`
  - `navigate_relation_entity_id`
  - 若后端未返回导航对象，再回退到原始 `relation_type + relation_entity_id`
- 对未由当前页面显式补充来源信息的任务，任务中心会按：
  - `relation_type + relation_entity_id`
  - 自动解析默认来源文案
  - 尽量推导默认查看跳转
- 主要异步任务的启动、运行中、取消和结束态提示文案已统一收口：
  - 同类任务在不同页面保持一致语气
  - 后续新增任务应复用同一套文案配置
- 当前图片生成页与分镜工作室中的生成动作，也已接入同一套 Notification / 任务中心桥接：
  - 不再只依赖页面内 `message + 手写轮询`
  - 会同步出现在统一任务反馈链路中

当前已经从页面内大块提示切到这套较轻交互的页面包括：

- 分镜管理页
- 分镜编辑页
- 分镜工作室
- 原文编辑弹窗
- 资产编辑页
- 项目工作台章节列表中的分镜提取入口

## 当前仍未切到 Celery 的任务

以下任务当前仍保留旧执行方式，且当前没有真实前端主入口，因此不作为主线优先项：

- `merge-entities`
- `analyze-variants`

它们虽然已纳入任务模型，但当前仍属于预备能力。

## 取消语义

当前取消采用“两级取消”：

```text
前端请求取消
→ GenerationTask.cancel_requested = true
→ 若任务由 Celery 执行且存在 executor_task_id：
  → 立即下发 revoke(terminate=True)
  → API 直接把业务任务状态推进到 cancelled
→ 若无法立即终止：
  → worker 在阶段边界继续执行协作式取消
```

这意味着：

- 对已进入 Celery worker 的任务，当前支持 best-effort 的“立即取消”
- 对无法立即终止的单次长调用，仍保留阶段边界协作式取消作为兜底
- 当前不承诺 provider / LLM SDK 层面的绝对强终止，只保证业务任务状态会立即收敛

## 服务层约束

当前任务执行链要求遵守以下约束：

- `service` 层不得反向依赖 `api.v1.routes`
- Celery task wrapper 只做 task_id 投递
- worker 侧执行逻辑放在 `app.services.script_processing_worker`
- Web 侧任务创建与状态恢复逻辑保留在 `app.services.script_processing_tasks`

这条约束已经用于修复 worker 下暴露出的循环导入问题。
