"""4.1 实体提取：正常解析、幻觉拦截、别名合并、坏 JSON 抢救与失败路径。"""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from app.schemas.studio.llm_orchestration import EntityExtractionPreviewRequest
from app.services.studio.llm_orchestration.entity_extraction import (
    extract_raw_entity_items,
    postprocess_entities,
    preview_entity_extraction,
)
from app.services.studio.llm_orchestration.json_utils import (
    JSONParseError,
    extract_json_candidate,
    parse_json_object_with_repairs,
)
from tests.llm_orchestration_fixtures import (
    build_session,
    make_recording_stub_caller,
    seed_project_chapter_shot,
)

SOURCE = (
    "将军府庭院内，秦老夫人拄着拐杖逼问姜岁欢嫁妆下落。"
    "姜岁欢攥紧手中玉佩，沉默不语。秦老夫人冷笑，抬手示意下人上前。"
)


def _item(name: str, entity_type: str, **extra: object) -> dict[str, object]:
    payload: dict[str, object] = {"name": name, "entity_type": entity_type, "profile": "x", "confidence": 0.8}
    payload.update(extra)
    return payload


# ---------------------------------------------------------------------------
# 纯函数：确定性后校验
# ---------------------------------------------------------------------------


def test_postprocess_keeps_valid_items_and_normalizes_fields() -> None:
    items, dropped, warnings = postprocess_entities(
        [
            _item("姜岁欢", "character", aliases=["岁欢"], profile="清冷少女，素色襦裙"),
            _item("将军府庭院", "scene"),
            _item("拐杖", "prop"),
        ],
        source_text=SOURCE,
    )

    assert dropped == []
    assert [item.name for item in items] == ["姜岁欢", "将军府庭院", "拐杖"]
    assert items[0].aliases == ["岁欢"]
    assert items[0].confidence == 0.8
    assert items[0].entity_type == "character"
    assert all(item.grounded for item in items)
    assert not [w for w in warnings if "丢弃" in w]


def test_postprocess_rejects_unlisted_candidate_as_hallucination() -> None:
    items, dropped, warnings = postprocess_entities(
        [_item("姜岁欢", "character"), _item("赵公子", "character")],
        source_text=SOURCE,
        candidate_names=["姜岁欢"],
    )

    assert [item.name for item in items] == ["姜岁欢"]
    assert [entry.name for entry in dropped] == ["赵公子"]
    assert "不在候选名单内（疑似幻觉实体）" in dropped[0].reason
    assert any("赵公子" in warning and "幻觉" in warning for warning in warnings)


def test_postprocess_rejects_name_absent_from_source_text() -> None:
    """不在候选名单、名称也不在原文里的实体（典型幻觉）必须被拦下。"""
    items, dropped, warnings = postprocess_entities(
        [_item("姜岁欢", "character"), _item("西门吹雪", "character")],
        source_text=SOURCE,
    )

    assert [item.name for item in items] == ["姜岁欢"]
    assert [entry.name for entry in dropped] == ["西门吹雪"]
    assert "未在原文中出现" in dropped[0].reason
    assert any("西门吹雪" in warning for warning in warnings)


def test_postprocess_rejects_invalid_entity_type() -> None:
    items, dropped, warnings = postprocess_entities(
        [_item("姜岁欢", "animal"), _item("玉佩", "prop")],
        source_text=SOURCE,
    )

    assert [item.name for item in items] == ["玉佩"]
    assert [entry.name for entry in dropped] == ["姜岁欢"]
    assert "entity_type 非法" in dropped[0].reason
    assert any("类型非法已丢弃" in warning for warning in warnings)


def test_postprocess_rejects_costume_type_with_explicit_hint() -> None:
    items, dropped, _ = postprocess_entities(
        [_item("素色襦裙", "costume")],
        source_text=SOURCE,
    )

    assert items == []
    assert "服装属于独立资产类型" in dropped[0].reason


