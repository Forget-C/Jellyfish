"""文件素材相关的 Pydantic Schemas。"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class FileTypeEnum(str, Enum):
    image = "image"
    video = "video"
    audio = "audio"


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

    usage_kind: str = Field(
        ...,
        description="用途：directing_reference / directing_take / generated_video / character_image / asset_image / upload / api 等",
    )
    source_ref: str | None = Field(None, description="幂等键（可选）")


class FileUsageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    file_id: str
    project_id: str | None
    chapter_id: str | None

    usage_kind: str
    source_ref: str

class FileUpdate(BaseModel):
    """仅允许修改显示名称、标签与使用位置，禁止替换文件内容或对象地址。"""

    model_config = ConfigDict(extra="forbid")
    name: str | None = None
    tags: list[str] | None = None
    usage: FileUsageWrite | None = Field(None, description="若提供则 upsert 一条 file_usages")


class FileRead(FileBase):
    """文件身份保持稳定，缩略图地址在读时生成，不持久化重复 URL。"""

    model_config = ConfigDict(from_attributes=True)
    deleted: bool = False

    @model_validator(mode="before")
    @classmethod
    def project_file(cls, value):
        """将文件存储字段投影为用户可访问的地址，删除后仍可查看文件元信息。"""
        if isinstance(value, dict):
            return value
        deleted = value.deleted_at is not None or value.delete_requested_at is not None
        thumbnail = ""
        if not deleted:
            if value.thumbnail_key:
                from app.core.storage import _build_public_url
                thumbnail = _build_public_url(value.thumbnail_key)
            elif value.type == "image":
                thumbnail = f"/api/v1/studio/files/{value.id}/download"
        return {"id": value.id, "type": value.type, "name": value.name,
                "tags": value.tags, "thumbnail": thumbnail, "deleted": deleted}


class FileDetailRead(FileRead):
    """含 file_usages 列表（详情接口）。"""

    model_config = ConfigDict(from_attributes=True)

    usages: list[FileUsageRead] = Field(default_factory=list)
