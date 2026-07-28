---
title: "统一生成编排与独立提示词渲染实施计划"
description: "将文本、图片、视频生成收敛到统一编排层，拆分提示词渲染，并以 file_id 统一媒体引用。"
weight: 31
status: completed
---

> 本文属于“任务计划”文档，描述目标架构与一次性切换的实施步骤。项目仍处于开发期，本文**不保留旧路由、旧 payload、双写或兼容适配层**。

## 1. 背景与问题

当前系统已经有图片、视频的供应商契约与适配器，也有脚本处理 Agent 的任务化能力；但各入口仍分别负责模型解析、任务创建、引用文件转换、执行状态、产物归档与业务回写。

这导致以下问题：

- 实验室、资产图片、分镜帧和分镜视频各自创建任务，生命周期逻辑重复。
- 图片、视频 Worker 按 `relation_type` 或 `source` 分支回写业务数据，新增业务目标会污染通用执行代码。
- 提示词预览和提交在部分链路中会再次派生上下文，用户看到的内容与实际执行内容可能不一致。
- 文本实验室直接调用模型，不能复用统一的模型解析、错误映射和可选异步执行能力。
- API 构建任务时将 Base64、Provider 配置甚至凭据放入 payload，任务记录过大且暴露边界不清晰。
- 图片、视频引用存在 `file_id`、URL、Data URL 等多种表达；本地资源没有统一的进入生成链方式。

本计划将“同模态业务入口只在业务目标与上下文上不同”的原则落到实现：演员图、道具图、实验室图片和分镜帧图片共享图片执行链；实验室视频和分镜视频共享视频执行链；文本既可同步、流式，也可异步执行。

## 2. 范围、非目标与强制决策

### 2.1 范围

本计划覆盖：

1. 实验室文本、图片、视频。
2. 演员、角色、场景、道具、服装图片。
3. 分镜首帧、关键帧、尾帧图片及镜头视频。
4. 帧提示词生成，以及剧本拆分、提取、分析、优化等文本 Agent 工作流。
5. 提示词渲染、媒体引用、任务 payload、产物归档与前端交互。

### 2.2 非目标

- 不将图片/视频 Provider 协议强行合并；适配器、轮询和能力差异仍保留在模态实现内。
- 不将剧本 Agent 压成普通 `prompt` 调用；它们继续拥有强类型输入、结构化输出和领域编排。
- 不在本计划中增加音频生成能力。
- 不构建通用自由格式 `metadata` 或任意实体回调 URL。
- 幂等边界不覆盖对象存储 Blob 去重或崩溃后的孤儿对象清理；同一任务不得因此暴露重复 Artifact。
- 不设计业务变量或任务输入的脱敏副本；执行所需的强类型输入只保存一份，但凭据和认证材料仍不得进入任务、Artifact、模板变量或日志。
- 除文本实验室为验证既定 SSE 链路而改为同界面增量显示外，前端只做接口、类型和状态契约迁移；不新增实验模式、交付方式选择器、断线续传、任务详情、新的批量能力或新的业务编辑能力。

### 2.3 已确认的决策

| 决策 | 目标行为 |
|---|---|
| 迁移方式 | 允许在正常开发路径中直接修改正在使用的契约，并接受明确标记的阶段性不可运行；数据库与内部实现仍采用 expand → migrate → contract，最终可交付节点一次性恢复完整链路并删除旧列、旧 DTO 和旧入口。 |
| 阶段交付 | P1 至 P6 每阶段必须形成独立 Git 提交并通过阶段范围内的检查；阶段提交不等于产品可交付，只有文档列出的交付节点必须保证完整系统可运行。 |
| 临时注释 | 阶段开发中对必改且暂时不完整的代码使用 `TODO(unified-generation:Pn)` 标记原因和闭合点；该阶段完成提交前必须移除临时注释，永久保留的函数、类和关键流程说明不属于临时注释。 |
| 提示词 | 渲染为独立同步流程；生成只消费最终 `execution_prompt`，不二次渲染。 |
| 用户编辑 | 允许任意编辑最终提示词和参考资源；提交不校验文本、变量、模板版本或渲染哈希。 |
| 门禁 | 只校验提交引用的实体：目标、槽位、模型、文件及其归属关系。 |
| 媒体引用 | 叶子引用统一使用 `file_id + media_kind + ordinal`；帧槽位和具名主体等分组语义由强类型父结构表达。 |
| 本地资源 | 本地文件和外部 URL 都先导入/上传为 `FileItem`，再参与渲染或生成。 |
| 交付能力 | `inline`、`streaming`、`async_polling` 是独立交付能力，但可用组合由 operation capability 矩阵明确约束。 |
| SSE | 流式接口使用固定 `text/event-stream` 路由、类型化事件和内部运行记录，不允许同一路由按请求体动态切换 JSON/SSE；流式运行只在实验室对话内展示，不进入任务中心。 |
| 并发发布 | 业务槽位使用单调递增 `version_id`；提交冻结期望版本，Publisher 通过 CAS 条件更新，版本冲突时只归档产物、不覆盖用户的新选择。 |
| 开发期恢复 | 不设计数据回滚流程；以每阶段 Git 提交、阶段验证记录和最终可交付节点作为开发期恢复与追溯边界。 |
| 前端迁移 | 文本实验室固定使用 streaming 完成最小端到端接入，但不提供 delivery 选择；图片/视频与 Agent 继续使用 async_polling，其余页面功能和职责保持等价。 |

前端完全不接 SSE 会同时保留“后端流式链路无人消费”和“文本页面独立 inline 生命周期”两套路径，使事件契约、取消、终态落库和 generated transport 无法通过真实页面端到端回归，并增加后续排障与维护成本。因此本计划允许文本实验室做最小 SSE 接入：复用现有聊天入口、消息区域和对话内取消能力，不新增交付方式选择、独立流式页面、断线续传或调试能力，也不把文本流式运行暴露到任务中心。

## 3. 目标架构

```text
业务路由 / 页面
  → PromptRenderer（可选，同步预览）
  → Business Binder（从路径构建可信目标与 operation）
  → GenerationSubmitter（唯一提交入口）
  → GenerationEntityGate（仅实体解析与关系校验）
  → GenerationCapabilityRegistry（校验 operation × delivery）
  → DeliveryAdapter（inline / streaming / async_polling）
  → GenerationExecutor / StreamingGenerationExecutor
  → Provider Adapter 或 Agent
  → ArtifactStore
  → GenerationResultPublisher（按业务目标回写）
```

职责边界如下：

- **业务路由与 Binder**：鉴权、加载业务事实，并从固定路由和路径参数构建可信的 target、modality 与 operation；外部 body 不得重复声明这些字段。
- **PromptRenderer**：模板与业务上下文的同步编排；只产生预览快照，不提交任务。
- **GenerationSubmitter**：冻结最终输入、选择交付方式、提交异步任务或直接调用同步执行器。
- **GenerationEntityGate**：将不可信 ID 转为受信任实体；不审查用户文本。
- **GenerationCapabilityRegistry**：在产生副作用前校验 operation、模态与交付方式组合。
- **GenerationExecutor**：按模态调用模型或 Agent；不认识演员、镜头、实验会话等领域实体；同步结果和流式事件使用不同协议。
- **ArtifactStore**：将 Provider 结果统一归档为 `FileItem` 或文本产物。
- **GenerationResultPublisher**：依据受信任目标发布成功、失败或取消终态，确保业务状态完成收尾。

## 4. 类与契约设计

所有跨层 DTO 放入 `backend/app/core/contracts`；`tasks` 只负责任务封装和执行编排，`integrations` 只依赖 contracts。

### 4.1 外部请求、内部命令与媒体分组

业务 API 请求与内部命令必须分离。外部请求不得携带 `target`、`modality`、`operation` 或 `delivery`；这些字段由固定路由和路径参数唯一派生，避免路径、响应协议与 body 出现多个真相源。

