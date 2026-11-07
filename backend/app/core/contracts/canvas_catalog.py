"""生成画布静态目录：值种类与内容模态分开，运行能力由模型接口提供。"""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

from app.core.contracts.generation_canvas import DesignField

CanvasValueKind = Literal['text', 'image', 'video', 'audio', 'object_reference', 'anchor', 'blocking', 'beat', 'event', 'shot', 'dialogue', 'criterion', 'check_basis']


class CanvasDesignFieldDefinition(BaseModel):
    """稳定字段标识用于素材定位，不开放任意 JSON 路径。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    label: str
    default_value: DesignField = Field(default_factory=DesignField)


class CanvasInputPortDefinition(BaseModel):
    """接收端点及允许的值种类；连线生效语义由公开连接策略声明。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    label: str
    relation: Literal['generation_input', 'business_reference', 'material_association', 'observation']
    accepts: list[CanvasValueKind]
    max_sources: int | None = None


class CanvasOutputPortDefinition(BaseModel):
    """明确出口及采用单位，动态范围继续由实例输出声明。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    label: str
    value_kind: CanvasValueKind
    adoption: Literal['whole_card', 'declared_scope', 'object', 'item', 'observation']


class CanvasCardTypeDefinition(BaseModel):
    """系统卡片类型的展示与端点声明，不包含供应商能力或执行状态。"""
    model_config = ConfigDict(extra='forbid')
    type: str
    type_version: Literal[1] = 1
    title: str
    group: Literal['基础内容', '模型生成', '导演工具箱']
    category: Literal['画面设计', '表演与调度', '叙事与镜头', '声音设计', '连续性与约束', '检查'] | None = None
    modality: Literal['text', 'image', 'video', 'audio']
    inputs: list[CanvasInputPortDefinition]
    outputs: list[CanvasOutputPortDefinition]
    fields: list[CanvasDesignFieldDefinition]
    entries: list[CanvasDesignFieldDefinition]


class CanvasConnectionPolicy(BaseModel):
    """一个兼容端点组合的连接与解除语义；多用途必须明确采用。"""
    model_config = ConfigDict(extra='forbid')
    source_type: str
    source_port: str
    target_type: str
    target_port: str
    adoption_allowed: bool
    connect: Literal['candidate', 'adopt_design', 'associate_acceptance']
    cancel: Literal['keep_connection', 'remove_connection']
    disconnect: Literal['protect', 'release', 'confirm_frame']
    message: str


class CanvasCatalog(BaseModel):
    """当前应用版本的权威类型目录；不随画布编辑修订变化。"""
    model_config = ConfigDict(extra='forbid')
    version: Literal[1] = 1
    cards: list[CanvasCardTypeDefinition]
    connection_policies: list[CanvasConnectionPolicy]
