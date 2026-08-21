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
                key="ollama",
                display_name="Ollama",
                aliases=("ollama", "本地 Ollama"),
                supported_categories=(ModelCategoryKey.text,),
                default_base_url="http://localhost:11434/v1",
                requires_api_key=False,
            ),
            ProviderSpec(
                key="deepseek",
                display_name="DeepSeek",
                aliases=("deepseek", "深度求索"),
                supported_categories=(ModelCategoryKey.text,),
                default_base_url="https://api.deepseek.com/v1",
            ),
            ProviderSpec(
                key="volcengine",
                display_name="火山引擎",
                aliases=("火山引擎", "volcengine", "volc", "doubao", "bytedance", "ark"),
                supported_categories=(ModelCategoryKey.image, ModelCategoryKey.video),
                default_base_url="https://ark.cn-beijing.volces.com/api/v3",
            ),
            ProviderSpec(
                key="aliyun_bailian",
                display_name="阿里百炼",
                aliases=("阿里百炼", "aliyun", "bailian", "dashscope"),
                supported_categories=(ModelCategoryKey.text,),
                default_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
        ]
    )
