"""导演工作单共用身份、来源与未知信息，避免自由 JSON 丢失语义。"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Identity = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")]
Text = Annotated[str, Field(min_length=1, pattern=r"\S")]
Role = Literal["direction", "performance", "staging", "cinematography", "continuity", "prompt"]
ROLES = ("direction", "performance", "staging", "cinematography", "continuity", "prompt")


class Contract(BaseModel):
    """禁止未定义字段和隐式数值转换；写入时重新验证整个文档。"""

    model_config = ConfigDict(extra="forbid", strict=True)


class MediaRange(Contract):
    """实际媒体毫秒区间，不接受预计时长字段。"""

    source_in_ms: int = Field(ge=0)
    source_out_ms: int = Field(gt=0)

    @model_validator(mode="after")
    def ordered(self):
        """拒绝空区间及反向区间。"""
        if self.source_out_ms <= self.source_in_ms:
            raise ValueError("source_out_ms must exceed source_in_ms")
        return self


class Source(Contract):
    """来源可指向人工记录、原文版本或带时间码的文件。"""

    kind: Literal["human", "chapter", "model", "file", "revision"]
    reference: Text
    version: Text
    file_id: Identity | None = None
    media_range: MediaRange | None = None

    @model_validator(mode="after")
    def evidence(self):
        """媒体时间码必须附着于明确文件。"""
        if self.kind == "file" and self.file_id is None:
            raise ValueError("file source requires file_id")
        if self.media_range is not None and self.file_id is None:
            raise ValueError("media evidence requires file_id")
        return self


class Note(Contract):
    """区分未知、未填写、不适用、明确无、事实和创作提议。确认由服务另记。"""

    state: Literal["unset", "unknown", "not_applicable", "none", "fact", "proposal"] = "unset"
    text: Text | None = None
    reason: Text | None = None
    sources: list[Source] = Field(default_factory=list)

    @model_validator(mode="after")
    def semantics(self):
        """已知内容要有来源，空白不能被误当作通过或明确为无。"""
        if self.state in ("fact", "proposal") and (self.text is None or not self.sources):
            raise ValueError("fact/proposal requires text and sources")
        if self.state in ("not_applicable", "none") and self.reason is None:
            raise ValueError("not_applicable/none requires reason")
        if self.state not in ("fact", "proposal") and self.text is not None:
            raise ValueError("non-content state cannot carry text")
        return self


def unique(values, label: str) -> None:
    """校验局部稳定身份，重复时拒绝整份文档。"""
    if len(values) != len(set(values)):
        raise ValueError(f"duplicate {label}")


def references(values, allowed, label: str) -> None:
    """禁止跨设计版本或未知局部 ID。"""
    if not set(values) <= set(allowed):
        raise ValueError(f"unknown {label}: {set(values) - set(allowed)}")
