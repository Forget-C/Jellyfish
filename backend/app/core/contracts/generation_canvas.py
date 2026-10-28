"""跨层画布输入输出值契约，不包含运行编排或存储行为。"""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_serializer


class OutputIdentity(BaseModel):
    """稳定输出位置不等于历史产物 ID；不得按文件合并来源。"""
    model_config = ConfigDict(extra='forbid')
    canvas_id: str
    card_id: str
    port_id: str
    position: int = Field(ge=0)
    object_id: str | None = None

    @model_serializer(mode='wrap')
    def serialize_identity(self, handler):
        """旧输出身份不写空选择器，保持原始引用、结果依据与哈希语义。"""
        value = handler(self)
        if self.object_id is None:
            value.pop('object_id', None)
        return value



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
    subject_name: str | None = None


class ObjectReferencePayload(BaseModel):
    """关系出口只携带对象身份，不传递描述、媒体或祖先内容。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['object_reference'] = 'object_reference'
    object_id: str
    name: str
    category: Literal['character', 'prop', 'costume', 'place']


class DescriptionTextPayload(BaseModel):
    """描述出口保留本卡对象与来源信息；模型只展开正文。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['description'] = 'description'
    object_id: str | None
    name: str
    category: Literal['character', 'prop', 'costume', 'place']
    text: str
    source_locator: str


class NamedImageObject(BaseModel):
    """名称、身份与图内定位；绝不携带描述或穿着动作。"""
    model_config = ConfigDict(extra='forbid')
    object_id: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    name: str = Field(default='', max_length=255)
    category: Literal['character', 'prop', 'costume', 'place']
    position: str = ''


class ReferenceImageBinding(BaseModel):
    """固定具体文件及直接来源产物；无画布来源即项目文件选择。"""
    model_config = ConfigDict(extra='forbid')
    file_id: str = Field(min_length=1, max_length=36)
    source: OutputIdentity | None = None
    result_set_id: str | None = None


class NamedImagePayload(BaseModel):
    """图片出口自含默认名称映射，无需接收端读取祖先。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['named_image'] = 'named_image'
    file_id: str
    objects: list[NamedImageObject] = Field(default_factory=list)
    angle: str


class CanvasSourceMapping(BaseModel):
    """本地代号对应的直接来源和实际媒体序号。"""
    model_config = ConfigDict(extra='forbid')
    token: str
    source: OutputIdentity
    media_position: int | None


class NamedImageMapping(NamedImageObject):
    """编译预览中可核对的对象到实际提交图片映射。"""
    media_position: int = Field(ge=1)
    angle: str
