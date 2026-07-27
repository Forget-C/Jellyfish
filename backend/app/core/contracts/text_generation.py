"""文本生成与 Agent operation 的强类型输入契约。"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class TextChatMessage(BaseModel):
    """单轮文本聊天的有序消息；不以空 prompt 伪造聊天上下文。"""

    model_config = ConfigDict(extra="forbid")

    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)
    sequence: int = Field(ge=1)


class TextChatInput(BaseModel):
    """文本聊天 operation 的输入。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["text_chat"] = "text_chat"
    messages: list[TextChatMessage] = Field(min_length=1)


class ScriptOperationInput(BaseModel):
    """剧本 Agent 的强类型入口基类，保留 operation 而不是退化为任意字典。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["script_operation"] = "script_operation"
    operation: Literal[
        "divide", "extract", "check-consistency", "analyze-character-portrait",
        "analyze-prop-info", "analyze-scene-info", "analyze-costume-info",
        "optimize-script", "simplify-script", "merge-entities", "analyze-variants",
    ]
    source_text: str = Field(min_length=1)


TypedTextOperationInput = Annotated[TextChatInput | ScriptOperationInput, Field(discriminator="kind")]
