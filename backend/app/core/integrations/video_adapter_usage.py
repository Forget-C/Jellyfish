"""视频 adapter 的请求映射事实；画布策略、能力覆盖和诊断由调用方负责。"""
from app.core.contracts.provider import ProviderKey
from app.core.contracts.provider_media import ProviderVideoFrames
from app.core.contracts.video_generation import VideoAdapterUsage, VideoFrameRole, _strip_optional_b64

KLING_FRAME_ROLES: tuple[VideoFrameRole, ...] = ("first_frame", "last_frame")


def resolve_video_adapter_usage(*, provider: ProviderKey, model: str | None) -> VideoAdapterUsage:
    """返回当前代码可映射的用途；不验证输入、不保证远端接受该模型。"""
    if provider == "openai":
        return VideoAdapterUsage(("key_frame", "first_frame", "last_frame"), (), True)
    if provider == "kling":
        name = (model or "").strip().lower()
        return VideoAdapterUsage(KLING_FRAME_ROLES if name == "kling-3.0" else (), (),
                                 name in {"kling-3.0", "kling-3.0-turbo"})
    return VideoAdapterUsage(("first_frame", "last_frame", "key_frame"),
                             ("image", "video") if provider == "vidu" else (),
                             bool((model or "").strip()) if provider == "vidu" else True)


def ordered_video_frames(frames: ProviderVideoFrames, *, roles: tuple[VideoFrameRole, ...]) -> tuple[tuple[VideoFrameRole, str], ...]:
    """按给定用途枚举非空地址，保留重复项；不截断或按能力丢弃输入。"""
    result = []
    for role in roles:
        values = frames.key_frames if role == "key_frame" else (getattr(frames, role),)
        for raw in values:
            if value := _strip_optional_b64(raw):
                result.append((role, value))
    return tuple(result)
