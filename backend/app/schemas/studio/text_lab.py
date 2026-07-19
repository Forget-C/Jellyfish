"""文本生成实验室的请求与响应契约。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TextLabMessage(BaseModel):
    """实验会话中的一条文本消息。"""

    role: Literal["system", "user", "assistant"] = Field(..., description="消息角色")
    content: str = Field(..., min_length=1, description="消息内容")


class TextLabGenerateRequest(BaseModel):
    """提交一轮文本实验，并指定本轮使用的已登记文本模型。"""

    model_id: str = Field(..., min_length=1, description="已登记的文本模型 ID")
    messages: list[TextLabMessage] = Field(..., min_length=1, description="按顺序传递的会话历史")


class TextLabGenerateResponse(BaseModel):
    """文本模型完成一轮调用后返回的标准结果。"""

    model_id: str = Field(..., description="实际调用的文本模型 ID")
    content: str = Field(..., description="模型回复文本")
