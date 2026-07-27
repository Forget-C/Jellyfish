"""图片生成共享输入输出契约。"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.contracts.provider import ProviderKey

ResponseFormat = Literal["url", "b64_json"]
ImageTargetRatio = Literal["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "3:2", "2:3"]
ImageResolutionProfile = Literal["standard", "high"]
ImagePurpose = Literal["generic", "video_reference", "asset_image"]


class InputImageRef(BaseModel):
    """图片参考的业务层引用。

    Provider URL/Data URL 由执行期 FileResolver 投影，本契约不能把它们带入
    API 或任务 payload。
    """

    model_config = ConfigDict(extra="forbid")

    file_id: str = Field(min_length=1, description="受控 FileItem ID")

    @model_validator(mode="after")
    def _normalize_file_id(self) -> "InputImageRef":
        self.file_id = self.file_id.strip()
        if not self.file_id:
            raise ValueError("file_id must not be blank")
        return self


class ImageGenerationInput(BaseModel):
    """图片生成输入：文本 prompt 为必填，其余参数透传给供应商。"""

    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(..., description="文本提示词")
    images: list[InputImageRef] = Field(
        default_factory=list,
        description="参考图片列表：存在时 OpenAI 走 /images/edits，火山映射为 image[]",
    )
    model: Optional[str] = Field(None, description="模型名称（如 gpt-image-1.5 / doubao-seedream-*）")
    target_ratio: ImageTargetRatio | None = Field(
        None,
        description="目标画幅比例，用于视频参考帧等需要与视频构图对齐的场景",
    )
    resolution_profile: ImageResolutionProfile | None = Field(
        None,
        description="输出分辨率档位，如 standard / high；由供应商适配层映射为最终 size",
    )
    purpose: ImagePurpose = Field(
        "generic",
        description="生成用途，如 generic / video_reference / asset_image",
    )
    size: Optional[str] = Field(
        None,
        description="分辨率，如 1024x1024 / 1024x1536 等；不同供应商可选项不同",
    )
    n: int = Field(
        1,
        ge=1,
        le=10,
        description="生成图片数量；部分模型仅支持 n=1（调用方需结合文档约束）",
    )
    seed: Optional[int] = Field(
        None,
        description="随机种子；火山 ImageGenerations 支持该参数，OpenAI 目前忽略",
    )
    watermark: Optional[bool] = Field(
        None,
        description="是否包含水印，供应商/模型可能有差异",
    )
    response_format: ResponseFormat = Field(
        "url",
        description="返回格式：url 或 b64_json（OpenAI 语义）；火山引擎可忽略或仅支持 url",
    )

    @model_validator(mode="after")
    def _strip_and_validate_prompt(self) -> "ImageGenerationInput":
        self.prompt = self.prompt.strip()
        if not self.prompt:
            raise ValueError("prompt 不能为空")
        return self


class ImageItem(BaseModel):
    """单张图片结果。"""

    url: Optional[str] = Field(None, description="图片 URL")
    b64_json: Optional[str] = Field(None, description="base64 编码内容（不含 data URI 前缀）")

    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="after")
    def _require_one_field(self) -> "ImageItem":
        if not self.url and not self.b64_json:
            raise ValueError("Either url or b64_json must be set")
        return self


class ImageGenerationResult(BaseModel):
    """图片生成统一结果。"""

    model_config = ConfigDict(extra="ignore")

    images: list[ImageItem] = Field(..., description="图片列表")
    provider: ProviderKey = Field(..., description="供应商标识：openai | volcengine | vidu")
    provider_task_id: Optional[str] = Field(
        None,
        description="供应商内部任务 ID（若存在），用于调试/追踪",
    )
    status: Optional[str] = Field(
        None,
        description="供应商任务状态（同步接口通常为 succeeded/created 等）",
    )

    @model_validator(mode="after")
    def _require_images(self) -> "ImageGenerationResult":
        if not self.images:
            raise ValueError("images 不能为空")
        return self