```python
class GenerationModality(str, Enum):
    text = "text"
    image = "image"
    video = "video"


class GenerationDelivery(str, Enum):
    inline = "inline"
    streaming = "streaming"
    async_polling = "async_polling"


class MediaReference(BaseModel):
    file_id: str
    media_kind: Literal["image", "video"]
    ordinal: int = 0


class ImageMediaInput(BaseModel):
    references: list[MediaReference] = Field(default_factory=list)


class VideoFrameMediaReferences(BaseModel):
    first: MediaReference | None = None
    last: MediaReference | None = None
    keys: list[MediaReference] = Field(default_factory=list)


class VideoSubjectMediaReference(BaseModel):
    name: str
    media: list[MediaReference] = Field(default_factory=list)


class VideoMediaInput(BaseModel):
    frames: VideoFrameMediaReferences = Field(default_factory=VideoFrameMediaReferences)
    subjects: list[VideoSubjectMediaReference] = Field(default_factory=list)


class GenerationTarget(BaseModel):
    kind: GenerationTargetKind
    entity_id: str
    slot_id: str | None = None


class GenerationSubmitRequest(BaseModel):
    model_id: str | None = None
    execution_prompt: str | None = None
    media: ImageMediaInput | VideoMediaInput | None = None
    render_id: str | None = None  # 仅溯源
    operation_input: TypedOperationInput


class GenerationCommand(BaseModel):
    modality: GenerationModality
    operation: GenerationOperation
    delivery: GenerationDelivery
    target: GenerationTarget
    request: GenerationSubmitRequest
```

`MediaReference` 只表达不可再分组的叶子文件。视频必须保留两类父结构：

1. `frames.first / last / keys[]` 表达时间与构图槽位。
2. `subjects[].name + media[]` 表达 `@主体名` 与多图片、多视频归组关系。

主体名称归一化后必须唯一，主体媒体不得为空，`ordinal` 只表达组内稳定顺序，不能替代帧槽位或主体归属。现有实验室的 `VideoLabSubjectReference` 和执行层 `VideoSubjectReference` 语义保留；FileResolver 解析后再将统一媒体列表投影为 Provider 所需的 `images/videos`。

`TypedOperationInput` 必须为判别联合：

- 文本对话使用带角色和稳定顺序的 `TextChatInput.messages`。
- 图片、视频使用各自强类型参数。
- 剧本 Agent 使用 `ScriptDividerInput`、`ScriptExtractInput` 等专用输入。

禁止用 `dict[str, Any]` 逃避类型约束。`execution_prompt` 仅对单提示词驱动的 operation 必填；文本对话和 Agent 不得用伪造的空 prompt 代替消息历史或结构化输入。用户可编辑的最终 prompt 必须原样冻结，不参与语义校验。

### 4.2 提示词渲染契约

```python
class RenderedPromptSnapshot(BaseModel):
    render_id: str
    renderer: str
    execution_prompt: str
    variables_snapshot: dict[str, JsonValue]
    template_id: str | None = None
    template_version: int | None = None
    recommended_media: ImageMediaInput | VideoMediaInput | None = None
    warnings: list[str] = Field(default_factory=list)
```

变量快照用于展示、调试和审计，不用于生成前的拒绝判断；本计划不对业务变量做脱敏。Provider 凭据、Authorization、Cookie 和其他认证材料不得进入模板变量、渲染输入或渲染快照。

```python
class PromptRenderer(Protocol):
    async def render(
        self,
        db: AsyncSession,
        request: PromptRenderRequest,
    ) -> RenderedPromptSnapshot: ...
```

`PromptRenderRequest` 只包含该路由允许用户提供的模板选择和强类型渲染输入，不接受通用 `renderer`、`target` 或 `operation`。业务资源、槽位和 Renderer 类型由固定 render 路由的路径参数与 Binder 决定；实验室等不绑定持久业务实体的入口使用独立的 lab render 路由和封闭的 `LabPromptRenderInput`。

实现类：

- `AssetImagePromptRenderer`
- `ShotFramePromptRenderer`
- `ShotVideoPromptRenderer`
- `ExperimentPromptRenderer`
- `AgentPromptRenderer`（仅在 Agent 需要模板化系统输入时使用）

现有 `studio/generation/{asset_image,frame,video}` 的 `build_base`、`build_context`、`derive_preview` 迁入对应 Renderer。现有 `build_submission` 中的重新派生逻辑删除；提交阶段不再调用它们。

### 4.3 实体门禁

```python
class GenerationEntityGate(Protocol):
    async def validate(
        self,
        db: AsyncSession,
        command: GenerationCommand,
    ) -> ResolvedGenerationSnapshot: ...
```

`ResolvedGenerationSnapshot` 是纯可序列化快照，不携带 ORM 实体或 `AsyncSession`。它固定实际 `model_id`、模型名与配置 revision、canonical target、目标槽位的 `expected_version_id`、媒体引用、文件类型与内容版本/哈希。Worker 只按快照重载实体并检查其仍存在、仍可用，不再次执行默认模型选择、目标推导或关系猜测；凭据仍在执行时动态读取，不进入快照。

模型与 Provider endpoint 配置采用不可变 `ModelConfigRevision`：

| 字段 | 说明 |
|---|---|
| `revision_id` | 全局稳定主键 |
| `model_id` | 所属模型 |
| `version_id` | 同一模型内单调递增 |
| `model_name / category / model_params` | 执行所需模型配置 |
| `provider_key / endpoint_config / capability_snapshot` | Provider 类型、地址与能力配置 |
| `credential_ref` | 稳定凭据引用，不保存凭据值 |

数据库对 `(model_id, version_id)` 建唯一约束，`Model` 保存 `current_revision_id`。模型名称、参数、类别、Provider endpoint 或 capability 修改时，在同一事务创建新 revision 并切换当前引用；旧 revision 禁止更新，被任务引用时不得物理删除。凭据轮换只更新 `credential_ref` 指向的值，不创建配置 revision。Gate 将明确的 `revision_id` 写入快照，Worker 不使用可变的当前配置替代它。

门禁只执行以下校验：

1. `target` 实体、图片槽位、实验会话或镜头存在。
2. 目标与项目、章节、镜头、槽位之间的关系合法。
3. `model_id` 存在、启用且类别与模态匹配；未传时按明确的默认模型策略解析。
4. 每个 `file_id` 存在、可用、对当前目标可访问，声明的 `media_kind` 与 `FileItem.type` 一致。
5. 首帧、尾帧各最多一个且必须为图片；关键帧保持稳定顺序。
6. 主体名称归一化后唯一、主体媒体非空、组内 ordinal 唯一。

门禁不得校验：提示词是否与模板一致、变量值、模板版本、`render_id`、渲染时间、上下文是否过期或用户是否修改提示词。模型是否支持主体图片/视频、主体与帧能否组合、帧角色和数量上限等能力细节由 Executor capability 校验；Provider Adapter 不得静默丢弃无法表达的引用。

统一错误语义：`target_not_found`、`file_not_found`、`target_relation_invalid`、`file_relation_invalid`、`file_unavailable`、`media_group_invalid`、`media_role_invalid`、`model_unavailable`、`delivery_unsupported`。

### 4.4 编排、交付与执行

```python
class GenerationSubmitter:
    async def submit_inline(
        self,
        db: AsyncSession,
        command: GenerationCommand,
    ) -> GenerationExecutionResult: ...

    async def submit_stream(
        self,
        db: AsyncSession,
        command: GenerationCommand,
    ) -> AsyncIterator[GenerationStreamEvent]: ...

    async def submit_async(
        self,
        db: AsyncSession,
        command: GenerationCommand,
    ) -> GenerationAccepted: ...


class InlineDeliveryAdapter(Protocol):
    async def deliver(
        self,
        snapshot: ResolvedGenerationSnapshot,
        command: GenerationCommand,
    ) -> GenerationExecutionResult: ...


class StreamingDeliveryAdapter(Protocol):
    async def deliver(
        self,
        snapshot: ResolvedGenerationSnapshot,
        command: GenerationCommand,
    ) -> AsyncIterator[GenerationStreamEvent]: ...


class AsyncPollingDeliveryAdapter(Protocol):
    async def deliver(
        self,
        snapshot: ResolvedGenerationSnapshot,
        command: GenerationCommand,
    ) -> GenerationAccepted: ...


class GenerationExecutor(Protocol):
    modality: GenerationModality

    async def execute(
        self,
        context: GenerationExecutionContext,
    ) -> GenerationExecutionResult: ...


class StreamingGenerationExecutor(Protocol):
    modality: GenerationModality

    def stream(
        self,
        context: GenerationExecutionContext,
    ) -> AsyncIterator[GenerationStreamEvent]: ...
```

同步执行器返回一次性结果，流式执行器返回类型化异步事件；不得使用 `Any` chunk，也不得在同一个 `execute()` 中混合两种返回。

SSE 事件契约：

