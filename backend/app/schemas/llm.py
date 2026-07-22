"""与 LLM 相关的 Pydantic Schema（Provider/Model/ModelSettings）。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.contracts.model_catalog import ModelCatalogSource, ProviderModelCandidate
from app.models.llm import LogLevel, ModelCategoryKey, ProviderStatus


class ProviderBase(BaseModel):
    """供应商通用字段（不含敏感字段）。"""

    name: str = Field(..., description="供应商名称")
    base_url: str = Field(..., description="文本/通用 API Base URL")
    image_base_url: str | None = Field(None, description="图片能力 API Base URL（可选覆盖）")
    video_base_url: str | None = Field(None, description="视频能力 API Base URL（可选覆盖）")
    description: str = Field("", description="说明")
    status: ProviderStatus = Field(
        ProviderStatus.testing,
        description="状态：active/testing/disabled",
    )
    created_by: str = Field("", description="创建人")


class ProviderCreate(ProviderBase):
    """创建供应商时的请求体，允许填写敏感字段。"""

    id: str = Field(..., description="供应商 ID")
    api_key: str = Field("", description="API Key（敏感，不在响应中回显）")
    api_secret: str = Field("", description="API Secret（敏感，不在响应中回显）")


class ProviderUpdate(BaseModel):
    """更新供应商时的可选字段。"""

    name: str | None = Field(None, description="供应商名称")
    base_url: str | None = Field(None, description="文本/通用 API Base URL")
    image_base_url: str | None = Field(None, description="图片能力 API Base URL（可选覆盖）")
    video_base_url: str | None = Field(None, description="视频能力 API Base URL（可选覆盖）")
    description: str | None = Field(None, description="说明")
    status: ProviderStatus | None = Field(
        None,
        description="状态：active/testing/disabled",
    )
    api_key: str | None = Field(None, description="API Key（敏感，不在响应中回显）")
    api_secret: str | None = Field(None, description="API Secret（敏感，不在响应中回显）")


class ProviderRead(ProviderBase):
    """对外返回的供应商信息（不包含 api_key/api_secret）。"""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(..., description="供应商 ID")


class ProviderCredentialsRead(BaseModel):
    """供应商编辑页按需读取的敏感凭据，不用于列表或详情展示。"""

    api_key: str = Field("", description="API Key")
    api_secret: str = Field("", description="API Secret")


class ProviderSupportedRead(BaseModel):
    """系统支持的供应商能力清单。"""

    key: str = Field(..., description="供应商稳定键")
    display_name: str = Field(..., description="供应商展示名")
    aliases: list[str] = Field(default_factory=list, description="可识别别名")
    supported_categories: list[ModelCategoryKey] = Field(
        default_factory=list,
        description="支持的模型类别",
    )
    default_base_url: str | None = Field(None, description="默认 API Base URL")
    requires_api_key: bool = Field(True, description="是否要求 api_key")
    requires_api_secret: bool = Field(False, description="是否要求 api_secret")
    is_experimental: bool = Field(False, description="是否实验性供应商")


class ProviderModelCatalogRead(BaseModel):
    """指定 Provider 刷新到的可导入模型目录。"""

    provider_id: str = Field(..., description="数据库中的供应商 ID")
    provider_key: str = Field(..., description="供应商稳定键")
    source: ModelCatalogSource = Field(..., description="模型列表来源")
    models: list[ProviderModelCandidate] = Field(default_factory=list, description="可选择导入的模型")


class ProviderModelImportRequest(BaseModel):
    """从已刷新供应商目录中选择并导入模型。"""

    models: list[ProviderModelCandidate] = Field(..., min_length=1, max_length=100, description="用户选中的模型")


class ProviderModelImportResult(BaseModel):
    """模型批量导入结果，重复项不会重复创建。"""

    created: list[ModelRead] = Field(default_factory=list, description="新创建的模型")
    skipped: list[ProviderModelCandidate] = Field(default_factory=list, description="已存在而跳过的模型")


class VideoGenerationOptionsRead(BaseModel):
    """当前默认视频模型对应的生成参数选项。"""

    provider: str = Field(..., description="供应商稳定键")
    model_id: str = Field(..., description="默认视频模型 ID")
    model_name: str = Field(..., description="默认视频模型名称")
    allowed_ratios: list[str] = Field(default_factory=list, description="当前模型允许的比例选项")
    default_ratio: str = Field(..., description="当前模型默认比例")
    supports_subject_image_reference: bool = Field(False, description="是否支持参考主体图片")
    supports_subject_video_reference: bool = Field(False, description="是否支持参考主体视频")
    supports_subject_reference_with_frame_reference: bool = Field(
        False, description="是否允许主体参考与首帧/尾帧/关键帧同时提交"
    )
    max_subjects: int | None = Field(None, description="主体数量上限")
    max_images_per_subject: int | None = Field(None, description="单主体图片上限")
    max_videos_per_subject: int | None = Field(None, description="单主体视频上限")
    max_media_per_subject: int | None = Field(None, description="单主体图片与视频共享槽位上限")
    max_total_subject_videos: int | None = Field(None, description="所有主体视频总数上限")


class ImageGenerationOptionsRead(BaseModel):
    """当前默认图片模型对应的关键帧规格选项。"""

    provider: str = Field(..., description="供应商稳定键")
    model_id: str = Field(..., description="默认图片模型 ID")
    model_name: str = Field(..., description="默认图片模型名称")
    supported_ratios: list[str] = Field(default_factory=list, description="当前模型支持的目标比例")
    default_resolution_profile: str = Field(..., description="当前模型默认分辨率档位")
    ratio_size_profiles: dict[str, dict[str, str]] = Field(
        default_factory=dict,
        description="按比例和分辨率档位映射得到的像素尺寸",
    )


class ModelBase(BaseModel):
    """模型通用字段。"""

    name: str = Field(..., description="模型名称")
    category: ModelCategoryKey = Field(..., description="模型类别：text/image/video")
    provider_id: str = Field(..., description="所属供应商 ID")
    params: dict[str, Any] = Field(default_factory=dict, description="模型参数（JSON）")
    description: str = Field("", description="说明")
    created_by: str = Field("", description="创建人")


class ModelCreate(ModelBase):
    """创建模型请求体。"""

    id: str = Field(..., description="模型 ID")


class ModelUpdate(BaseModel):
    """更新模型请求体（全部可选）。"""

    name: str | None = Field(None, description="模型名称")
    category: ModelCategoryKey | None = Field(None, description="模型类别")
    provider_id: str | None = Field(None, description="所属供应商 ID")
    params: dict[str, Any] | None = Field(None, description="模型参数（JSON）")
    description: str | None = Field(None, description="说明")


class ModelRead(ModelBase):
    """对外返回的模型信息。"""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(..., description="模型 ID")


class ModelSettingsBase(BaseModel):
    """模型全局设置通用字段。"""

    default_text_model_id: str | None = Field(None, description="默认文本模型 ID")
    default_image_model_id: str | None = Field(None, description="默认图片模型 ID")
    default_video_model_id: str | None = Field(None, description="默认视频模型 ID")
    api_timeout: int = Field(30, description="API 超时（秒）")
    log_level: LogLevel = Field(LogLevel.info, description="日志级别")


class ModelSettingsUpdate(ModelSettingsBase):
    """更新或保存模型全局设置请求体。"""

    pass


class ModelSettingsRead(ModelSettingsBase):
    """对外返回的模型全局设置。"""

    model_config = ConfigDict(from_attributes=True)

    id: int = Field(..., description="设置行 ID（通常为 1）")
