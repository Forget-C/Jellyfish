"""DashScope 文生图响应解析单测。"""

from __future__ import annotations

from app.core.integrations.aliyun.dashscope_images import (
    _build_multimodal_user_content,
    _parse_multimodal_sync_response,
    _split_dashscope_prompt_and_negative,
)
from app.core.contracts.image_generation import ImageGenerationInput, InputImageRef


def test_split_prompt_extracts_negative_section() -> None:
    """含「负面提示」段落时，应拆到 parameters.negative_prompt（与 Studio 长提示一致）。"""
    raw = """画面：都市人像

负面提示（强烈负面）：
blur, low quality"""
    pos, neg = _split_dashscope_prompt_and_negative(raw)
    assert "都市人像" in pos
    assert "blur" in neg
    assert "负面提示" not in pos


def test_split_prompt_no_marker_returns_full_as_positive() -> None:
    pos, neg = _split_dashscope_prompt_and_negative("仅正面描述")
    assert pos == "仅正面描述"
    assert neg == ""


def test_build_multimodal_user_content_includes_reference_images_in_order() -> None:
    inp = ImageGenerationInput(
        prompt="主提示词",
        model="qwen-image-2.0-pro",
        images=[
            InputImageRef(image_url="data:image/png;base64,aaa"),
            InputImageRef(image_url="https://example.com/ref-2.png"),
        ],
    )
    content = _build_multimodal_user_content(inp, positive_prompt="正向提示")
    assert content[0]["text"] == "正向提示"
    assert content[1]["image"] == "data:image/png;base64,aaa"
    assert content[2]["image"] == "https://example.com/ref-2.png"


def test_build_multimodal_user_content_limits_reference_images_to_three() -> None:
    inp = ImageGenerationInput(
        prompt="主提示词",
        model="qwen-image-2.0-pro",
        images=[
            InputImageRef(image_url="https://example.com/ref-1.png"),
            InputImageRef(image_url="https://example.com/ref-2.png"),
            InputImageRef(image_url="https://example.com/ref-3.png"),
            InputImageRef(image_url="https://example.com/ref-4.png"),
        ],
    )
    content = _build_multimodal_user_content(inp, positive_prompt="正向提示")
    image_items = [item["image"] for item in content if "image" in item]
    assert image_items == [
        "https://example.com/ref-1.png",
        "https://example.com/ref-2.png",
        "https://example.com/ref-3.png",
    ]


def test_parse_multimodal_sync_accepts_content_without_type_field() -> None:
    """qwen-image 等模型可能返回 content 项仅含 image URL，无 type 字段。"""
    data = {
        "output": {
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "image": "https://example.com/out.png?sig=1",
                            }
                        ],
                    },
                }
            ]
        },
        "usage": {"height": 1280, "image_count": 1, "width": 1280},
        "request_id": "req-1",
    }
    result = _parse_multimodal_sync_response(data)
    assert len(result.images) == 1
    assert result.images[0].url == "https://example.com/out.png?sig=1"
    assert result.provider == "aliyun_bailian"


def test_parse_multimodal_sync_still_accepts_explicit_type_image() -> None:
    """兼容文档示例：content 项带 type=image。"""
    data = {
        "output": {
            "choices": [
                {
                    "message": {
                        "content": [
                            {"type": "image", "image": "https://example.com/a.png"},
                        ],
                    },
                }
            ]
        },
    }
    result = _parse_multimodal_sync_response(data)
    assert result.images[0].url == "https://example.com/a.png"