```python
class StreamEventType(str, Enum):
    accepted = "accepted"
    delta = "delta"
    progress = "progress"
    completed = "completed"
    error = "error"
    cancelled = "cancelled"
    heartbeat = "heartbeat"


class StreamAcceptedData(BaseModel):
    task_id: str
    user_message: ExperimentMessageRead


class StreamDeltaData(BaseModel):
    task_id: str
    text_delta: str


class StreamCompletedData(BaseModel):
    task_id: str
    assistant_message: ExperimentMessageRead
    result: GenerationExecutionResult


class StreamErrorData(BaseModel):
    task_id: str
    error: GenerationError


class StreamProgressData(BaseModel):
    task_id: str
    progress: int


class StreamCancelledData(BaseModel):
    task_id: str
    reason: str | None = None


class StreamHeartbeatData(BaseModel):
    task_id: str


class GenerationStreamEvent(BaseModel):
    version: Literal["1"]
    event: StreamEventType
    sequence: int
    created_at: datetime
    data: StreamAcceptedData | StreamDeltaData | StreamCompletedData | StreamErrorData | StreamProgressData | StreamCancelledData | StreamHeartbeatData
```

事件使用 `event` 作为判别字段，各事件只携带对应的 `data`。`accepted.data.user_message` 是已提交的 canonical user message，包含正式 ID 与消息 sequence；`completed.data.assistant_message` 是成功 Publisher 已提交的 canonical assistant message。`task_id` 始终表示 hidden streaming run，只供当前实验室取消与审计。

事件顺序固定为 `accepted → delta/progress* → completed|error|cancelled`，终态只能出现一次，业务事件的 `sequence` 单调递增。heartbeat 不进入业务日志；最终文本、usage、模型 revision 与 Provider request ID 在终态写入任务结果，不逐 token 持久化。

流式入口必须在发送 `accepted` 前提交隐藏的运行记录、目标关联和输入快照。流生成器使用短生命周期的独立数据库事务更新状态，不得在整个 SSE 连接期间占用路由注入的 `AsyncSession`。流式运行记录必须带 `delivery = streaming` 和 `visibility = hidden`，只允许实验室通过 `task_id` 查询或取消；任务中心列表固定过滤为 `visibility = task_center`。

流式运行还必须持久化 `lease_owner`、单调递增 `lease_epoch`、`lease_expires_at` 和 `heartbeat_at`。Owner 领取 lease 时原子递增 epoch；续租、状态更新、Artifact/消息发布和终态提交都必须带 `task_id + status=streaming + lease_owner + lease_epoch` 条件。

Web 进程崩溃、部署重启或事件循环异常导致 lease 超时时，stale reaper 通过 CAS 将过期记录切换到 terminalizing 并递增 epoch，使旧 owner 失效。旧 owner 的迟到 delta、completed 或 Publisher 写入影响行数为 0 时必须停止。reaper 与正常 owner 共用单一 terminalization 服务：成功只允许写一次 canonical assistant；失败、取消或 lease timeout 只更新 hidden run 的 status/error，不创建可见 assistant 或错误消息。

实现关系：

- `InlineDeliveryAdapter`：直接调用 Executor，返回同步文本结果；不默认创建任务记录。
- `StreamingDeliveryAdapter`：先创建 `visibility = hidden` 的 `GenerationTask`，再调用 Streaming Executor 输出 SSE；运行记录承载对话内取消、终态和最终结果，但不进入任务中心。
- `AsyncPollingDeliveryAdapter`：在同一事务创建 `visibility = task_center` 的 `GenerationTask`、Target Link、Media Reference 与 Outbox；提交后由 dispatcher 投递，Worker 调用同一个 Executor。
- `TextChatExecutor`：单轮文本对话。
- `TextAgentExecutor`：剧本拆分、提取、分析、优化等 Agent 工作流。
- `ImageGenerationExecutor`：复用 `ImageGenerationTask` 与现有图片 Provider Adapter。
- `VideoGenerationExecutor`：复用 `VideoGenerationTask` 与现有视频 Provider Adapter。

交付能力由显式矩阵决定，Submitter 必须在写任务或其他副作用前完成校验：

| operation | inline | streaming | async_polling |
|---|---:|---:|---:|
| `text_chat` | 是 | 是 | 是 |
| `text_agent` | 否 | 否 | 是 |
| `image_generation` | 否 | 否 | 是 |
| `video_generation` | 否 | 否 | 是 |

### 4.5 产物与业务发布

新增 `GenerationArtifact` 表，一条真实产物一行：

| 字段 | 说明 |
|---|---|
| `id` | 产物 ID |
| `task_id` | 异步任务 ID；同步调用可为空 |
| `modality` | text / image / video |
| `ordinal` | 多图、多段文本的稳定顺序 |
| `file_id` | 图片或视频的 `FileItem` 引用，可空 |
| `text_content` | 文本产物，可空 |
| `provider_result` | 按强类型字段保存 Provider request ID、状态、模型名、usage 与必要错误信息 |
| `publish_status` | `published / conflicted / skipped`，表示是否自动写回业务目标 |
| `publish_error` | 发布冲突或跳过原因，例如 `target_version_conflict` |

异步产物必须以 `(task_id, ordinal)` 建唯一约束。图片、视频产物必须且只能设置 `file_id`，文本产物必须且只能设置 `text_content`；同步结果如需持久化，则使用稳定的 `generation_run_id`，不能依赖可空 `task_id` 区分重试。

`publish_status` 赋值规则固定如下：

- 主产物 CAS 成功：`published`，`publish_error = NULL`。
- 主产物 CAS 冲突：`conflicted`，`publish_error = target_version_conflict`。
- 非主产物：`skipped`，`publish_error = non_primary_artifact`。
- 无自动目标槽位的实验或纯归档产物：`skipped`，`publish_error = no_target_slot`。
- Publisher 技术异常：整个数据库事务回滚并由任务重试，不得用 `skipped` 吞掉异常。

数据库增加 CHECK：`published` 时 error 必须为空，`conflicted` 时必须是冲突码，`skipped` 时必须有明确原因。Artifact 只在事务确定最终发布状态后对外可见。

`GenerationTaskLink` 最终只表达“任务与业务目标”的关联，不再承担单一产物存储。只有当所有现有 Writer 都切换到 ArtifactStore/Publisher 后，才删除其 `file_id` 字段和“只保存第一张图”的隐含语义。

```python
class GenerationResultPublisher(Protocol):
    target_kind: GenerationTargetKind

    async def publish_terminal(
        self,
        db: AsyncSession,
        snapshot: ResolvedGenerationSnapshot,
        outcome: GenerationOutcome,
        artifacts: list[GenerationArtifact],
    ) -> None: ...
```

`GenerationOutcome` 覆盖 `succeeded / failed / cancelled`。Artifact 归档、业务发布与任务终态必须在同一数据库事务中提交，或共享可重放的幂等键；Publisher 以 `task_id + target + slot` 幂等，重复投递不得重复创建业务记录。

所有可被生成结果自动写回的业务槽位增加单调递增 `version_id`，初始值为 1，任何上传、历史采用、人工替换或 Publisher 写回都必须在同一事务中使其加一。Submitter 将当前值冻结为 `expected_version_id`，Publisher 使用 CAS：

```sql
UPDATE target_slot
SET file_id = :file_id, version_id = version_id + 1
WHERE id = :slot_id AND version_id = :expected_version_id;
```

影响行数为 0 表示用户已修改目标。此时生成任务和 Artifact 仍可成功，但发布状态记为 `conflicted`、错误码记为 `target_version_conflict`，不得自动覆盖当前槽位。镜头视频若直接写在 `Shot`，使用专门的 `generated_video_version_id`；删除并重建槽位时必须使用新实体 ID 或延续版本，避免 ABA。

多产物与历史采用语义：

- Publisher 默认只将 `ordinal = 0` 的主产物写入目标槽位，其余产物仍完整归档并出现在历史结果中。
- 用户从历史结果采用产物时，API 使用 `ArtifactAdoptRequest(artifact_id, expected_version_id)`；所有可采用槽位的 Read DTO 返回当前 `version_id`，镜头视频返回 `generated_video_version_id`。
- 服务端校验 Artifact 属于当前 target/slot 后执行 CAS 并递增版本。影响行数为 0 时返回 HTTP 409 `target_version_conflict`，响应携带当前 `version_id` 与 `file_id`；不得读取新版本后自动重试。成功响应返回采用后的 `file_id` 和新 `version_id`。
- 人工上传、替换和清空当前槽位等直接写操作同样必须接收 `expected_version_id` 并执行 CAS；生成 submit 的期望版本仍由服务端读取并冻结，前端不在生成 body 中重复声明。
- 默认采用和历史采用均通过 `expected_version_id` 做 CAS；冲突只影响自动采用，不把已经成功的 Provider 生成标记为失败。
- 当前槽位的 `file_id` 是“正在采用哪个产物”的事实来源；`GenerationTaskLink.status` 不再承担多产物采用状态。
- 任务中心只展示 `async_polling` 任务的通用状态；产物预览、选择和采用继续留在资产详情或分镜工作室，文本 SSE 状态只留在实验室对话。

