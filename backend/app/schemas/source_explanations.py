"""与章节正文分开维护的原意解释。"""
import json
from hashlib import sha256
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


SOURCE_POLICY_VERSION = 2


class SourceExplanation(BaseModel):
    """空摘录表示全章解释；版本匹配后才可被任务采用。"""
    model_config = ConfigDict(extra='forbid')
    policy_version: int | None = Field(default=None, ge=1, exclude_if=lambda value: value is None)
    kind: Literal['explanation', 'normal'] = 'explanation'
    id: str = Field(min_length=1, max_length=64)
    excerpt: str = ''
    start: int | None = Field(default=None, ge=0, exclude_if=lambda value: value is None)
    end: int | None = Field(default=None, ge=0, exclude_if=lambda value: value is None)
    text: str = Field(min_length=1, max_length=10000)
    source_version: str = Field(pattern=r'^(?:[0-9a-f]{64})?$')


def chapter_basis_version(text: str, items: list[dict] | None) -> str:
    """包含待复核条目的编辑基线，用于避免并发覆盖。"""
    return sha256(json.dumps([text, items or []], ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
