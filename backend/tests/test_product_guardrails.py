"""产物字段护栏测试：来源白名单 + 演练占位不得入库。

对应「上一环确认保存的产物，必须成为下一环实际使用的输入」这条要求：
如果模板拼装能冒用 ``llm``、或者 DRY_RUN 占位能写进正式字段，下一环读到的就是假内容。
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services.studio.product_guardrails import (
    EXPORTABLE_VIDEO_PROMPT_SOURCES,
    SAVABLE_VIDEO_PROMPT_SOURCES,
    VIDEO_PROMPT_SOURCE_TEMPLATE,
    reject_placeholder_text,
    validate_product_text_fields,
    validate_video_prompt_source,
)


# ---------------------------------------------------------------------------
# 来源白名单
# ---------------------------------------------------------------------------


def test_savable_sources_are_the_four_real_sources() -> None:
    # external_import = 其它外部平台批量导入；必须与大模型生成区分（用户 2026-09-19 要求）
    assert SAVABLE_VIDEO_PROMPT_SOURCES == ("llm", "jurilu", "manual", "skill", "external_import")
    # 模板拼装绝不能是"已确认来源"
    assert VIDEO_PROMPT_SOURCE_TEMPLATE not in SAVABLE_VIDEO_PROMPT_SOURCES
    assert VIDEO_PROMPT_SOURCE_TEMPLATE not in EXPORTABLE_VIDEO_PROMPT_SOURCES


def test_validate_source_accepts_real_sources() -> None:
    for value in ("llm", "jurilu", "manual", "skill", "LLM", " Jurilu "):
        assert validate_video_prompt_source(value) in SAVABLE_VIDEO_PROMPT_SOURCES


def test_validate_source_allows_blank_for_legacy_rows() -> None:
    assert validate_video_prompt_source(None) == ""
    assert validate_video_prompt_source("") == ""
    assert validate_video_prompt_source("   ") == ""


def test_validate_source_rejects_template_with_explanation() -> None:
    """核心回归：模板拼装不得被标记为 llm，也不接受 template。"""
    with pytest.raises(HTTPException) as exc_info:
        validate_video_prompt_source("template")
    assert exc_info.value.status_code == 422
    detail = str(exc_info.value.detail)
    assert "template" in detail
    assert "manual" in detail
    assert "llm" in detail


def test_validate_source_rejects_unknown_value() -> None:
    with pytest.raises(HTTPException) as exc_info:
        validate_video_prompt_source("随便写的")
    assert exc_info.value.status_code == 422
    assert "可用取值" in str(exc_info.value.detail)


def test_legacy_sources_normalize_to_manual_on_write() -> None:
    """库里已有的 manual_workspace / internal 写回时归一成 manual。"""
    assert validate_video_prompt_source("manual_workspace") == "manual"
    assert validate_video_prompt_source("internal") == "manual"


def test_legacy_sources_remain_exportable() -> None:
    """但不能因为归一名就丢掉已经保存的历史提示词。"""
    assert "manual_workspace" in EXPORTABLE_VIDEO_PROMPT_SOURCES
    assert "shot_description" in EXPORTABLE_VIDEO_PROMPT_SOURCES


# ---------------------------------------------------------------------------
# 占位护栏
# ---------------------------------------------------------------------------


def test_reject_placeholder_text_blocks_string_field() -> None:
    with pytest.raises(HTTPException) as exc_info:
        reject_placeholder_text("[DRY_RUN 占位] 未调用大模型", field="video_prompt")
    assert exc_info.value.status_code == 422
    assert "演练占位" in str(exc_info.value.detail)


def test_reject_placeholder_text_blocks_mapping_field() -> None:
    with pytest.raises(HTTPException) as exc_info:
        reject_placeholder_text(
            {"character_image_front": "[DRY_RUN 占位] 主体描述待模型生成"},
            field="image_prompts",
        )
    assert exc_info.value.status_code == 422
    assert "character_image_front" in str(exc_info.value.detail)


def test_reject_placeholder_text_allows_real_content() -> None:
    # 不应误伤真实内容（含方括号但非占位标记）
    reject_placeholder_text("林晓抱着合同推门而入，镜头缓慢推近。", field="video_prompt")
    reject_placeholder_text({"character_image_front": "清冷少女，素色襦裙，全身参考图"}, field="image_prompts")
    reject_placeholder_text(None, field="video_prompt")
    reject_placeholder_text({}, field="image_prompts")


def test_validate_product_text_fields_covers_all_prompt_columns() -> None:
    for field in ("video_prompt", "first_frame_prompt", "last_frame_prompt", "key_frame_prompt"):
        with pytest.raises(HTTPException):
            validate_product_text_fields({field: "[DRY_RUN 占位] x"})
    with pytest.raises(HTTPException):
        validate_product_text_fields({"image_prompts": {"a": "[DRY_RUN 占位] x"}})
    # 无关字段不检查
    validate_product_text_fields({"title": "[DRY_RUN 占位] 标题可以这样写", "duration": 5})


# ---------------------------------------------------------------------------
# 两份白名单必须保持同步（std-only 模块各留一份，靠测试兜住漂移）
# ---------------------------------------------------------------------------


def test_delivery_whitelist_stays_in_sync_with_guardrails() -> None:
    from app.services.studio.prompt_delivery_text import EXPORT_SOURCES

    assert set(EXPORTABLE_VIDEO_PROMPT_SOURCES) <= set(EXPORT_SOURCES), (
        "交付导出白名单缺少写入口允许的来源，会在导出时静默丢掉内容"
    )
    assert VIDEO_PROMPT_SOURCE_TEMPLATE not in EXPORT_SOURCES
