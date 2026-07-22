"""独立视频生成实验室的请求契约。"""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from app.core.contracts.video_generation import VideoRatio


class VideoLabSubjectReference(BaseModel):
    """实验室提交的命名主体，文件 ID 在服务层转换为供应商可读取的 data URL。"""

    name: str = Field(..., min_length=1, description="主体名称；提示词使用 @名称 引用")
    image_file_ids: list[str] = Field(default_factory=list, description="主体参考图片 file_id 列表")
    video_file_ids: list[str] = Field(default_factory=list, description="主体参考视频 file_id 列表")

    @model_validator(mode="after")
    def require_name_and_media(self) -> "VideoLabSubjectReference":
        """在 API 边界拒绝空主体，避免任务异步执行后才暴露参数错误。"""
        self.name = self.name.strip()
        self.image_file_ids = [value.strip() for value in self.image_file_ids if value and value.strip()]
        self.video_file_ids = [value.strip() for value in self.video_file_ids if value and value.strip()]
        if not self.name:
            raise ValueError("subject name must not be blank")
        if not self.image_file_ids and not self.video_file_ids:
            raise ValueError("subject requires at least one image or video file")
        return self


class VideoLabFrameReferenceFiles(BaseModel):
    """实验室的具名帧文件，和通用 VideoFrameReferences 对应。"""

    first_frame_file_id: str | None = None
    last_frame_file_id: str | None = None
    key_frame_file_ids: list[str] = Field(default_factory=list)


class VideoLabGenerateRequest(BaseModel):
    """提交一次不绑定镜头的视频实验，支持三种具名关键帧。"""

    model_id: str = Field(..., min_length=1, description="已登记的视频模型 ID")
    session_id: str = Field(..., min_length=1, description="所属实验会话 ID")
    prompt: str = Field(..., min_length=1, description="最终提交给视频模型的提示词")
    ratio: VideoRatio = Field("16:9", description="视频画幅比例")
    frame_references: VideoLabFrameReferenceFiles = Field(default_factory=VideoLabFrameReferenceFiles)
    subject_references: list[VideoLabSubjectReference] = Field(
        default_factory=list,
        description="独立于关键帧的命名主体参考",
    )