本计划的幂等范围只覆盖 GenerationArtifact、FileItem 数据库记录、Publisher 业务回写和任务终态；不覆盖对象存储 Blob 去重，也不处理崩溃后产生的孤儿对象。即使对象存储出现重复内容，同一 `(task_id, ordinal)` 仍只能暴露一个 Artifact。

发布器：

- `ExperimentPublisher`：更新实验会话消息并归档资料库产物。
- `AssetImagePublisher`：写回 ActorImage、CharacterImage、SceneImage、PropImage、CostumeImage 槽位。
- `ShotFramePublisher`：写回 `ShotFrameImage` 并刷新视频准备度。
- `ShotVideoPublisher`：写回 `Shot.generated_video_file_id`。
- `ShotFramePromptPublisher`：写回 `ShotDetail` 对应帧提示词字段。
- `ScriptOperationPublisher`：写入剧本任务结果并执行明确的领域同步，例如候选资产、台词候选与分镜语义。

`shot.status` 继续只表达提取确认状态；任务运行状态完全由 `GenerationTask` 表达，发布器不得把运行中状态写入 `shot.status`。失败和取消仍需刷新实验消息、runtime summary、视频准备度等派生状态，确保业务页面不会永久停留在 pending。

## 5. 媒体引用与文件流程

生成业务 API、Web 状态、渲染快照和异步任务 payload 只能保存强类型媒体结构及其叶子 `MediaReference.file_id`，不得保存：

- Base64 或 Data URL；
- 浏览器 Blob URL；
- 外部 URL；
- 对象存储 `storage_key`；
- Provider File ID。

统一流程：

```text
本地文件 / 外部 URL
  → 上传或导入服务
  → FileItem(file_id)
  → PromptRenderer / GenerationSubmitRequest 仅引用 file_id 与分组语义
  → GenerationEntityGate 校验实体与关系
  → ResolvedGenerationSnapshot 冻结 file_id、类型、分组、版本/哈希
  → Worker FileResolver 下载或签发临时访问地址
  → Provider Adapter 转换为 URL、Data URL 或 Provider File
```

新增 `FileResolver`：执行期根据 `MediaReference` 读取 `FileItem`，生成 Provider 所需的临时表示。转换结果仅存在于进程内，不写入 payload 或日志。

异步任务还需新增 `GenerationTaskMediaReference` 表，保存 `task_id`、`file_id`、分组路径、`ordinal`、文件类型与版本/哈希快照。该表不保存媒体正文。

活动文件保护规则：

1. `pending / running / streaming` 任务的媒体引用阻止文件删除。
2. 文件删除服务必须先查询并锁定活动引用；存在引用时返回 `file_in_use`，不得先删除对象存储。
3. 任务进入终态后按保留策略释放活动保护，但审计快照继续保留文件 ID、类型和版本信息。
4. 文件正文与快照版本不一致时，Worker 返回 `file_version_changed`，不得静默使用新内容。

外部 URL 导入必须限制协议、重定向次数、响应大小和媒体类型，并阻止访问环回、私网、链路本地和云元数据地址，避免 SSRF。

## 6. API 与 Web 交互

### 6.1 API

不新增自由格式万能 `/generate` 路由。保留清晰的业务资源路径，并按固定响应协议区分同步、流式和异步入口：

```text
POST /api/v1/studio/generation-prompts/assets/{asset_type}/{asset_id}/slots/{slot_id}/render
POST /api/v1/studio/generation-prompts/shots/{shot_id}/frames/{frame_type}/render
POST /api/v1/studio/generation-prompts/shots/{shot_id}/video/render
POST /api/v1/studio/labs/{lab_type}/prompts/render
POST /api/v1/projects/{project_id}/script-processing/{operation}/prompts/render
POST /api/v1/projects/{project_id}/chapters/{chapter_id}/script-processing/{operation}/prompts/render
POST /api/v1/studio/image-tasks/actors/{actor_id}/slots/{slot_id}/tasks
POST /api/v1/studio/image-tasks/characters/{character_id}/slots/{slot_id}/tasks
POST /api/v1/studio/image-tasks/assets/{asset_type}/{asset_id}/slots/{slot_id}/tasks
POST /api/v1/studio/image-tasks/shots/{shot_id}/frames/{frame_type}/tasks
POST /api/v1/film/shots/{shot_id}/video/tasks
POST /api/v1/studio/labs/text/sessions/{session_id}/execute
POST /api/v1/studio/labs/text/sessions/{session_id}/stream
POST /api/v1/studio/labs/text/sessions/{session_id}/tasks
POST /api/v1/studio/labs/image/sessions/{session_id}/tasks
POST /api/v1/studio/labs/video/sessions/{session_id}/tasks
POST /api/v1/projects/{project_id}/script-processing/{operation}/tasks
POST /api/v1/projects/{project_id}/chapters/{chapter_id}/script-processing/{operation}/tasks
```

`/execute` 固定返回 JSON，`/stream` 固定返回 `text/event-stream`，`/tasks` 固定返回 `GenerationAccepted` JSON。不得让同一 POST 根据 body 中的 `delivery` 动态切换 JSON、SSE 和任务响应。文本 `/stream` 在发送 `accepted` 前创建 canonical user message 和隐藏的 streaming 运行记录；成功时 `ExperimentPublisher` 写 canonical assistant，失败、取消或 lease timeout 只更新 hidden run 的 status/error，不创建可见错误气泡。图片、视频 `/tasks` 创建 canonical user/task message，并由异步 Publisher 更新终态。协议必须在 P1 定稿，避免前端自行重复写会话消息。旧入口可在开发阶段按计划直接修改或暂时失效，但必须在最终交付节点完成切换和删除。

每个路由只做：解析业务路径、构建内部 `GenerationCommand`、调用 `PromptRenderer` 或 `GenerationSubmitter`、组织响应。外部 body 不接受 target/modality/operation/delivery；路由不得构建 Provider run args、下载文件或发布产物。

SSE 断连规则：

1. 服务端生成器检测 `Request.is_disconnected()` 和生成器关闭。
2. 断连时 best-effort 取消 Provider 流，将任务标记为 `cancelled`，原因记录为 `client_disconnected`，并禁止 Publisher 发布成功结果。
3. 实验室对话内用户主动停止时，前端立即冻结当前 run、忽略后续事件，并行发起独立的 cancel API 请求和 `AbortController.abort()`，不得等待 cancel API 成功后才断流。取消接口使用 `accepted.data.task_id`，按会话和 target 鉴权，不因 `visibility = hidden` 而拒绝。
4. 已提交终态后发生的迟到断连不得把 `succeeded` 改成 `cancelled`。
5. 本阶段不承诺断线续传；若未来支持，需另行定义 `event_id`、事件保留和 replay 协议。

### 6.2 Web

所有调用必须使用 OpenAPI generated client，不新增页面级手写 HTTP service。当前生成运行时会完整缓冲非 JSON 响应，因此 P2 必须扩展代码生成模板或更换生成传输层，为固定 SSE 路由生成基于 `Response.body` 的统一异步流接口。

标准页面交互：

1. 页面编辑基础业务字段与手工提示词。
2. 用户点击“渲染提示词”，调用 render API；页面继续复用当前已有的提示词、模板变量、参考资源和诊断区域。`variables_snapshot`、`recommended_media` 与 warnings 可进入类型和内部状态，但本阶段不新增统一调试面板。
3. 用户可编辑提示词、增删或排序帧引用和具名主体媒体组。
4. 用户点击“生成”，页面提交路由专用的 `GenerationSubmitRequest`；target/modality/operation 由路由 Binder 确定。
5. 文本实验室固定使用 `streaming`，在当前回复区域增量显示文本并提供对话内停止；图片、视频和 Agent 继续使用 `async_polling` 与通用任务接口恢复状态。页面不提供 delivery 选择。
6. 成功后只刷新所属业务查询：资产槽位、镜头帧、视频、实验会话或剧本结果；任务中心只展示 `async_polling` 任务的通用状态。

