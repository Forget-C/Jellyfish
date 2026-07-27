"""统一生成流程的媒体引用契约。

业务层只保存 ``FileItem`` 标识和语义分组；URL、Data URL 与供应商文件标识
只能由执行期的 FileResolver 生成，避免进入 API 与任务 payload。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


MediaKind = Literal["image", "video"]


class MediaReference(BaseModel):
    """不可再拆分的媒体叶子引用，ordinal 仅表达同组内稳定顺序。"""

    model_config = ConfigDict(extra="forbid")

    file_id: str = Field(min_length=1)
    media_kind: MediaKind
    ordinal: int = Field(default=0, ge=0)


class ImageMediaInput(BaseModel):
    """图片生成的参考媒体集合。"""

    model_config = ConfigDict(extra="forbid")

    references: list[MediaReference] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_image_references(self) -> "ImageMediaInput":
        """拒绝把视频引用混入图片 operation，保持 Provider 前的类型边界。"""
        if any(reference.media_kind != "image" for reference in self.references):
            raise ValueError("image media only accepts image references")
        return self


class VideoFrameMediaReferences(BaseModel):
    """视频帧槽位，保留首帧、尾帧和关键帧的时间语义。"""

    model_config = ConfigDict(extra="forbid")

    first: MediaReference | None = None
    last: MediaReference | None = None
    keys: list[MediaReference] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_image_frames(self) -> "VideoFrameMediaReferences":
        """帧槽位只能引用图片，避免把视频错误映射为构图帧。"""
        references = [reference for reference in [self.first, self.last] if reference] + self.keys
        if any(reference.media_kind != "image" for reference in references):
            raise ValueError("video frame references must be images")
        return self


class VideoSubjectMediaReference(BaseModel):
    """命名主体及其有序参考媒体，供支持 @主体 的 Provider 使用。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    media: list[MediaReference] = Field(default_factory=list)

    @model_validator(mode="after")
    def normalize_and_validate(self) -> "VideoSubjectMediaReference":
        """规范主体名并确保组内 ordinal 唯一，防止执行期丢失素材顺序。"""
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("subject name must not be blank")
        if not self.media:
            raise ValueError("subject requires at least one media reference")
        ordinals = [reference.ordinal for reference in self.media]
        if len(ordinals) != len(set(ordinals)):
            raise ValueError("subject media ordinals must be unique")
        return self


class VideoMediaInput(BaseModel):
    """视频参考媒体：帧槽位与命名主体分组必须独立保存。"""

    model_config = ConfigDict(extra="forbid")

    frames: VideoFrameMediaReferences = Field(default_factory=VideoFrameMediaReferences)
    subjects: list[VideoSubjectMediaReference] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_unique_subject_names(self) -> "VideoMediaInput":
        """按规范化名称去重，避免 Provider 的 @name 语义发生歧义。"""
        names = [subject.name.casefold() for subject in self.subjects]
        if len(names) != len(set(names)):
            raise ValueError("subject names must be unique")
        return self
