"""旧摄影历史输出的只读结构，以及接收图片的独立画面目标契约。"""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from app.core.contracts.generation_canvas import CriterionReferencePayload, DesignField, DesignScope, ObjectReferencePayload, FrameState, NarrativeReferencePayload


PhotographyFieldKey = Literal['shot_size', 'composition', 'frame_position', 'depth_layers', 'negative_space', 'composition_requirements', 'viewpoint', 'position', 'height_angle', 'lens_effect', 'support', 'movement_type', 'movement_start', 'movement_trigger', 'movement_path', 'movement_speed', 'end_frame', 'light_sources', 'light_direction', 'light_regions', 'exposure_color', 'color_relationship', 'depth_focus', 'focus_change', 'optical_effects', 'motion_texture', 'technical_parameters', 'adjacent_requirements', 'prohibitions']


class PhotographyFramingField(DesignField):
    """仅已知景别结构可比较；自由文字不解释为硬要求。"""
    size: Literal['extreme_close_up', 'close_up', 'medium', 'full', 'wide', 'extreme_wide'] | None = None
    target_id: str = ''
    state_id: str | None = None


class PhotographyRequirement(BaseModel):
    """显式目标和状态上的单值景别要求。"""
    model_config = ConfigDict(extra='forbid')
    entry_id: str
    field: PhotographyFramingField


class PhotographyFields(BaseModel):
    """单一内容所有者保留全部摄影字段；静态字段身份由枚举键固定。"""
    model_config = ConfigDict(extra='forbid')
    shot_size: PhotographyFramingField = Field(default_factory=PhotographyFramingField)
    composition: DesignField = Field(default_factory=DesignField)
    frame_position: DesignField = Field(default_factory=DesignField)
    depth_layers: DesignField = Field(default_factory=DesignField)
    negative_space: DesignField = Field(default_factory=DesignField)
    composition_requirements: DesignField = Field(default_factory=DesignField)
    viewpoint: DesignField = Field(default_factory=DesignField)
    position: DesignField = Field(default_factory=DesignField)
    height_angle: DesignField = Field(default_factory=DesignField)
    lens_effect: DesignField = Field(default_factory=DesignField)
    support: DesignField = Field(default_factory=DesignField)
    movement_type: DesignField = Field(default_factory=DesignField)
    movement_start: DesignField = Field(default_factory=DesignField)
    movement_trigger: DesignField = Field(default_factory=DesignField)
    movement_path: DesignField = Field(default_factory=DesignField)
    movement_speed: DesignField = Field(default_factory=DesignField)
    end_frame: DesignField = Field(default_factory=DesignField)
    light_sources: DesignField = Field(default_factory=DesignField)
    light_direction: DesignField = Field(default_factory=DesignField)
    light_regions: DesignField = Field(default_factory=DesignField)
    exposure_color: DesignField = Field(default_factory=DesignField)
    color_relationship: DesignField = Field(default_factory=DesignField)
    depth_focus: DesignField = Field(default_factory=DesignField)
    focus_change: DesignField = Field(default_factory=DesignField)
    optical_effects: DesignField = Field(default_factory=DesignField)
    motion_texture: DesignField = Field(default_factory=DesignField)
    technical_parameters: DesignField = Field(default_factory=DesignField)
    adjacent_requirements: DesignField = Field(default_factory=DesignField)
    prohibitions: DesignField = Field(default_factory=DesignField)


class PhotographyPhase(BaseModel):
    """明确的运镜阶段；重命名与重排不改变被采用的阶段身份。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    name: str = ''
    frame: DesignField = Field(default_factory=DesignField)


class PhotographyAdoptionScope(BaseModel):
    """来源声明的完整、区域、字段或阶段选择，不支持任意 JSON 路径。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    label: str
    kind: Literal['whole', 'region', 'field', 'phase']


class PhotographyEntry(BaseModel):
    """输出中的字段状态和用途；仅被采用范围中的条目进入生成依据。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    label: str
    region: Literal['composition', 'camera', 'movement', 'lighting', 'focus']
    value: DesignField


class ImageFrameTarget(BaseModel):
    """目标属于接收图片配置；不改变采用记录或删除设计字段。"""
    model_config = ConfigDict(extra='forbid')
    binding_id: str
    state_id: str


class PhotographyObjectUse(BaseModel):
    """对象关系保留明确用途；焦点与关注对象只跟随相应采用区域。"""
    model_config = ConfigDict(extra='forbid')
    input_port: Literal['effect_object', 'attention_object', 'focus_object']
    object: ObjectReferencePayload


class PhotographyTextPayload(BaseModel):
    """本卡发布的摄影文本与可采用范围，不包含示例文件或祖先正文。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['photography'] = Field(default='photography', json_schema_extra={'enum': ['photography']})
    text: str
    requirements: list[PhotographyRequirement] = Field(default_factory=list)
    entries: list[PhotographyEntry]
    adoption_scopes: list[PhotographyAdoptionScope]
    frame_states: list[FrameState] = Field(default_factory=list)
    requires_frame_target: bool = False
    scope: DesignScope
    object_uses: list[PhotographyObjectUse] = Field(default_factory=list)
    objects: list[ObjectReferencePayload] = Field(default_factory=list)
    shot: NarrativeReferencePayload | None = Field(default=None, exclude_if=lambda value: value is None)
    source_locator: str = ''
    acceptance_basis: list[CriterionReferencePayload] = Field(default_factory=list, exclude_if=lambda value: not value)