实验室可跳过第 2 步并直接提交手工提示词；资产详情页和分镜工作室将渲染作为生成准备入口。分镜编辑页继续只负责提取、确认和修正，不接入 ShotFrame/ShotVideo render/submit；镜头未 ready 时，工作室引导返回编辑页。Web 不在浏览器中渲染模板或转换媒体格式。

Submitter 必须为每个异步 `GenerationTargetKind` 生成稳定的任务来源和导航映射，至少覆盖异步实验会话、资产详情、章节、镜头和分镜工作室。任务中心只使用 `visibility = task_center` 的异步记录生成标题、高亮与回跳入口，不读取业务专属上下文；文本 streaming session 不参与该映射。

### 6.3 前端同步迁移与最小 SSE 接入

本阶段完成接口、generated types、媒体结构、状态所有权和文本 SSE 的最小端到端接入。除文本回复在原位置增量显示外，页面信息架构、操作入口和业务结果必须与当前实现等价。

#### 当前功能基线

- 统一实验室保留模型选择、模板变量、自由提示词、会话历史、上传/资料库选取、任务状态、取消、结果预览和清空历史。
- 文本实验室保持当前聊天入口和消息布局，固定使用 streaming 并在现有 assistant 回复位置增量更新；不新增 delivery 选择器或异步文本模式。
- 图片、视频实验室继续使用 async_polling；视频继续支持首帧、尾帧、关键帧、具名主体、多图片/多视频主体素材及现有模型能力限制。
- 资产详情保留提示词预览与编辑、参考图、生成、取消、状态反馈、历史候选和采用。
- `ChapterStudio` 保留帧提示词、首/尾/关键帧、视频提示词、参考模式、生成参数、生成/取消、结果刷新和视频准备度，以及现有多选、批量 readiness、跳过阻塞项和逐镜头创建任务流程。
- `ChapterShotEditPage` 继续只负责提取、确认和修正，不增加生成入口。
- 任务中心继续只展示 `async_polling` 任务的通用状态、进度、取消、当前页高亮和来源回跳；文本 streaming 状态、业务产物和上下文留在业务页面。

#### 必须同步修改

1. **Generated client 基础设施**
   - 调整 OpenAPI 生成模板或稳定扩展层，为固定 SSE 路由生成类型化异步流接口；不得直接手改会被重新生成覆盖的 service 文件。
   - 文本实验室调用固定 `/stream`；图片、视频和 Agent 继续调用 `/tasks`，不新增运行时 delivery 分支。
   - 每批 API 变更后立即运行 `pnpm run openapi:update`，同步 service、DTO、任务列表与 Artifact 类型。

2. **共享 SSE 状态**
   - 新增实验室专用 `useGenerationStream`，统一处理 connecting、streaming、completed、failed、cancelled、`task_id`、sequence 去重和组件卸载清理。
   - 提交时可显示 optimistic user message；`accepted.data.user_message` 到达后按本地 generation token 原位替换为 canonical user message，不按文本内容猜测或去重。
   - `delta` 只更新带当前 generation token 的临时 assistant 消息，不逐 token 写数据库或全局 Store；`completed.data.assistant_message` 原位替换临时消息，再刷新历史校验一致性。
   - 该状态只归实验室对话所有，不写 `taskUiStore`、不注册 `TaskRuntimeProvider`，也不触发任务中心或全局任务通知；`task_id` 仅用于当前流的状态、取消和审计。
   - 用户停止时先原子切换本地状态并忽略当前 run 的后续事件，再以独立请求发起 cancel API，同时立即 abort SSE；两者通过 `Promise.allSettled` 清理，不能等待 cancel 成功后才断流。
   - 组件卸载或切换会话只 abort，由服务端断连规则收敛运行记录；新提交必须生成新的 generation token，旧流事件不得写入新消息。
   - 不实现 `Last-Event-ID`、断线续传、事件回放或跨页面恢复增量 token。

3. **生成草稿状态**
   - 重构 `front/src/pages/aiStudio/hooks/useGenerationDraft.ts`，分离 `renderedSnapshot`、最终可编辑 prompt 和最终可编辑 media。
   - `submit` 只能读取界面最终值，不得隐式调用 render；prompt、帧槽位、主体分组和组内顺序必须原样提交。
   - 资产详情和 `ChapterStudio` 必须共用该约束，不得以 `as any` 或旧 DTO 维持编译。

4. **模板表单**
   - 保留当前模板选择、变量输入和“转为自由输入”交互。
   - 删除浏览器端 `renderPromptTemplate` 执行职责；变量提交给固定 render API，“转为自由输入”使用服务端返回的 `execution_prompt`。
   - 手工自由提示词仍可跳过 render 直接提交。

5. **统一实验室**
   - 修改 `experiment/modes/TextExperimentMode.tsx`、`ImageExperimentMode.tsx`、`VideoExperimentMode.tsx`，切换到带 `session_id` 路径的 generated API。
   - 文本模式调用 `/stream`，在当前 assistant 消息区域增量显示；不新增模式开关、独立流式页面或额外调试信息。
   - 本阶段保持当前单轮模型输入：`TextChatInput.messages` 只提交本次 user message；会话历史继续用于展示和持久化，不自动扩展为多轮模型上下文。
   - 文本状态和停止操作只存在于实验室对话，不注册任务中心条目；失败、取消或 lease timeout 时保留 canonical user message、移除临时 assistant，不创建可见错误气泡，按现有样式提示后刷新历史。
   - 图片参考转换为 `ImageMediaInput`；视频帧和具名主体转换为 `VideoMediaInput`，保证主体名称、媒体类型与 ordinal 无损。
   - 文本实验路由在事务中创建 canonical user message 和 hidden stream record，成功 Publisher 写 canonical assistant；图片、视频实验路由创建 canonical user/task message。前端按事件接管 canonical message 或刷新会话历史，不重复调用消息创建接口。
   - 图片、视频保留现有任务轮询、取消、失败提示、结果预览和会话恢复行为；文本只使用 SSE 与终态历史刷新。

6. **资产详情**
   - 修改 `assets/components/AssetEditPageBase.tsx` 及各 asset adapter，使用包含 `slot_id` 的资源化 render/tasks generated API。
   - 保存服务端 render snapshot、最终 prompt 和强类型图片引用，保持现有预览弹窗与编辑体验。
   - 槽位 Read DTO 暴露 `version_id`；历史查询切换到 Artifact，采用操作提交 `{artifact_id, expected_version_id}`，成功后使用响应的新版本更新缓存并刷新槽位与历史。
   - 上传、人工替换和清空槽位也提交当前 `expected_version_id`，成功后接管响应的新版本；生成 submit 不携带该字段，由服务端冻结提交时版本。
   - 收到 409 `target_version_conflict` 时不得自动重试；保留 Artifact，刷新槽位与历史，并按现有 message 样式提示“目标已被其他操作更新，请重新确认采用”。

7. **分镜工作室**
   - 修改 `chapter/ChapterStudio.tsx`，使用包含 `shot_id + frame_type` 的帧路由和包含 `shot_id` 的视频路由。
   - 移除 `images: string[]`、旧 `reference_mode` 派生和 `as any` payload，改用 generated `ImageMediaInput / VideoMediaInput`。
   - 保留现有比例、分辨率、能力限制、准备度检查、任务取消和回编辑页引导；终态只刷新帧、视频、runtime summary 与 video-readiness。
   - 帧槽位 DTO 暴露 `version_id`，Shot 暴露 `generated_video_version_id`；历史采用使用相同的 expected-version CAS 和 409 刷新提示，不自动覆盖新结果。
   - 保留现有多选、批量 readiness、自动跳过未就绪镜头和逐镜头创建生成任务行为；只替换底层 generated API 与 DTO，不新增批量策略。

8. **任务中心与任务恢复**
   - 同步修改 `components/taskUiStore.ts`、`taskCenterMeta.ts`、`TaskRuntimeProvider.tsx` 和 `TaskCenter.tsx`，消费新的 target 导航字段。
   - 图片、视频、Agent 等异步实验会话、资产槽位、章节、镜头和分镜工作室必须保持现有标题、状态、进度、取消、高亮和回跳能力。
   - 任务列表 API 默认只返回 `delivery = async_polling` 且 `visibility = task_center` 的记录；`taskUiStore` 和 `TaskRuntimeProvider` 不登记文本 streaming task，过滤必须由后端保证，不能只靠前端隐藏。
   - 页面局部轮询可收敛到现有任务运行时，但不得改变当前提示样式，也不得把 Artifact、prompt 或媒体分组放入任务中心。

