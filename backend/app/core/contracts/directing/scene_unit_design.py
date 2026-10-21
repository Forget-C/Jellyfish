"""单元组织任务只产生可审阅的执行方案，不包含指令确认或媒体采用。"""
from datetime import datetime

from pydantic import Field, model_validator

from app.core.contracts.directing.common import Contract, Identity, Text, unique
from app.core.contracts.directing.scene_version import EditableCoverageItem, SceneVersionContent


class SceneUnitDesignRequest(Contract):
    """冻结当前编辑、目标镜头及视频模型；model_id 单独指定组织文本模型。"""

    request_id: Identity
    expected_revision: int = Field(gt=0)
    content: SceneVersionContent
    shot_id: Identity
    source_unit_id: Identity | None = None
    target_model_id: Identity
    model_id: Identity | None = None
    instruction: str = Field(default='', max_length=12000)


class SceneUnitDesignProposal(Contract):
    """仅允许组织字段；参考要求与衔接描述均不构成真实文件或落幅绑定。"""

    id: Identity
    coverage: list[EditableCoverageItem] = Field(min_length=1)
    duration_ms: int | None = Field(default=None, gt=0)
    ratio: str
    reason: Text
    entry_state: str | None = None
    exit_state: str | None = None
    reference_requirements: list[str] | None = None
    missing: list[str] = Field(default_factory=list)


class SceneUnitDesignResult(Contract):
    """当前镜头的完整单元组织建议，身份和执行选择由服务端整体校验。"""

    shot_id: Identity
    target_model_id: Identity
    organization: Text
    units: list[SceneUnitDesignProposal] = Field(min_length=1)
    missing: list[str] = Field(default_factory=list)

    @model_validator(mode='after')
    def identities(self):
        """重复单元或出现项会使差异和后续应用含混，整份拒绝。"""
        unique([unit.id for unit in self.units], '建议单元')
        for unit in self.units:
            unique([item.id for item in unit.coverage], '建议覆盖项')
        return self


class SceneUnitDesignPreviewRequest(Contract):
    """预览时携带当前编辑内容；不保存内容。"""

    content: SceneVersionContent


class SceneUnitDesignSuggestionRead(Contract):
    """任务固定依据与类型化结果；未完成任务不伪装成空方案。"""

    task_id: Identity
    request_id: Identity
    created_at: datetime
    status: str
    error: str | None
    request: SceneUnitDesignRequest
    target_model_name: str
    text_model_name: str
    capabilities: dict
    result: SceneUnitDesignResult | None


class SceneUnitDesignPreview(Contract):
    """校验后的只读方案；明确应用由独立用户动作完成。"""

    task_id: Identity
    result: SceneUnitDesignResult
