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
    resolution: Optional[str] = Field(
        None,
        description="分辨率档位（如 480p / 720p / 1080p）；未传时按供应商能力默认值解析",
    )
    seed: Optional[int] = Field(
        None,
        ge=-1,
        le=4294967295,
        description="随机种子，-1 或 [0, 2^32-1]，供应商/模型可能有差异",
    )
    watermark: Optional[bool] = Field(None, description="是否包含水印，供应商/模型可能有差异")

    # ---- 音频（按 APIMart / seedance 官方协议对齐，2026-09-18 实读文档）----
    # 三种东西必须分清，混起来就会得出错误结论：
    #   1) ``generate_audio``：**供应商开关**，表示"视频带 AI 生成的配套音频"。
    #      seedance 文档里**默认就是 true**，与下面上传的参考音频无关。
    #   2) ``audio_urls``：**参考音频**（我们把已绑定的台词配音作为输入提交）。
    #      seedance 支持，字段名就是 ``audio_urls``，接收公网 URL 或 ``asset://``，
    #      最多 3 条、总时长 ≤15s，且需要与参考图片/参考视频一起使用。
    #      **不接受 base64**，也不接受 localhost/相对地址（供应商抓不到）。
    #   3) 首尾帧与参考音频互斥：官方警告"使用首尾帧图片（image_with_roles）时参考音频不可用"。
    generate_audio: Optional[bool] = Field(
        None,
        description="是否生成配套音频（供应商开关，seedance 默认 true）；与参考音频无关",
    )
    audio_urls: list[str] = Field(
        default_factory=list,
        description="参考音频 URL 列表（公网地址或 asset://）；APIMart 与协议同名字段",
    )
    audio_base64: Optional[str] = Field(
        None,
        description="参考音频的内联形式（仅部分供应商支持；APIMart 不支持，不会被发出）",
    )
    audio_source_file_id: Optional[str] = Field(
        None,
        description="该音频来自哪条 files 记录（仅用于追溯，**不会**发给供应商）",
    )

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
