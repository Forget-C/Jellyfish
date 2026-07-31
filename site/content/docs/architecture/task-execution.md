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

## 当前 Celery 主链路特征

当前主链采用：

- API 层创建 `GenerationTask`
- API 层写入 `task_kind`
- 通过 `spawn_*_task(...)` 投递到 Celery
- Celery 统一走 `task.execute(task_id)`
- worker 通过 `TaskExecutorRegistry` 按 `task_kind` 路由到具体 `WorkerTaskExecutor`
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
