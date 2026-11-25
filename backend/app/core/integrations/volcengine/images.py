"""火山引擎图片生成端点。"""

def build_volcengine_image_generations_url(base_url: str | None) -> str:
    """规范化火山 Ark 基础地址，并返回图片生成的唯一正确端点。

    历史配置可能误将视频子路径 ``/contents/generations`` 保存为 Base URL。
    图片接口始终位于 Ark v3 根路径下的 ``/images/generations``，因此先移除
    已包含的图片或视频操作路径，避免拼出重复或跨能力的 URL。
    """
    normalized_base = (base_url or "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
    for operation_path in ("/contents/generations", "/images/generations"):
        if normalized_base.endswith(operation_path):
            normalized_base = normalized_base[: -len(operation_path)]
            break
    return f"{normalized_base}/images/generations"
