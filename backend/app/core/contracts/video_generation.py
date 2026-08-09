"""视频生成共享输入输出契约。"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.contracts.provider import ProviderKey


def _strip_optional_b64(value: str | None) -> str | None:
    if value is None:
        return None
    s = value.strip()
    return s if s else None


VideoRatio = Literal["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]


class VideoGenerationInput(BaseModel):
    """视频生成输入：支持文本提示词 + 可选的三种帧参考图（纯 base64 或 data URL）。"""

    model_config = ConfigDict(extra="forbid")

    prompt: Optional[str] = Field(None, description="文本提示词；可与参考图二选一或同时存在")

    first_frame_base64: Optional[str] = Field(None, description="首帧图：纯 base64 或 data:image/...;base64,...")
    last_frame_base64: Optional[str] = Field(None, description="尾帧图：纯 base64 或 data URL")
    key_frame_base64: Optional[str] = Field(None, description="关键帧图：纯 base64 或 data URL")

    model: Optional[str] = Field(None, description="视频模型名称（可选，供应商透传）")
    ratio: VideoRatio = Field(..., description="视频宽高比，业务层唯一主参数")
    seconds: Optional[int] = Field(None, description="时长（秒）（可选，供应商透传）")
    seed: Optional[int] = Field(
        None,
        ge=-1,
        le=4294967295,
        description="随机种子，-1 或 [0, 2^32-1]，供应商/模型可能有差异",
    )
    watermark: Optional[bool] = Field(None, description="是否包含水印，供应商/模型可能有差异")

    #: 可选的显式渲染分辨率。省略时由 ratio 推导（既有行为完全不变）。
    #: 用途：预览档（低分辨率试跑）与成片档（全分辨率）共用同一条渲染路径。
    width: Optional[int] = Field(None, gt=0, description="渲染宽度（像素）；须与 height 同时提供")
    height: Optional[int] = Field(None, gt=0, description="渲染高度（像素）；须与 width 同时提供")

    @model_validator(mode="after")
    def check_explicit_dimensions(self) -> "VideoGenerationInput":
        """width/height 必须成对出现，且为 8 的倍数。

        成对要求：只给一个无法推导另一个，静默补齐会产生非预期的画面比例。
        8 的倍数：扩散模型的潜空间按 8 下采样，非 8 倍数会在供应商侧报错或被
        悄悄取整；在此处提前拒绝，错误信息比 ComfyUI 的节点报错清晰得多。
        """
        if (self.width is None) != (self.height is None):
            raise ValueError("width and height must be provided together or both omitted")
        for name, value in (("width", self.width), ("height", self.height)):
            if value is not None and value % 8 != 0:
                raise ValueError(f"{name} must be a multiple of 8, got {value}")
        return self

    @model_validator(mode="after")
    def require_prompt_or_any_reference(self) -> "VideoGenerationInput":
        has_prompt = bool((self.prompt or "").strip())
        has_ref = any(
            [
                _strip_optional_b64(self.first_frame_base64),
                _strip_optional_b64(self.last_frame_base64),
                _strip_optional_b64(self.key_frame_base64),
            ]
        )
        if not has_prompt and not has_ref:
            raise ValueError("Require prompt or at least one reference frame (base64)")
        return self


class VideoGenerationResult(BaseModel):
    """视频生成结果：返回视频 URL 和/或 file_id。"""

    model_config = ConfigDict(extra="forbid")

    url: Optional[str] = Field(None, description="生成视频可下载 URL")
    file_id: Optional[str] = Field(None, description="落库后的 FileItem.id（type=video）")
    provider_task_id: Optional[str] = Field(None, description="供应商侧任务/视频 ID（用于调试/追踪）")
    provider: Optional[ProviderKey] = Field(None, description="供应商标识")
    status: Optional[str] = Field(None, description="供应商任务状态")

    @model_validator(mode="after")
    def require_url_or_file_id(self) -> "VideoGenerationResult":
        if not self.url and not self.file_id:
            raise ValueError("Either url or file_id must be set")
        return self
