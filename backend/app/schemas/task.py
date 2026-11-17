"""任务通用查询契约；业务输入与调试信息不进入任务中心列表。"""

from pydantic import BaseModel, Field

from app.core.contracts.task import TaskStatus
from app.core.contracts.generation_delivery import GenerationDeliveryResult


class TaskStatusRead(BaseModel):
    """任务主表的轻量运行视图。"""

    task_id: str
    status: TaskStatus
    stage: str
    progress: int | None = Field(None, ge=0, le=100)
    cancel_requested: bool = False
    cancel_requested_at_ts: float | None = None
    started_at_ts: float | None = None
    finished_at_ts: float | None = None
    elapsed_ms: int | None = None


class TaskSourceRead(BaseModel):
    """已经确认存在的业务来源，供前端构造回跳路径。"""

    kind: str
    id: str
    title: str
    project_id: str | None = None
    chapter_id: str | None = None
    version_id: str | None = None
    unit_id: str | None = None
    shot_id: str | None = None
    sequence_id: str | None = None
    canvas_id: str | None = None
    run_id: str | None = None
    node_id: str | None = None
    check_card_id: str | None = None
    check_report_id: str | None = None


class TaskListItemRead(TaskStatusRead):
    """任务中心只展示通用任务信息及唯一来源。"""

    source: TaskSourceRead | None = None
    task_kind: str
    title: str
    target_type: str | None = None
    target_id: str | None = None
    project_id: str | None = None
    created_at_ts: float
    updated_at_ts: float


class TaskPageRead(BaseModel):
    """以创建时间和 ID 游标翻页，避免新任务插入造成历史页偏移。"""

    items: list[TaskListItemRead]
    next_cursor: str | None = None


class TaskOutputRead(BaseModel):
    """已保存的媒体输出，字节删除后仍保留文件身份供历史查询。"""

    ordinal: int
    file_id: str
    media_type: str
    delivery_status: str | None = None
    delivery_reason: str | None = None
    deleted: bool = False


class TaskResultRead(TaskStatusRead):
    """业务面板按需查询结果，媒体结果由输出关系生成，不复制到任务 JSON。"""

    result: dict | None = None
    outputs: list[TaskOutputRead] = Field(default_factory=list)
    generation_delivery: GenerationDeliveryResult | None = None
    error: str = ""
    error_code: str | None = None


class TaskCancelRequest(BaseModel):
    """用户发起取消时可附带简短原因。"""

    reason: str | None = Field(None, max_length=255)


class TaskCancelRead(BaseModel):
    """取消结果直接反映服务裁决后的任务状态。"""

    task_id: str
    status: TaskStatus
    cancel_requested: bool
    cancel_requested_at_ts: float | None = None
    effective_immediately: bool = False


class TaskOutputHistoryRead(TaskOutputRead):
    """业务面板的生成历史条目，身份由任务和输出序号组成。"""

    task_id: str
    created_at_ts: float


class TaskOutputPageRead(BaseModel):
    """按任务创建顺序和输出序号翻页的媒体历史。"""

    items: list[TaskOutputHistoryRead]
    next_cursor: str | None = None


class ActorImageParametersRead(BaseModel):
    """当前演员图片的历史生成参数；只投影已保存的公开字段。"""

    task_id: str
    created_at_ts: float
    model_name: str | None = None
    view_angle: str | None = None
    reference_count: int | None = None
    execution_prompt: str | None = None
    parameters: dict[str, str] = Field(default_factory=dict)