9. **历史结果与旧入口**
   - 资产历史、实验室结果和分镜结果只通过 Artifact `file_id` 预览；删除 Provider URL、Base64 和 `GenerationTaskLink.file_id/status` 回退。
   - 统一实验页面完成等价迁移后，删除未被正式路由使用的旧 `textLab/ImageLab/VideoLab` 页面实现及旧 service/DTO；`/text-lab`、`/image-lab`、`/video-lab` 到 `/lab` 的现有兼容跳转继续保留。

#### 禁止扩张

- 不新增实验模式、delivery 选择器、独立流式页面、断线续传、事件回放、素材管理器、提示词版本管理、任务详情页或新的批量能力。
- 不改变实验室、资产详情、分镜编辑页、分镜工作室和任务中心的信息架构。
- 不让图片、视频或 Agent 在前端获得新的交付方式；文本只使用固定 streaming，不同时维护 inline/async 页面分支，也不进入任务中心。
- 不改变 `shot.status`、runtime task status 和 video-readiness 的现有三类状态语义。

#### 等价验收

- `pnpm exec tsc --noEmit` 通过，`pnpm run openapi:update` 后 generated 扩展和类型保持完整。
- 三类实验室的模型、模板/自由提示词、会话、媒体选择、提交、取消、结果和清空历史行为与当前一致；文本只在原回复区域增量显示并在同一对话区域停止。
- 资产详情的提示词编辑、生成、取消、历史候选和采用行为与当前一致。
- `ChapterStudio` 的帧、视频、参数、准备度、批量 readiness、跳过阻塞项、批量创建任务和回编辑页引导行为与当前一致；`ChapterShotEditPage` 没有新增生成入口。
- 任务中心的异步任务状态、进度、取消、高亮和回跳行为与当前一致，且不展示文本 streaming 记录或业务专属详情。
- 编辑 prompt、帧或主体媒体后提交不会再次 render，提交值与界面最终值一致。
- 生成入口中不存在浏览器模板渲染、URL/Base64 媒体、旧 task-link 产物读取或 `as any` payload。

## 7. 数据与安全规则

### 7.1 任务 payload

异步和流式 `GenerationTask.payload` 只保存：

- `ResolvedGenerationSnapshot` 中冻结的实际模型 revision、可信目标、`expected_version_id`、强类型媒体分组和完整 `operation_input`；
- 发布器所需的 canonical target 与幂等键。

`operation_input` 是 Worker 唯一执行输入，不另存 audit/redacted 副本，也不从业务库重新派生。本计划不对业务输入做脱敏。不得保存 API Key、API Secret、credential value、Authorization/Cookie header、Base64、Data URL、存储 Key 或原始 HTTP 请求；Provider Base URL 只存在于 `ModelConfigRevision`，payload 只保存 revision ID。

Worker 不得重新选择默认模型或重新解释 target。它按快照中的 Provider/model revision 执行，仅通过 `credential_ref` 动态读取凭据；若指定 revision 已失效则明确失败。Provider 侧 request ID、实际模型名、配置 revision、耗时和错误摘要写入结果与日志。

### 7.2 模板与渲染审计

当提交带 `render_id` 时，任务可关联渲染快照用于审计；它不影响提交合法性。用户编辑后应保存最终 prompt，并可选记录 `prompt_source = rendered | user_edited | manual`。

### 7.3 数据库变更、Outbox 与切换

数据库采用 expand → migrate → contract；它只描述前向 schema 顺序，不代表开发阶段必须兼容旧应用：

1. **Expand**：创建 `generation_artifacts`、`generation_task_media_references`、`generation_dispatch_outbox` 及必要约束；不删除旧列。
2. **Migrate**：逐入口切换 Writer、Reader 和 Worker，验证 Artifact/Publisher、媒体保护和任务恢复。
3. **Contract**：在计划指定的切换阶段删除 `GenerationTaskLink.file_id`、旧 payload 序列化与旧入口；允许该提交之后、恢复阶段之前暂时无法运行依赖旧契约的调用方。

Outbox 与幂等规则：

- API 在同一事务创建 `GenerationTask`、Target Link、Media Reference 和 Outbox。
- Outbox 以 `task_id` 唯一；事务提交后 dispatcher 才投递 Celery，并允许安全重试。
- Artifact 以 `(task_id, ordinal)` 唯一；Publisher 以 `task_id + target + slot` 幂等，并通过槽位 `version_id` CAS 防止覆盖并发用户修改。该幂等约束只覆盖数据库记录和业务回写，不覆盖对象存储内容。
- 发布前再次检查取消；Artifact、业务回写和任务终态在同一事务提交。

开发期数据允许重置，不设计业务数据回滚。Migration 必须可诊断、按既定顺序前向执行；失败时修复后继续前向迁移或重置开发数据库。对外 API 最终版本不保留旧路由、双写或兼容 DTO。

### 7.4 阶段性不可运行与 Git 提交

允许 P1 至 P5 的阶段提交暂时破坏尚未迁移的调用方，但只允许业务链路不可用，不允许留下语法错误、无法导入的模块或无法执行的 migration。阶段内对必改且暂未闭合的代码使用 `TODO(unified-generation:Pn)`，写明原因；完成该阶段提交前必须移除。跨阶段的已知不可用范围写入计划台账和 commit body，不在生产代码中长期保留临时注释。

每个阶段必须单独提交，提交首行使用项目规定格式，并在 commit body 记录：

- `Temporary-Breakage`：全局唯一的 `Breakage-ID` 及该阶段结束后仍不可用的入口；
- `Restored-By`：负责恢复的后续阶段；
- `Validation-Passed`：本阶段已经通过的检查；
- `Known-Failures`：因明确的阶段依赖而暂不通过的检查，必须引用对应 `Breakage-ID`；
- `Closes-Breakage`：恢复提交关闭的一个或多个 ID。

`Breakage-ID` 使用 `UG-Pn-NNN`，全局唯一且不得复用。历史 commit body 永久保留原始 Temporary-Breakage；D1 检查所有 `Restored-By: P4` 的 ID 已关闭，D2 检查所有后端 ID 已关闭，D3 通过 `opened IDs - closed IDs = ∅` 判断闭合，不要求改写历史提交。

预登记：

- `UG-P1-001`：旧前端 DTO 失效，由 P6 关闭。
- `UG-P2-001`：旧前端渲染/提交链失效，由 P6 关闭。
- `UG-P3-001`：图片执行链未闭合，由 P4 关闭。
- `UG-P3-002`：视频执行链未闭合，由 P4 关闭。
- `UG-P4-001`：媒体前端尚未切换，由 P6 关闭。
- `UG-P5-001`：文本实验室尚未接入 SSE，由 P6 关闭。

禁止使用 `[wip]`。推荐提交：

1. P1：`[refactor] 新增统一生成契约与数据模型`
2. P2：`[refactor] 拆分提示词渲染与流式协议`
3. P3：`[refactor] 接入统一生成提交与任务投递`
4. P4：`[refactor] 迁移图片与视频生成链路`
5. P5：`[refactor] 迁移文本与智能体生成链路`
6. P6：`[refactor] 切换生成前端并清理旧链`

可交付节点：

| 节点 | 阶段 | 必须可用的范围 | 强制验证 |
|---|---|---|---|
| D1 后端媒体链 | P4 | 图片、视频新 API、Worker、Artifact、Publisher | `backend/tests/generation/image/`、`backend/tests/generation/video/`、`backend/tests/generation/migrations/`，OpenAPI 生成；该范围不得列 Known-Failures |
| D2 后端完整链 | P5 | 文本、图片、视频、Agent 后端入口 | `backend/tests/generation/` 与 script-processing 专项测试、真实 SSE 集成测试、OpenAPI 生成；后端 Breakage-ID 必须全部关闭 |
| D3 全栈交付 | P6 | 全部页面、generated client、任务中心与历史采用 | 后端相关测试、`pnpm run openapi:update`、`pnpm exec tsc --noEmit`、前端等价回归 |

D1、D2 是后端可交付节点，不承诺尚未迁移的前端可用；只有 D3 是产品可交付节点。P1、P2、P3 不得单独发布或脱离后续恢复阶段 cherry-pick。

