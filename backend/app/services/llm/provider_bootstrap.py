from __future__ import annotations

from app.models.llm import ModelCategoryKey
from app.services.llm.provider_registry import ProviderSpec, register_many


def bootstrap_builtin_providers() -> None:
    register_many(
        [
            ProviderSpec(
                key="openai",
                display_name="OpenAI",
                aliases=("openai",),
                supported_categories=(
                    ModelCategoryKey.text,
                    ModelCategoryKey.image,
                    ModelCategoryKey.video,
                ),
                default_base_url="https://api.openai.com/v1",
            ),
            ProviderSpec(
                key="volcengine",
                display_name="火山引擎",
                aliases=("火山引擎", "volcengine", "volc", "doubao", "bytedance", "ark"),
                # 火山方舟文本模型同样走 OpenAI-compatible Chat Completions。
                supported_categories=(ModelCategoryKey.text, ModelCategoryKey.image, ModelCategoryKey.video),
                default_base_url="https://ark.cn-beijing.volces.com/api/v3",
            ),
            ProviderSpec(
                key="aliyun_bailian",
                display_name="阿里百炼",
                aliases=("阿里百炼", "aliyun", "bailian", "dashscope"),
                # 图片 / 视频：在兼容域名下使用与 OpenAI 相同的 images、videos 路径；是否开通以控制台与地域为准。
                supported_categories=(ModelCategoryKey.text, ModelCategoryKey.image, ModelCategoryKey.video),
                default_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
        ]
    )
