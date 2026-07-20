"""图片生成实验室的请求契约。"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.core.contracts.image_generation import ImageResolutionProfile, ImageTargetRatio


class ImageLabGenerateRequest(BaseModel):
    """提交一次独立图片实验，可携带已上传或资料库中的参考图片。"""

    model_id: str = Field(..., min_length=1, description="已登记的图片模型 ID")
    prompt: str = Field(..., min_length=1, description="最终提交给图片模型的提示词")
    images: list[str] = Field(default_factory=list, description="参考图片 file_id 列表，顺序有效")
    target_ratio: ImageTargetRatio | None = Field(None, description="可选输出画幅比例")
    resolution_profile: ImageResolutionProfile | None = Field(None, description="可选输出分辨率档位")