## 8. 实施阶段与文件清单

入口迁移必须维护以下台账。允许在页面切换前删除必要的旧契约，但必须在阶段 commit body 记录不可用范围和恢复阶段；D3 前新入口、Publisher、页面调用和测试必须全部闭合：

| 入口组 | operation | target | delivery | executor | publisher |
|---|---|---|---|---|---|
| 文本实验室 | `text_chat` | experiment session | 前端固定 streaming（hidden，仅实验室）；后端保留 inline / streaming / async 能力 | TextChat / StreamingTextChat | Experiment |
| 图片实验室 | `image_generation` | experiment session | async | ImageGeneration | Experiment |
| 视频实验室 | `video_generation` | experiment session | async | VideoGeneration | Experiment |
| 演员/角色/资产图片 | `image_generation` | asset image slot | async | ImageGeneration | AssetImage |
| 分镜帧 | `image_generation` | shot frame slot | async | ImageGeneration | ShotFrame |
| 镜头视频 | `video_generation` | shot | async | VideoGeneration | ShotVideo |
| 帧提示词 | `text_agent` | shot detail | async | TextAgent | ShotFramePrompt |

`script-processing` 明细固定如下，全部迁移到 async `TextAgentExecutor` 并删除同步重复入口：

| operation | task kind | relation type | 当前使用情况 | 处置 |
|---|---|---|---|---|
| `divide` | `script_divide` | `chapter_division` | 页面使用 | 迁移 |
| `extract` | `script_extract` | `script_extraction` | 页面使用 | 迁移 |
| `check-consistency` | `script_consistency` | `consistency_check` | 页面使用 | 迁移 |
| `analyze-character-portrait` | `script_character_portrait` | `character_portrait_analysis` | 页面使用 | 迁移 |
| `analyze-prop-info` | `script_prop_info` | `prop_info_analysis` | 页面使用 | 迁移 |
| `analyze-scene-info` | `script_scene_info` | `scene_info_analysis` | 页面使用 | 迁移 |
| `analyze-costume-info` | `script_costume_info` | `costume_info_analysis` | 页面使用 | 迁移 |
| `optimize-script` | `script_optimize` | `script_optimization` | 页面使用 | 迁移 |
| `simplify-script` | `script_simplify` | `script_simplification` | 页面使用 | 迁移 |
| `merge-entities` | `script_merge` | `entity_merge` | 无前端预备能力 | 迁移并保留 |
| `analyze-variants` | `script_variant` | `variant_analysis` | 无前端预备能力 | 迁移并保留 |

P5 必须为 `script_merge` 和 `script_variant` 补齐 Executor 与 Worker 注册；如果实现阶段决定不再保留，必须同时删除其同步/异步 API、OpenAPI 类型和测试，不允许留下无 Worker 的预备任务。

### P1：契约与数据模型

- 新增 `backend/app/core/contracts/generation.py`、`text_generation.py`、`media.py`。
- 更新现有 `image_generation.py`、`video_generation.py`，去除 URL/Data URL 作为业务输入的表达。
- 定义路由专用请求、内部 `GenerationCommand`、`ResolvedGenerationSnapshot` 与 operation 判别联合。
- 保留并优化现有视频帧引用和具名主体引用结构。
- 新增不可变 `ModelConfigRevision`、`Model.current_revision_id`、`(model_id, version_id)` 唯一约束，并修改模型配置更新 service/API，使配置变化创建 revision。
- 为可由生成结果写回的槽位增加单调递增 `version_id`，为镜头视频增加 `generated_video_version_id`；为 `GenerationTask` 增加 `visibility = hidden | task_center`、`lease_owner`、`lease_epoch`、`lease_expires_at` 和 `heartbeat_at`。
- 新增 `GenerationArtifact`、`GenerationTaskMediaReference`、`GenerationDispatchOutbox` 模型及 expand migration；本阶段不删除 `GenerationTaskLink.file_id`。

验收：三模态均可用强类型 DTO 表达最终输入；视频主体名称、多图片、多视频和帧槽位可无损往返；外部请求不接受 target/modality/operation/delivery；任何业务请求 DTO 中不存在 URL/Base64 字段；配置 revision、目标 `expected_version_id`、任务 visibility 和 lease 字段可被完整序列化；revision 单调递增且旧任务仍能解析旧 revision。若 OpenAPI 发生变化，本阶段立即运行 `pnpm run openapi:update` 并提交生成结果，前端暂时编译失败可记录为 `UG-P1-001`。

### P2：渲染独立化

- 新增 `backend/app/services/generation/prompts/` 与 `PromptRenderer` registry。
- 将 `studio/generation/{asset_image,frame,video}` 的 preview 逻辑迁入 Renderer。
- 删除 `build_submission` 中对 prompt、guidance、引用的二次派生。
- 新增固定业务资源 render 路由及 generated client；Renderer、target 和 operation 只能由路径 Binder 选择。
- 定义 `StreamingGenerationExecutor`、版本化 SSE 事件和 operation capability 矩阵。
- 扩展 OpenAPI 生成模板/传输层；本阶段只修改 generated runtime/模板，并使用固定 OpenAPI fixture 与 mock stream 验证增量读取和 abort，不生成尚未存在的真实 `/stream` Service 方法。
- 每次 API 变更后运行 `pnpm run openapi:update`，不得推迟到 P6。

验收：Renderer 输出、变量快照和推荐媒体稳定；render body 不能覆盖路径确定的 Renderer/target/operation，错误路径组合被拒绝；generated runtime 可通过固定 OpenAPI fixture 和 mock stream 在首个 delta 到达时增量返回，abort 能关闭 HTTP 流。实际执行文本一致和“提交不调用 Renderer”移到 D1/D2，页面最终值回归移到 D3。

### P3：统一提交、实体门禁与媒体解析

- 新增 `GenerationSubmitter`、`GenerationEntityGate`、`FileResolver`、`GenerationCapabilityRegistry`、`DeliveryAdapter` 和 Outbox dispatcher。
- 移除图片/视频路由中直接 `TaskManager.create()`、Provider 配置拼装和文件下载。
- 所有文件校验、目标校验和模型解析收敛到 Gate；Provider 输入转换后移到 Worker。
- 修改文件删除服务，先检查活动任务引用，再处理数据库与对象存储。
- 实现 streaming lease 领取/续租、带 epoch 的终态 CAS、stale reaper 及其调度入口；reaper 抢占后旧 owner 不得继续发布消息或终态。

验收：不存在、不可访问或关系非法的 `file_id`/target 被统一拒绝；主体分组和帧槽位得到完整校验；不支持的交付组合在副作用前返回 `delivery_unsupported`；任务 payload 不含密钥或 Data URL；broker 暂时不可用时任务可由 Outbox 恢复投递。

### P4：图片与视频执行迁移

- 将 `image_task_runner.py` 和 `generated_video.py` 中的通用生命周期迁入 `backend/app/services/generation/runtime/`。
- 保留并复用 `ImageGenerationTask`、`VideoGenerationTask` 与各 Provider Adapter。
- 实现幂等的 Asset、ShotFrame、ShotVideo、Experiment Publisher 和多产物 ArtifactStore。
- 所有写回可变业务槽位的 Publisher 和历史采用接口使用 `expected_version_id` CAS；实验消息和纯归档 Publisher 不要求虚构槽位版本。冲突时保留 Artifact、记录 `target_version_conflict`，不覆盖当前槽位。
- 为视频能力补充 frame role、关键帧数、总帧引用数限制，禁止 Adapter 静默丢引用。
- 将历史结果查询和采用接口切换为 Artifact 维度，不再依赖 `GenerationTaskLink.file_id/status` 表达单一产物。
- 全部图片、视频 Writer 切换后，通过 contract migration 删除 `GenerationTaskLink.file_id`。

验收：演员、角色、三类资产、实验室图片、分镜帧、实验室视频和镜头视频全部走同一 Submitter/Worker；实际提交不调用 Renderer；具名主体媒体无损传递；多图片产物全部归档并可查询；重复 Worker 投递不产生重复 Artifact 或业务回写；CAS 冲突保留 Artifact 且不覆盖槽位；关闭 `UG-P3-001` 与 `UG-P3-002`。

### P5：文本与 Agent 迁移

