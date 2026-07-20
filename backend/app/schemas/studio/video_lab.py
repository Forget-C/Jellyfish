"""独立视频生成实验室的请求契约。"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.core.contracts.video_generation import VideoRatio


class VideoLabGenerateRequest(BaseModel):
    """提交一次不绑定镜头的视频实验，支持三种具名关键帧。"""

    model_id: str = Field(..., min_length=1, description="已登记的视频模型 ID")
    session_id: str = Field(..., min_length=1, description="所属实验会话 ID")
    prompt: str = Field(..., min_length=1, description="最终提交给视频模型的提示词")
    ratio: VideoRatio = Field("16:9", description="视频画幅比例")
    first_frame_file_id: str | None = Field(None, description="可选首帧图片 file_id")
    last_frame_file_id: str | None = Field(None, description="可选尾帧图片 file_id")
    key_frame_file_id: str | None = Field(None, description="可选关键帧图片 file_id")
