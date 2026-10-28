"""生成画布静态目录：值种类与内容模态分开，运行能力由模型接口提供。"""
from typing import Literal
from pydantic import BaseModel, ConfigDict

CanvasValueKind = Literal['text', 'image', 'video', 'audio', 'object_reference', 'anchor', 'blocking', 'beat', 'event', 'shot', 'dialogue', 'criterion']


class CanvasDesignFieldDefinition(BaseModel):
    """稳定字段标识用于素材定位，不开放任意 JSON 路径。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    label: str


class CanvasInputPortDefinition(BaseModel):
    """候选入口及明确允许的值种类；连线仍不表示采用。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    label: str
    relation: Literal['generation_input', 'business_reference', 'material_association']
    accepts: list[CanvasValueKind]


class CanvasOutputPortDefinition(BaseModel):
    """明确出口及采用单位，动态范围继续由实例输出声明。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    label: str
    value_kind: CanvasValueKind
    adoption: Literal['whole_card', 'declared_scope', 'object', 'item']


class CanvasCardTypeDefinition(BaseModel):
    """系统卡片类型的展示与端点声明，不包含供应商能力或执行状态。"""
    model_config = ConfigDict(extra='forbid')
    type: str
    type_version: Literal[1] = 1
    title: str
    group: Literal['基础内容', '模型生成', '导演工具箱']
    category: Literal['画面设计', '表演与调度', '叙事与镜头', '声音设计', '连续性与约束'] | None = None
    modality: Literal['text', 'image', 'video', 'audio']
    inputs: list[CanvasInputPortDefinition]
    outputs: list[CanvasOutputPortDefinition]
    fields: list[CanvasDesignFieldDefinition]
    entries: list[CanvasDesignFieldDefinition]


class CanvasCatalog(BaseModel):
    """当前应用版本的权威类型目录；不随画布编辑修订变化。"""
    model_config = ConfigDict(extra='forbid')
    version: Literal[1] = 1
    cards: list[CanvasCardTypeDefinition]
