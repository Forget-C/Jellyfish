"""接收图片的独立画面目标契约。"""
from pydantic import BaseModel, ConfigDict


class ImageFrameTarget(BaseModel):
    """目标属于接收图片配置；不改变采用记录或删除设计字段。"""
    model_config = ConfigDict(extra='forbid')
    binding_id: str
    state_id: str
