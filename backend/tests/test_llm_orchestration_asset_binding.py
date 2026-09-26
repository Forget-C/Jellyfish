"""P2 资产绑定：候选清单、后校验 7 条规则、置信度分层、与启发式对账、只建议不写库。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.schemas.studio.llm_orchestration import AssetBindingPreviewRequest
from app.services.studio.llm_orchestration.asset_binding import (
    AUTO_TIER,
    REVIEW_TIER,
    BindingCandidate,
    BindingShot,
    build_catalog_from_rows,
    classify_tier,
    heuristic_suggestions,
    parse_binding_response,
    preview_asset_binding,
    reconcile_with_heuristic,
    summarize_tiers,
)
from tests.llm_orchestration_fixtures import (
    build_session,
    make_recording_stub_caller,
    seed_project_chapter_shot,
)

MODULE_PATH = (
    Path(__file__).resolve().parent.parent
    / "app"
    / "services"
    / "studio"
    / "llm_orchestration"
    / "asset_binding.py"
)

CATALOG = [
    BindingCandidate(asset_id="CHAR_001", asset_type="character", name="林晓", aliases=["晓晓"], description="女主"),
    BindingCandidate(asset_id="CHAR_002", asset_type="character", name="张总", description="反派"),
    BindingCandidate(asset_id="SCENE_003", asset_type="scene", name="A公司会议室", aliases=["会议室"], description=""),
    BindingCandidate(asset_id="PROP_002", asset_type="prop", name="合作合同", aliases=["合同"], description="蓝色封面"),
    BindingCandidate(asset_id="COST_001", asset_type="costume", name="黑色西装", aliases=["西装"], description=""),
]

SHOTS = [
    BindingShot(
        shot_id="SHOT_001",
        index=1,
        title="进会议室",
        script_text="林晓抱着合作合同快步走进A公司会议室，张总已经在长桌尽头等她。",
        bound_ids={"characters": set(), "scene": set(), "props": set(), "costumes": set()},
    ),
    BindingShot(
        shot_id="SHOT_002",
        index=2,
        title="对峙",
        script_text="张总穿着黑色西装，从西装内袋掏出手机。",
        bound_ids={"characters": {"CHAR_099"}, "scene": set(), "props": set(), "costumes": set()},
    ),
]


def _slot(asset_id: str, confidence: float = 0.9, reason: str = "入画") -> dict[str, object]:
    return {"asset_id": asset_id, "confidence": confidence, "reason": reason}


def _payload(**extra: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "shots": [
            {
                "shot_id": "SHOT_001",
                "characters": [_slot("CHAR_001", 0.95)],
                "scene": _slot("SCENE_003", 0.9),
                "props": [_slot("PROP_002", 0.85)],
                "costumes": [],
                "unmatched_names": [{"name": "黑袍人", "guessed_type": "character", "evidence": "剧情提到"}],
            },
            {
                "shot_id": "SHOT_002",
                "characters": [_slot("CHAR_002", 0.88)],
                "scene": None,
                "props": [],
                "costumes": [_slot("COST_001", 0.8)],
                "unmatched_names": [],
            },
        ]
    }
    payload.update(extra)
    return payload


# ---------------------------------------------------------------------------
# 分层阈值
# ---------------------------------------------------------------------------


def test_classify_tier_follows_plan_thresholds() -> None:
    assert AUTO_TIER == 0.85
    assert REVIEW_TIER == 0.5
    # auto：高置信 + 非冲突
    assert classify_tier(confidence=0.9, agreement="both") == "auto"
    assert classify_tier(confidence=0.85, agreement="llm_only") == "auto"
    # review：中等置信
    assert classify_tier(confidence=0.6, agreement="llm_only") == "review"
    # review：高置信但冲突/单边
    assert classify_tier(confidence=0.95, agreement="conflict") == "review"
    assert classify_tier(confidence=0.95, agreement="heuristic_only") == "review"
    # discard：低置信
    assert classify_tier(confidence=0.49, agreement="both") == "discard"


def test_summarize_tiers_counts_each_tier() -> None:
    from app.schemas.studio.llm_orchestration import BindingSuggestionRead

    rows = [
        BindingSuggestionRead(slot="characters", asset_id="a", asset_type="character", tier="auto"),
        BindingSuggestionRead(slot="characters", asset_id="b", asset_type="character", tier="review"),
        BindingSuggestionRead(slot="props", asset_id="c", asset_type="prop", tier="discard"),
        BindingSuggestionRead(slot="props", asset_id="d", asset_type="prop", tier="review"),
    ]
    assert summarize_tiers(rows) == {"auto": 1, "review": 2, "discard": 1}


# ---------------------------------------------------------------------------
# 候选清单
# ---------------------------------------------------------------------------


def test_build_catalog_from_rows_uses_tags_as_aliases() -> None:
    catalog = build_catalog_from_rows(
        [
            ("CHAR_001", "character", "林晓", "女主", ["晓晓"]),
            ("SCENE_003", "scene", "A公司会议室", "", ["会议室", "A公司会议室"]),
            ("", "prop", "", "", []),
        ]
    )

    assert [item.asset_id for item in catalog] == ["CHAR_001", "SCENE_003"]
    assert catalog[1].aliases == ["会议室"]  # 与本体同名的 tag 被剔除


def test_heuristic_suggestions_matches_names_and_aliases() -> None:
    result = heuristic_suggestions(SHOTS[0].script_text, CATALOG)

    assert "CHAR_001" in result["characters"]
    assert "SCENE_003" in result["scene"]
    assert "PROP_002" in result["props"]
    # 张总在本镜里也出现了
    assert "CHAR_002" in result["characters"]


def test_heuristic_suggestions_empty_for_unrelated_text() -> None:
    result = heuristic_suggestions("一个路人在街上走过。", CATALOG)
    assert all(not ids for ids in result.values())


# ---------------------------------------------------------------------------
# 后校验 7 条规则
# ---------------------------------------------------------------------------


def test_parse_binding_response_happy_path() -> None:
    normalized, dropped, unmatched, warnings = parse_binding_response(
        json.dumps(_payload(), ensure_ascii=False),
        catalog=CATALOG,
        shots=SHOTS,
    )

    assert dropped == []
    assert len(normalized["SHOT_001"]) == 3
    assert len(normalized["SHOT_002"]) == 2
    assert [item["asset_id"] for item in normalized["SHOT_001"]] == ["CHAR_001", "SCENE_003", "PROP_002"]
    assert [item.name for item in unmatched] == ["黑袍人"]
    assert not [w for w in warnings if "丢弃" in w]


def test_rule2_hallucinated_asset_id_is_dropped() -> None:
    payload = {
        "shots": [
            {
                "shot_id": "SHOT_001",
                "characters": [_slot("CHAR_001"), _slot("CHAR_999")],
                "scene": _slot("SCENE_404"),
            }
        ]
    }
    normalized, dropped, _, warnings = parse_binding_response(
        json.dumps(payload, ensure_ascii=False), catalog=CATALOG, shots=SHOTS
    )

    assert [item["asset_id"] for item in normalized["SHOT_001"]] == ["CHAR_001"]
    dropped_ids = {item.asset_id for item in dropped}
    assert dropped_ids == {"CHAR_999", "SCENE_404"}
    assert all("疑似幻觉" in item.reason for item in dropped)
    assert any("不在候选清单内" in w for w in warnings)


def test_rule3_wrong_type_slot_is_dropped() -> None:
    payload = {
        "shots": [
            {
                "shot_id": "SHOT_001",
                "scene": _slot("CHAR_001"),  # 角色塞进场景槽
                "props": [_slot("COST_001")],  # 服装塞进道具槽
            }
        ]
    }
    normalized, dropped, _, warnings = parse_binding_response(
        json.dumps(payload, ensure_ascii=False), catalog=CATALOG, shots=SHOTS
    )

    assert normalized["SHOT_001"] == []
    assert len(dropped) == 2
    assert all("类型不匹配" in item.reason for item in dropped)
    assert any("类型不匹配" in w for w in warnings)


def test_rule1_shot_id_outside_batch_is_dropped() -> None:
    payload = {"shots": [{"shot_id": "SHOT_777", "characters": [_slot("CHAR_001")]}]}
    normalized, dropped, _, warnings = parse_binding_response(
        json.dumps(payload, ensure_ascii=False), catalog=CATALOG, shots=SHOTS
    )

    assert normalized == {}
    assert dropped[0].shot_id == "SHOT_777"
    assert "不在请求批次内" in dropped[0].reason
    assert any("批次外" in w for w in warnings)


def test_rule4_confidence_clamped_and_missing_becomes_zero() -> None:
    payload = {
        "shots": [
            {
                "shot_id": "SHOT_001",
                "characters": [
                    {"asset_id": "CHAR_001", "confidence": 1.8},
                    {"asset_id": "CHAR_002", "confidence": "not-a-number"},
                ],
            }
        ]
    }
    normalized, _, _, warnings = parse_binding_response(
        json.dumps(payload, ensure_ascii=False), catalog=CATALOG, shots=SHOTS
    )

    by_id = {row["asset_id"]: row for row in normalized["SHOT_001"]}
    assert by_id["CHAR_001"]["confidence"] == 1.0
    assert by_id["CHAR_002"]["confidence"] == 0.0
    assert any("越界" in w for w in warnings)
    assert any("按 0 处理" in w for w in warnings)


def test_rule5_duplicate_in_same_slot_keeps_highest() -> None:
    payload = {
        "shots": [
            {
                "shot_id": "SHOT_001",
                "characters": [
                    {"asset_id": "CHAR_001", "confidence": 0.4, "reason": "低"},
                    {"asset_id": "CHAR_001", "confidence": 0.95, "reason": "高"},
                ],
            }
        ]
    }
    normalized, _, _, warnings = parse_binding_response(
        json.dumps(payload, ensure_ascii=False), catalog=CATALOG, shots=SHOTS
    )

    assert len(normalized["SHOT_001"]) == 1
    assert normalized["SHOT_001"][0]["confidence"] == 0.95
    assert normalized["SHOT_001"][0]["reason"] == "高"
    assert any("重复出现" in w for w in warnings)


def test_rule6_scene_slot_keeps_only_highest_and_turns_rest_into_warning() -> None:
    payload = {
        "shots": [
            {
                "shot_id": "SHOT_001",
                "scene": [_slot("SCENE_003", 0.6), _slot("SCENE_404", 0.95), _slot("SCENE_005", 0.9)],
            }
        ]
    }
    catalog = [*CATALOG, BindingCandidate(asset_id="SCENE_005", asset_type="scene", name="走廊")]
    normalized, dropped, _, warnings = parse_binding_response(
        json.dumps(payload, ensure_ascii=False), catalog=catalog, shots=SHOTS
    )

    rows = normalized["SHOT_001"]
    assert len(rows) == 1
    assert rows[0]["asset_id"] == "SCENE_005"  # 0.9 高于 0.6
    assert any("已保留置信度最高" in w for w in warnings)
    assert {item.asset_id for item in dropped} == {"SCENE_404"}


def test_rule7_missing_shots_array_raises_structured_422() -> None:
    with pytest.raises(HTTPException) as exc_info:
        parse_binding_response('{"result": "nope"}', catalog=CATALOG, shots=SHOTS)

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "llm_json_parse_failed"


def test_parse_repairs_fenced_json() -> None:
    raw = "```json\n" + json.dumps(_payload(), ensure_ascii=False) + "\n```"
    normalized, _, _, warnings = parse_binding_response(raw, catalog=CATALOG, shots=SHOTS)
    assert len(normalized["SHOT_001"]) == 3
    assert not warnings  # 干净的围栏不算"抢救"


def test_parse_repairs_trailing_comma_with_warning() -> None:
    raw = '{"shots":[{"shot_id":"SHOT_001","characters":[{"asset_id":"CHAR_001","confidence":0.9},],}]}'
    normalized, _, _, warnings = parse_binding_response(raw, catalog=CATALOG, shots=SHOTS)
    assert normalized["SHOT_001"][0]["asset_id"] == "CHAR_001"
    assert any("JSON 抢救" in w for w in warnings)


# ---------------------------------------------------------------------------
# 对账
# ---------------------------------------------------------------------------


def test_reconcile_boosts_confidence_when_both_agree() -> None:
    suggestions, _ = reconcile_with_heuristic(
        rows=[{"slot": "characters", "asset_id": "CHAR_001", "asset_type": "character", "asset_name": "林晓",
               "confidence": 0.9, "reason": "入画"}],
        heuristic={"characters": ["CHAR_001"], "scene": [], "props": [], "costumes": []},
        bound_ids={"characters": set(), "scene": set(), "props": set(), "costumes": set()},
    )

    assert len(suggestions) == 1
    assert suggestions[0].agreement == "both"
    assert suggestions[0].confidence == 0.95  # 0.9 + 0.05
    assert suggestions[0].tier == "auto"


def test_reconcile_marks_llm_only_and_heuristic_only_and_conflict() -> None:
    suggestions, _ = reconcile_with_heuristic(
        rows=[{"slot": "scene", "asset_id": "SCENE_003", "asset_type": "scene", "asset_name": "A公司会议室",
               "confidence": 0.9, "reason": "空间标记"}],
        heuristic={"characters": ["CHAR_999"], "scene": [], "props": [], "costumes": []},
        bound_ids={"characters": set(), "scene": {"SCENE_777"}, "props": set(), "costumes": set()},
    )

    by_agreement = {item.agreement: item for item in suggestions}
    assert by_agreement["llm_only"].asset_id == "SCENE_003"
    assert by_agreement["heuristic_only"].asset_id == "CHAR_999"
    assert by_agreement["heuristic_only"].tier == "review"
    assert by_agreement["conflict"].asset_id == "SCENE_777"
    assert by_agreement["conflict"].already_bound is True


def test_reconcile_confirm_endpoint_points_at_existing_routes() -> None:
    suggestions, _ = reconcile_with_heuristic(
        rows=[
            {"slot": "scene", "asset_id": "SCENE_003", "asset_type": "scene", "asset_name": "会议室",
             "confidence": 0.9, "reason": "x"},
            {"slot": "costumes", "asset_id": "COST_001", "asset_type": "costume", "asset_name": "西装",
             "confidence": 0.9, "reason": "x"},
        ],
        heuristic={},
        bound_ids={},
    )

    mapping = {item.slot: item.confirm_endpoint for item in suggestions}
    assert mapping["scene"] == "POST /api/v1/studio/shot-links/scene"
    assert mapping["costumes"] == "POST /api/v1/studio/shot-links/costume"


# ---------------------------------------------------------------------------
# 服务层
# ---------------------------------------------------------------------------


async def _seed_binding_project(db) -> None:  # type: ignore[no-untyped-def]
    """种一个与 _db_payload 严格对齐的项目：镜头 ID 与资产 ID 都必须是真实存在的。"""
    from app.models.studio import Chapter, Character, Costume, ProjectCostumeLink, ProjectPropLink
    from app.models.studio import ProjectSceneLink, Prop, Scene, Shot

    await seed_project_chapter_shot(
        db,
        script_excerpt="林晓抱着合作合同快步走进A公司会议室，张总已经在长桌尽头等她。",
    )
    db.add(Chapter(id="chap-b", project_id="proj-1", index=2, title="第二集", raw_text="", condensed_text=""))
    await db.flush()
    db.add(
        Shot(
            id="shot-2",
            chapter_id="chap-b",
            index=2,
            title="掏手机",
            script_excerpt="张总穿着黑色西装，从内袋掏出手机。",
        )
    )
    db.add(Character(id="CHAR_001", project_id="proj-1", name="林晓", description="女主，A公司法务", style="真人都市"))
    db.add(Character(id="CHAR_002", project_id="proj-1", name="张总", description="反派", style="真人都市"))
    db.add(Scene(id="SCENE_003", name="A公司会议室", description="现代办公会议室", style="真人都市", tags=["会议室"]))
    db.add(Prop(id="PROP_002", name="合作合同", description="蓝色封面", style="真人都市", tags=["合同"]))
    db.add(Costume(id="COST_001", name="黑色西装", description="张总的西装", style="真人都市", tags=["西装"]))
    await db.flush()
    db.add(ProjectSceneLink(id=1, project_id="proj-1", shot_id="shot-1", scene_id="SCENE_003"))
    db.add(ProjectPropLink(id=1, project_id="proj-1", prop_id="PROP_002"))
    db.add(ProjectCostumeLink(id=1, project_id="proj-1", costume_id="COST_001"))
    await db.flush()


def _db_payload() -> dict[str, object]:
    """与 _seed_binding_project 的镜头 ID / 资产 ID 严格对齐的模型回包。"""
    return {
        "shots": [
            {
                "shot_id": "shot-1",
                "characters": [_slot("CHAR_001", 0.95)],
                "scene": _slot("SCENE_003", 0.9),
                "props": [_slot("PROP_002", 0.85)],
                "costumes": [],
                "unmatched_names": [{"name": "黑袍人", "guessed_type": "character", "evidence": "剧情提到"}],
            },
            {
                "shot_id": "shot-2",
                "characters": [_slot("CHAR_002", 0.88)],
                "scene": None,
                "props": [],
                "costumes": [_slot("COST_001", 0.8)],
                "unmatched_names": [],
            },
        ]
    }


@pytest.mark.asyncio
async def test_preview_asset_binding_success_with_stub() -> None:
    caller, prompts = make_recording_stub_caller(_db_payload())

    db, engine = await build_session()
    async with db:
        await _seed_binding_project(db)
        result = await preview_asset_binding(
            db, body=AssetBindingPreviewRequest(project_id="proj-1"), llm_caller=caller
        )

    assert result.meta.llm_called is True
    assert result.batch_count == 1
    assert result.batch_size == 8
    assert {item.asset_id for item in result.catalog} == {
        "CHAR_001",
        "CHAR_002",
        "SCENE_003",
        "PROP_002",
        "COST_001",
    }
    assert result.dropped == []
    assert [item.name for item in result.unmatched_names] == ["黑袍人"]

    shot1 = next(shot for shot in result.shots if shot.shot_id == "shot-1")
    suggestions = {item.asset_id: item for item in shot1.suggestions}
    # 名称/别名都在镜头文本里出现 → LLM 与启发式一致，置信度 +0.05 并进 auto 层
    assert suggestions["CHAR_001"].agreement == "both"
    assert suggestions["CHAR_001"].confidence == 1.0
    assert suggestions["CHAR_001"].tier == "auto"
    assert suggestions["SCENE_003"].already_bound is True
    assert suggestions["PROP_002"].slot == "props"
    assert all(item.confirm_endpoint for item in shot1.suggestions)

    shot2 = next(shot for shot in result.shots if shot.shot_id == "shot-2")
    assert {item.asset_id for item in shot2.suggestions} == {"CHAR_002", "COST_001"}
    assert result.tier_summary["auto"] == 5
    assert result.tier_summary["discard"] == 0

    assert "asset_id 只能从这里选" in prompts[0]
    assert "服装" in prompts[0]  # Jellyfish 追加的服装槽位
    assert "costumes" in prompts[0]
    assert "shot-1" in prompts[0]
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_asset_binding_dry_run_uses_heuristic_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JELLYFISH_DRY_RUN", "1")

    db, engine = await build_session()
    async with db:
        await _seed_binding_project(db)
        result = await preview_asset_binding(db, body=AssetBindingPreviewRequest(project_id="proj-1"))

    assert result.meta.dry_run is True
    assert result.meta.llm_called is False
    shot1 = next(shot for shot in result.shots if shot.shot_id == "shot-1")
    # 只跑启发式：命中的资产以 heuristic_only 出现，已绑定未命中的升级为 conflict
    by_id = {item.asset_id: item for item in shot1.suggestions}
    assert by_id["CHAR_001"].agreement == "heuristic_only"
    assert by_id["CHAR_001"].tier == "review"
    assert by_id["SCENE_003"].agreement == "conflict"
    assert by_id["SCENE_003"].already_bound is True
    assert all(item.tier == "review" for item in shot1.suggestions)
    assert any("DRY_RUN" in warning for warning in shot1.warnings)
    assert "不产生任何费用" in result.cost_note
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_asset_binding_bad_json_raises_422() -> None:
    caller = make_recording_stub_caller("完全不是 JSON")[0]

    db, engine = await build_session()
    async with db:
        await _seed_binding_project(db)
        with pytest.raises(HTTPException) as exc_info:
            await preview_asset_binding(
                db, body=AssetBindingPreviewRequest(project_id="proj-1"), llm_caller=caller
            )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "llm_json_parse_failed"
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_asset_binding_rejects_project_without_assets() -> None:
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        with pytest.raises(HTTPException) as exc_info:
            await preview_asset_binding(
                db,
                body=AssetBindingPreviewRequest(project_id="proj-1"),
                llm_caller=make_recording_stub_caller({"shots": []})[0],
            )

    assert exc_info.value.status_code == 400
    assert "没有可绑定资产" in exc_info.value.detail
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_asset_binding_warns_on_unknown_shot_ids() -> None:
    caller = make_recording_stub_caller({"shots": []})[0]

    db, engine = await build_session()
    async with db:
        await _seed_binding_project(db)
        result = await preview_asset_binding(
            db,
            body=AssetBindingPreviewRequest(project_id="proj-1", shot_ids=["shot-1", "shot-nope"]),
            llm_caller=caller,
        )

    assert [shot.shot_id for shot in result.shots] == ["shot-1"]
    assert any("shot-nope" in warning for warning in result.parse_warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_asset_binding_batches_shots() -> None:
    from app.models.studio import Shot

    caller, prompts = make_recording_stub_caller({"shots": []})

    db, engine = await build_session()
    async with db:
        await _seed_binding_project(db)
        # 种子里已有 shot-1 / shot-2，这里再补两个 → 共 4 镜，batch_size=2 应切成 2 批
        for i in (3, 4):
            db.add(
                Shot(
                    id=f"shot-{i}",
                    chapter_id="chap-b",
                    index=i,
                    title=f"镜头{i}",
                    script_excerpt="林晓走进会议室。",
                )
            )
        await db.flush()

        result = await preview_asset_binding(
            db,
            body=AssetBindingPreviewRequest(project_id="proj-1", batch_size=2),
            llm_caller=caller,
        )

    assert result.batch_count == 2
    assert result.batch_size == 2
    assert len(prompts) == 2
    assert len(result.shots) == 4
    await engine.dispose()


# ---------------------------------------------------------------------------
# 只建议不写库（对应用户方案文档 §8.2 的 banned 检查）
# ---------------------------------------------------------------------------


def test_asset_binding_module_contains_no_db_writes_or_direct_http() -> None:
    """P2 服务不得直接写库，也不得绕过守卫直接发 HTTP。"""
    source = MODULE_PATH.read_text(encoding="utf-8")
    for banned in ("db.add(", "db.commit(", "db.flush(", "session.add(", "db.delete("):
        assert banned not in source, f"P2 服务不应出现写库调用：{banned}"
    assert "import httpx" not in source, "P2 服务不应直接持有 httpx（HTTP 只能走受守卫的 client）"
    assert "httpx." not in source


def test_confirm_endpoints_match_existing_write_routes(client) -> None:  # type: ignore[no-untyped-def]
    """confirm_endpoint 必须指向真实存在的既有写库端点（本任务不新增写路由）。"""
    from app.main import app
    from app.services.studio.llm_orchestration.asset_binding import CONFIRM_ENDPOINTS

    openapi_paths = set(app.openapi()["paths"].keys())
    for asset_type, endpoint in CONFIRM_ENDPOINTS.items():
        method, _, path = endpoint.partition(" ")
        assert path in openapi_paths, f"{asset_type} 的确认端点不存在：{path}"
        assert method.lower() in {m.lower() for m in app.openapi()["paths"][path]} or "post" in {
            m.lower() for m in app.openapi()["paths"][path]
        }