def test_postprocess_merges_duplicates_and_alias_matches() -> None:
    items, dropped, warnings = postprocess_entities(
        [
            _item("姜岁欢", "character", aliases=["岁欢"], confidence=0.4, profile="短"),
            _item("姜岁欢", "character", confidence=0.9, profile="清冷少女，素色襦裙，腰间系玉佩"),
            _item("岁欢", "character", confidence=0.6),
        ],
        source_text=SOURCE,
    )

    assert len(items) == 1
    merged = items[0]
    assert merged.name == "姜岁欢"
    # 置信度取最大
    assert merged.confidence == 0.9
    # 画像取更长的一条
    assert merged.profile == "清冷少女，素色襦裙，腰间系玉佩"
    # 别名匹配到的第三条被并入，并记录合并来源
    assert merged.merged_from == ["岁欢"]
    assert dropped == []
    assert any("已合并为一条" in warning for warning in warnings)


def test_postprocess_clamps_confidence_and_flags_missing() -> None:
    items, _, warnings = postprocess_entities(
        [
            _item("姜岁欢", "character", confidence=1.7),
            _item("玉佩", "prop", confidence="n/a"),
        ],
        source_text=SOURCE,
    )

    by_name = {item.name: item for item in items}
    assert by_name["姜岁欢"].confidence == 1.0
    assert by_name["玉佩"].confidence == 0.5
    assert any("越界" in warning for warning in warnings)
    assert any("缺少可解析的 confidence" in warning for warning in warnings)


def test_postprocess_drops_ungrounded_aliases() -> None:
    items, _, warnings = postprocess_entities(
        [_item("姜岁欢", "character", aliases=["岁欢", "不存在的小名"])],
        source_text=SOURCE,
    )

    assert items[0].aliases == ["岁欢"]
    assert any("不存在的小名" in warning for warning in warnings)


def test_postprocess_truncates_beyond_max_items() -> None:
    raw = [_item(f"角色{i}号", "character") for i in range(1, 6)]
    source = SOURCE + "".join(f"角色{i}号在场。" for i in range(1, 6))

    items, _, warnings = postprocess_entities(raw, source_text=source, max_items=3)

    assert len(items) == 3
    assert any("max_items=3" in warning for warning in warnings)


def test_extract_raw_entity_items_supports_multiple_shapes() -> None:
    assert extract_raw_entity_items({"entities": [{"name": "a"}]}) == [{"name": "a"}]
    assert extract_raw_entity_items({"items": [{"name": "a"}]}) == [{"name": "a"}]
    assert extract_raw_entity_items({"name": "solo", "entity_type": "prop"}) == [
        {"name": "solo", "entity_type": "prop"}
    ]
    with pytest.raises(JSONParseError):
        extract_raw_entity_items({"note": "没有实体"})


# ---------------------------------------------------------------------------
# JSON 抢救
# ---------------------------------------------------------------------------


def test_extract_json_candidate_strips_markdown_fence_and_chatter() -> None:
    raw = '好的，结果如下：\n```json\n{"entities": []}\n```\n以上。'
    assert extract_json_candidate(raw) == '{"entities": []}'


def test_parse_repairs_trailing_comma() -> None:
    parsed, repairs = parse_json_object_with_repairs('{"entities": [{"name": "a"},],}')
    assert parsed == {"entities": [{"name": "a"}]}
    assert "去除尾随逗号" in repairs


def test_parse_repairs_truncated_output() -> None:
    parsed, repairs = parse_json_object_with_repairs('{"entities":[{"name":"姜岁欢","entity_type":"character"}')
    assert parsed["entities"][0]["name"] == "姜岁欢"
    assert any("括号配平" in item for item in repairs)


