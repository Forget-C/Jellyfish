"""文件素材相关的 Pydantic Schemas。"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FileTypeEnum(str, Enum):
    """素材类型。

    必须与 ``app.models.types.FileType`` 对齐：漏掉 ``audio`` 时，序列化一个音频
    FileItem 会直接抛 ResponseValidationError（用户看到 500），声音绑定也就传不出来。
    """

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
    shot_id: str | None = Field(None, description="镜头 ID")
    usage_kind: str = Field(
        ...,
        description="用途：shot_frame / generated_video / character_image / asset_image / upload / api 等",
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


class FileUploadRead(FileRead):
    """上传接口响应：文件字段**只增不删**，额外带上"这个地址上游能不能匿名取到"。

    为什么：对象存储写入成功 ≠ 这个对象匿名可读。真实故障 A 里，本机可读、匿名访问 404
    的地址被当成公网地址交给了上游（上游任务 failed，原文「无法获取输入媒体 URL（404/410）」）。
    上传时就把结论与修法回显，用户当场能发现，而不是等下一次提交才炸。

    不可达（``url_reachable=false``）**不影响上传本身**：文件已经落库，只是必须如实告警。
    """

    model_config = ConfigDict(from_attributes=True)

    url: str = Field(
        "",
        description="落库后的对象地址（唯一口径：配置了 s3_public_base_url 才是公网地址；没配时为空串）",
    )
    url_reachable: bool | None = Field(
        None,
        description="匿名公网可达性：true=上游取得到；false=取不到（已给出中文告警与修法）；null=未验证（演练模式 / 没有拿到地址）",
    )
    url_probe: dict[str, Any] = Field(
        default_factory=dict,
        description="探活明细：result / http_status / method / probe_method / reason / how_to_fix",
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="中文告警与修法（不可达时含「请检查 bucket 公共读或 s3_public_base_url 配置」）；不阻断上传",
    )
