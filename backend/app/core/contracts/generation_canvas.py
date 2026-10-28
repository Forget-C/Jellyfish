"""跨层画布输入输出值契约，不包含运行编排或存储行为。"""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class OutputIdentity(BaseModel):
    """稳定输出位置不等于历史产物 ID；不得按文件合并来源。"""
    model_config = ConfigDict(extra='forbid')
    canvas_id: str
    card_id: str
    port_id: str
    position: int = Field(ge=0)



class TextOutputPayload(BaseModel):
    """已声明的正文出口，不包含来源卡的其他字段。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['text'] = 'text'
    text: str


class MediaOutputPayload(BaseModel):
    """明确媒体引用，禁止由正文或名称猜测内容。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['image', 'video', 'audio']
    file_id: str



class InputBinding(BaseModel):
    """接收端明确采用的唯一来源记录，提示词通过身份引用它。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1)
    source: OutputIdentity
    input_port: str