def test_parse_raises_structured_error_on_garbage() -> None:
    with pytest.raises(JSONParseError) as exc_info:
        parse_json_object_with_repairs("模型今天不想说话")
    assert "JSON 解析失败" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 服务层（注入 stub，不联网）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preview_entity_extraction_success_with_stub() -> None:
    payload = {
        "entities": [
            {
                "name": "姜岁欢",
                "aliases": ["岁欢"],
                "entity_type": "character",
                "profile": "清冷少女，素色襦裙",
                "confidence": 0.91,
            },
            {
                "name": "将军府庭院",
                "aliases": [],
                "entity_type": "scene",
                "profile": "青石板庭院，廊柱阴影明显",
                "confidence": 0.77,
            },
            {
                "name": "西门吹雪",
                "aliases": [],
                "entity_type": "character",
                "profile": "编造人物",
                "confidence": 0.99,
            },
        ]
    }
    caller, prompts = make_recording_stub_caller(payload)

    db, engine = await build_session()
    async with db:
        result = await preview_entity_extraction(
            db,
            body=EntityExtractionPreviewRequest(chapter_text=SOURCE),
            llm_caller=caller,
        )

    assert result.meta.llm_called is True
    assert result.meta.dry_run is True  # 守卫仍开着，但本次是注入 stub，未触网
    assert result.meta.raw_output_chars > 0
    assert result.chapter_id is None
    assert result.source_chars == len(SOURCE)

    by_name = {item.name: item for item in result.items}
    assert by_name["姜岁欢"].confidence == 0.91
    assert by_name["姜岁欢"].aliases == ["岁欢"]
    assert by_name["将军府庭院"].entity_type == "scene"
    assert "西门吹雪" not in by_name
    assert [entry.name for entry in result.dropped] == ["西门吹雪"]

    # 提示词里带了「只输出合法 JSON」的硬约束与原文
    assert "只返回合法 JSON 对象" in prompts[0]
    assert "姜岁欢" in prompts[0]
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_entity_extraction_reads_chapter_from_db() -> None:
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        caller = make_recording_stub_caller({"entities": []})[0]
        result = await preview_entity_extraction(
            db,
            body=EntityExtractionPreviewRequest(chapter_id="chap-1"),
            llm_caller=caller,
        )

    assert result.chapter_id == "chap-1"
    assert result.source_chars > 0
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_entity_extraction_bad_json_raises_422_with_detail() -> None:
    caller = make_recording_stub_caller("这不是 JSON，模型跑偏了")[0]

    db, engine = await build_session()
    async with db:
        with pytest.raises(HTTPException) as exc_info:
            await preview_entity_extraction(
                db,
                body=EntityExtractionPreviewRequest(chapter_text=SOURCE),
                llm_caller=caller,
            )

    assert exc_info.value.status_code == 422
    detail = exc_info.value.detail
    assert detail["code"] == "llm_json_parse_failed"
    assert detail["raw_output_chars"] > 0
    assert "这不是 JSON" in detail["raw_output_preview"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_entity_extraction_repairs_fenced_json() -> None:
    raw = "```json\n" + json.dumps(
        {
            "entities": [
                {"name": "姜岁欢", "entity_type": "character", "profile": "清冷少女", "confidence": 0.7},
            ]
        },
        ensure_ascii=False,
    ) + "\n```"
    caller = make_recording_stub_caller(raw)[0]

    db, engine = await build_session()
    async with db:
        result = await preview_entity_extraction(
            db,
            body=EntityExtractionPreviewRequest(chapter_text=SOURCE),
            llm_caller=caller,
        )

    assert [item.name for item in result.items] == ["姜岁欢"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_entity_extraction_requires_text() -> None:
    db, engine = await build_session()
    async with db:
        with pytest.raises(HTTPException) as exc_info:
            await preview_entity_extraction(
                db,
                body=EntityExtractionPreviewRequest(),
                llm_caller=make_recording_stub_caller({"entities": []})[0],
            )
    assert exc_info.value.status_code == 400
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_entity_extraction_rejects_blank_chapter_text() -> None:
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db, chapter_text="   ")
        # chapter 原文为空 → 400
        with pytest.raises(HTTPException) as exc_info:
            await preview_entity_extraction(
                db,
                body=EntityExtractionPreviewRequest(chapter_id="chap-1"),
                llm_caller=make_recording_stub_caller({"entities": []})[0],
            )
    assert exc_info.value.status_code == 400
    await engine.dispose()