- 实现 `TextChatExecutor` 与 `StreamingTextChatExecutor`，让实验室支持固定 JSON、SSE 和异步任务入口。
- 实现 `TextAgentExecutor`，按台账迁移全部 script-processing operation，并补齐 `script_merge`、`script_variant` 的 Executor 与 Worker 注册。
- 删除文本实验室直连 `ChatOpenAI` 的路由实现，以及 script-processing 的同步/异步重复入口。
- 每次 API 变更后同步 OpenAPI 与 generated client。

验收：文本聊天可同步、流式或异步，Agent 可异步；真实 OpenAPI 生成具体 `/stream` Service；首 delta、判别事件、canonical message、hidden visibility、终态、断连取消、lease fencing/reaper 和资源释放符合契约；文本实验室仍只把本次 user message 作为模型输入并原样执行；所有 script-processing operation 逐行闭合；D2 时所有后端 Breakage-ID 已关闭。

### P6：前端、OpenAPI 与清理

- 所有页面切换为新 generated client；更新 `useGenerationDraft`，显式分离渲染快照与可编辑的最终执行输入。
- submit 路径不得调用 Renderer；用户编辑 prompt、帧引用和主体分组后原样提交。
- 删除浏览器端模板渲染、旧 API client、旧页面调用与 Mock 生成逻辑。
- 文本实验室固定调用 generated `/stream` 并在现有 assistant 回复区域增量更新；图片/视频保持 async，不新增 delivery 选择、独立流式页面或第二套文本异步 UI。
- 文本 SSE 只在实验室对话内显示状态和停止操作，不写 `taskUiStore`、不注册全局通知；任务中心 API 与页面只消费 `visibility = task_center` 的异步任务。
- 资产、帧和视频槽位 generated DTO 暴露版本字段；历史采用提交 `{artifact_id, expected_version_id}`，处理成功新版本与 409 冲突，不自动重试。
- 保持 `ChapterStudio` 现有多选、批量 readiness、跳过阻塞项和逐镜头创建任务流程，只迁移 generated API 与 DTO。
- 保留旧实验室 URL 到统一 `/lab` 的现有跳转行为。
- 最终运行 `pnpm run openapi:update` 和生成结果一致性检查。
- 更新当前架构文档，只记录已生效的最终结构；本计划保留在 plans 并标记完成或归档，不将计划原文移入 architecture。

验收：`pnpm exec tsc --noEmit` 通过；generated streaming client 首个 delta 可在现有回复区域显示，accepted/completed canonical message 与历史刷新不重复；实验室内停止立即忽略迟到事件，并行调用任务 cancel API 与终止 HTTP 流；`taskUiStore`、`TaskRuntimeProvider`、全局通知和任务中心均不存在文本 streaming 条目；前端无手写生成 HTTP 调用和浏览器端模板渲染；提交用户编辑内容时 Renderer 调用次数不增加，最终 prompt/media 与实际请求一致；三类实验室、资产详情、`ChapterStudio`、任务中心和历史采用通过等价回归；分镜编辑页与工作室职责保持不变；除既有 URL 跳转外，旧接口、旧 DTO 和隐藏兼容分支不存在；所有 Breakage-ID 已关闭。

## 9. 测试策略与完成标准

### 后端单元测试

- 每个 PromptRenderer 的变量快照、推荐媒体引用和最终 prompt。
- GenerationEntityGate 的 target、slot、model、file、项目关系、帧槽位和主体分组错误分支。
- FileResolver 对图片、视频、不可用文件与 Provider 转换的覆盖。
- 三个 DeliveryAdapter 的返回、能力拒绝与错误语义。
- SSE accepted/delta/progress/terminal 事件顺序、单一终态和断连取消。
- Text/Image/Video Executor 的 Provider/Agent 适配测试。
- 每个 Publisher 的多产物、成功、失败、取消和重复投递回写。
- `publish_status / publish_error` 的主产物、冲突、非主产物、无槽位和技术异常 CHECK。
- Publisher 与历史采用的 `version_id` CAS、冲突不覆盖和版本单调递增。
- `ModelConfigRevision` 的唯一约束、版本单调性、旧任务解析旧 revision 和凭据轮换。
- streaming lease 超时后的 stale reaper、epoch fencing 与终态收敛；reaper 抢占后旧 owner 的迟到 completed 不得改写任务或消息。

### API 与集成测试

- 资产、分镜、实验室和 script-processing 的全链路提交。
- 预览文本与实际执行文本一致，以及用户编辑后原样执行。
- 本地上传 → file_id → 分组提交 → Worker 转换 → 产物回写。
- 具名主体中多图片、多视频的顺序、归组和 Provider 能力拒绝。
- SSE API/generated transport 的首个 delta 可在文本实验室现有回复区域增量显示；accepted/completed 与历史刷新交错时 canonical user/assistant 不重复，相同 prompt 的连续两轮不误合并。
- Provider error、用户停止、网络断连和 lease timeout 后只保留 canonical user message，不出现空 assistant 或错误气泡。
- cancel API 超时或失败时，点击停止后 UI 立即停止追加 delta；abort/completed 竞争只接受一个终态，旧 generation token 的事件不得污染新会话。
- 文本 streaming `task_id` 可由实验室取消，但不会出现在任务列表、任务中心、`taskUiStore` 或全局任务通知。
- 两个页面持有同一槽位版本时，第一个采用成功，第二个旧版本采用返回 409 且不覆盖、不自动重试；普通槽位和镜头视频版本均覆盖。
- 异步任务刷新恢复、取消、失败、重复投递和多图结果展示。
- broker 投递失败后的 Outbox 重试，以及取消与迟到成功竞争。
- 每类 `async_polling` target 在任务中心的列表出现、当前页高亮和回跳映射，并反向断言 streaming 记录被后端列表过滤。
- 外部 URL 导入的私网地址、重定向、超限内容和伪造媒体类型拒绝。
- 任务 payload 中不出现密钥、Data URL 和 `storage_key`。

### 最终完成条件

1. 所有生成入口均经 `GenerationSubmitter`。
2. 不存在生成阶段二次渲染提示词的代码路径。
3. 不存在业务 API 传递 URL/Base64 的媒体引用。
4. 视频帧和具名主体媒体分组可无损保存、校验和执行。
5. operation capability 明确约束可用交付方式；SSE 使用类型化事件和 generated streaming client。
6. 业务结果回写全部由 Publisher 完成，通用 Worker 中不存在按业务 `relation_type` 的回写分支。
7. 异步创建、投递、Artifact、FileItem 数据库记录和 Publisher 具备数据库幂等与崩溃恢复语义；槽位发布使用单调 `version_id` CAS，对象存储幂等不在完成条件内。
8. OpenAPI、generated client、相关架构文档和测试同步完成。
9. 前端现有功能通过等价回归；文本回复和停止只存在于实验室对话，任务中心仍只展示异步任务，未新增 delivery 选择、独立页面、页面职责或任务中心能力。
10. P1 至 P6 均有独立 Git 提交；D3 验收时不存在 `TODO(unified-generation:` 临时注释，且所有 Temporary-Breakage ID 都有对应的 `Closes-Breakage`。

## 10. 风险与处理原则

- **文本 Agent 输出差异**：保留专用 operation DTO 与 Publisher，不将结构化结果退化为字符串。
- **供应商能力差异**：留在 Image/Video Executor 和 Provider Adapter，不进入实体门禁。
- **媒体语义丢失**：帧槽位与具名主体使用强类型父结构，叶子 file_id 不承担分组语义。
- **异步引用文件删除**：通过活动 `GenerationTaskMediaReference`、删除前锁定和版本快照保护待执行引用。
- **SSE 断连与迟到结果**：使用隐藏运行记录、lease、stale reaper、单一终态、断连取消和发布前取消检查；不进入任务中心。
- **重复投递与部分提交**：通过 Outbox、Artifact 唯一约束、Publisher 幂等键和目标槽位 `version_id` CAS 恢复。
- **外部 URL 导入**：限制协议、地址范围、重定向、大小和媒体类型，防止 SSRF 与资源耗尽。
- **过大改动面**：按 P1 至 P6 分解研发和测试，允许已记录的阶段性不可运行；每阶段独立提交，D1/D2 验证后端范围，D3 恢复全栈并清零临时注释、旧路由、双写和旧 payload。

## 11. 执行状态

本计划已于 2026-07-28 完成 P1 至 P6 的实现与交付核验。当前架构事实已同步至
`architecture` 文档；本文件保留为已完成的实施记录。最终交付不再暴露旧图片、视频
实验室或图片任务 HTTP 入口，前端 generated client、OpenAPI 与文本流式、图片、视频及
Agent 的统一提交链保持一致。
