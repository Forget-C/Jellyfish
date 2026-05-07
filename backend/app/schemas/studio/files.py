"""文件素材相关的 Pydantic Schemas。"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class FileTypeEnum(str, Enum):
    image = "image"
    video = "video"


class FileBase(BaseModel):
    id: str = Field(..., description="文件 ID")
    type: FileTypeEnum = Field(..., description="文件类型")
    name: str = Field(..., description="文件名/标题")
    thumbnail: str = Field("", description="缩略图 URL/路径")
    tags: list[str] = Field(default_factory=list, description="标签")


class FileCreate(BaseModel):
    type: FileTypeEnum
    name: str
    thumbnail: str = ""
    tags: list[str] = Field(default_factory=list)


class FileUsageWrite(BaseModel):
    """写入 file_usages 的关联信息（与 FileItem 一并提交）。"""

    project_id: str = Field(..., description="项目 ID")
    chapter_id: str | None = Field(None, description="章节 ID")
    shot_id: str | None = Field(None, description="镜头 ID")
    usage_kind: str = Field(
        ...,
        description=(
            "用途：shot_frame / generated_video / chapter_master_video / "
            "character_image / asset_image / upload / api 等"
        ),
    )
    source_ref: str | None = Field(None, description="幂等键（可选）")


class FileUsageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    file_id: str
    project_id: str
    chapter_id: str | None
    shot_id: str | None
    usage_kind: str
    source_ref: str

class FileUpdate(BaseModel):
    name: str | None = None
    thumbnail: str | None = None
    tags: list[str] | None = None
    usage: FileUsageWrite | None = Field(None, description="若提供则 upsert 一条 file_usages")


class FileRead(FileBase):
    model_config = ConfigDict(from_attributes=True)


class FileDetailRead(FileRead):
    """含 file_usages 列表（详情接口）。"""

    model_config = ConfigDict(from_attributes=True)

    usages: list[FileUsageRead] = Field(default_factory=list)
