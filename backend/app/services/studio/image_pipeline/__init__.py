"""P3 出图管线包：出图服务 HTTP 对接 + 按提示词生成参考图 + 参考图返工 + 提示词包导出 + 直提出视频。

子模块：
- ``external_image_client``：出图服务 HTTP 客户端（受守卫）
- ``reference_resolver``：定版参考图解析
- ``image_pipeline``：定妆照 → 参考图批量 → OSS 编排 + 受守卫提交
- ``video_submit``：直提出视频（计划预览 + 受守卫同步提交）
- ``prompt_package``：提示词包导出（图片 + 视频 + 绑定 + 参考图）
"""

from __future__ import annotations

from app.services.studio.image_pipeline.external_image_client import (
    DEFAULT_IMAGE_MODEL_CHOICE,
    DEFAULT_SERVICE_URL,
    IMAGE_MODEL_CHOICES,
    IMAGE_MODEL_ENV,
    SERVICE_ASSET_TYPES,
    SERVICE_URL_ENV,
    ImageServiceError,
    ServiceTaskDetail,
    ServiceTaskResult,
    build_task_payload,
    create_asset_image_task,
    get_asset_image_task,
    image_model_choice,
    probe_health,
    resolve_image_provider_model,
    service_base_url,
    service_timeout_seconds,
)
from app.services.studio.image_pipeline.image_pipeline import (
    GENERATION_TYPE_BY_ASSET_TYPE,
    SubmissionTarget,
    build_deterministic_prompt,
    build_object_key_template,
    build_source_task_id,
    build_targets,
    poll_task,
    submit_targets,
    summarize_results,
)
from app.services.studio.image_pipeline.prompt_package import (
    build_prompt_package,
    render_package_markdown,
    render_package_text,
)
from app.services.studio.image_pipeline.reference_resolver import (
    IMAGE_MODEL_BY_ASSET_TYPE,
    ReferenceImage,
    resolve_references,
)
from app.services.studio.image_pipeline.video_submit import (
    DEFAULT_VIDEO_RATIO,
    MIN_VIDEO_SECONDS,
    PINNED_VIDEO_MODEL,
    PINNED_VIDEO_RESOLUTION,
    SUPPORTED_VIDEO_PROVIDERS,
    VIDEO_MODEL_ENV,
    VIDEO_RESOLUTION_ENV,
    build_video_submit_plan,
    pinned_video_model,
    pinned_video_resolution,
    resolve_pinned_video_model,
    resolve_plan_seconds,
    submit_video,
)

__all__ = [
    # 出图服务客户端
    "DEFAULT_IMAGE_MODEL_CHOICE",
    "DEFAULT_SERVICE_URL",
    "IMAGE_MODEL_CHOICES",
    "IMAGE_MODEL_ENV",
    "SERVICE_ASSET_TYPES",
    "SERVICE_URL_ENV",
    "ImageServiceError",
    "ServiceTaskDetail",
    "ServiceTaskResult",
    "build_task_payload",
    "create_asset_image_task",
    "get_asset_image_task",
    "image_model_choice",
    "probe_health",
    "resolve_image_provider_model",
    "service_base_url",
    "service_timeout_seconds",
    # 定版参考图
    "IMAGE_MODEL_BY_ASSET_TYPE",
    "ReferenceImage",
    "resolve_references",
    # 出图管线
    "GENERATION_TYPE_BY_ASSET_TYPE",
    "SubmissionTarget",
    "build_deterministic_prompt",
    "build_object_key_template",
    "build_source_task_id",
    "build_targets",
    "poll_task",
    "submit_targets",
    "summarize_results",
    # 提示词包
    "build_prompt_package",
    "render_package_markdown",
    "render_package_text",
    # 直提出视频
    "DEFAULT_VIDEO_RATIO",
    "MIN_VIDEO_SECONDS",
    "PINNED_VIDEO_MODEL",
    "PINNED_VIDEO_RESOLUTION",
    "SUPPORTED_VIDEO_PROVIDERS",
    "VIDEO_MODEL_ENV",
    "VIDEO_RESOLUTION_ENV",
    "build_video_submit_plan",
    "pinned_video_model",
    "pinned_video_resolution",
    "resolve_pinned_video_model",
    "resolve_plan_seconds",
    "submit_video",
]
