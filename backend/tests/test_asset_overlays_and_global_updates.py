"""数据边界（用户 2026-09 补充）：全局资产的**章节隔离** + 全局更新的**显式确认**。

规则（本文件的每条用例都在钉住它）：

1. **角色**归属项目（``characters.project_id``），资料可以存在项目内；
2. **场景 / 道具 / 服装是全局资产**：本章提取出的**剧情身份 / 出场依据 / 临时补充**
   必须按项目/章节隔离保存（``asset_overlays``）；
3. **不得静默覆盖**全局资产的通用资料或图片提示词；
4. 确实要更新全局资产 → **差异预览 + 显式确认**（``global_asset_updates``）。
"""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from app.models.studio import (
    Chapter,
    Character,
    Project,
    ProjectSceneLink,
    Scene,
    Shot,
    ShotExtractedCandidate,
)
from app.models.types import ShotCandidateType
from app.services.studio.asset_overlays import (
    OVERLAY_PAYLOAD_KEY,
    load_chapter_overlays,
    temporal_field_keys,
)
from app.services.studio.chapter_asset_profile_cache import clear_chapter_profile_cache
from app.services.studio.chapter_asset_profile_confirm import confirm_chapter_asset_profiles
from app.services.studio.chapter_asset_profiles import build_chapter_asset_profiles
from app.services.studio.chapter_asset_record_store import list_chapter_records
from app.services.studio.global_asset_updates import (
    GLOBAL_UPDATE_CONFIRM_FIELD,
    apply_global_updates,
    preview_global_updates,
)
from app.services.studio.llm_orchestration.context import load_project_entity_profiles
from tests.llm_orchestration_fixtures import build_session, make_recording_stub_caller

SCRIPT_A = (
    "第一场 夜 内 听雨轩\n"
    "姜岁欢跪在听雨轩的冰冷青砖上，窗外秋雨敲瓦，烛火被穿堂风吹得摇晃。\n"
    "她把镶银匕首藏在袖中，指尖发抖。\n"
    "脚边的铜镜被碰落在地，碎成两半。\n"
)
SHOT_A1 = "姜岁欢跪在听雨轩的冰冷青砖上，烛火摇晃，袖中藏着镶银匕首。"

SCRIPT_B = (
    "第二场 日 内 听雨轩\n"
    "白日里的听雨轩窗明几净，姜岁欢立于窗前，案上新添一炉沉水香。\n"
)
SHOT_B1 = "白日里的听雨轩窗明几净；姜岁欢立于听雨轩窗前。"

GLOBAL_SCENE_DESCRIPTION = "听雨轩，临水木构小轩，四面开窗。"
GLOBAL_SCENE_PROMPT = "听雨轩，临水木构小轩，四面开窗，青瓦飞檐，cinematic live-action environment"


def _payload(scene_extra: dict[str, str]) -> dict[str, object]:
    return {
        "assets": [
            {
                "name": "姜岁欢",
                "aliases": [],
                "asset_type": "character",
                "fields": {
                    "identity": "将军府庶女",
                    "gender_age": "女，十六岁",
                    "appearance": "鹅蛋脸杏眼",
                    "hairstyle": "双环髻",
                },
                "shot_indexes": [1],
                "evidence": [],
            },
            {
                "name": "听雨轩",
                "aliases": [],
                "asset_type": "scene",
                "fields": {
                    "era_location": "古代将军府临水小轩",
                    "indoor_outdoor": "室内",
                    "spatial_structure": "三间开敞，四面花窗",
                    "furnishings": "冰冷青砖、乌木矮几、青铜烛台",
                    "atmosphere": "幽闭不安",
                    **scene_extra,
                },
                "shot_indexes": [1],
                "evidence": [],
            },
            {
                "name": "镶银匕首",
                "aliases": [],
                "asset_type": "prop",
                "fields": {
                    "material": "精铁镶银",
                    "color": "冷银与暗灰",
                    "shape": "短刃直背，柄尾嵌银环",
                    "size": "约七寸",
                    "usage": "袖中藏匿防身",
                    "owner": "姜岁欢",
                },
                "shot_indexes": [1],
                "evidence": [],
            },
        ]
    }


async def _seed_two_chapters(db) -> None:
    """一个项目、两章、一个**全局**场景（两章共用）+ 全局道具。"""
    db.add(Project(id="proj-1", name="验收项目", description="", style="真人古装", visual_style="现实"))
    await db.flush()
    for chapter_id, index, title, text in (
        ("chap-a", 1, "第一集", SCRIPT_A),
        ("chap-b", 2, "第二集", SCRIPT_B),
    ):
        db.add(
            Chapter(
                id=chapter_id,
                project_id="proj-1",
                index=index,
                title=title,
                raw_text=text,
                condensed_text=text,
            )
        )
    await db.flush()
    db.add(Shot(id="shot-a1", chapter_id="chap-a", index=1, title="夜雨惊魂", script_excerpt=SHOT_A1))
    db.add(Shot(id="shot-b1", chapter_id="chap-b", index=1, title="白日窗前", script_excerpt=SHOT_B1))
    await db.flush()
    # 全局资产：一个场景行、一个道具行，被两章共用（名称全局唯一）
    db.add(Scene(id="scene-global", name="听雨轩", description=GLOBAL_SCENE_DESCRIPTION, style="真人古装"))
    await db.flush()
    db.add(
        ProjectSceneLink(project_id="proj-1", chapter_id=None, shot_id=None, scene_id="scene-global")
    )
    await db.flush()
    for shot_id, candidate_type, name in (
        ("shot-a1", ShotCandidateType.character, "姜岁欢"),
        ("shot-a1", ShotCandidateType.scene, "听雨轩"),
        ("shot-a1", ShotCandidateType.prop, "镶银匕首"),
        ("shot-b1", ShotCandidateType.character, "姜岁欢"),
        ("shot-b1", ShotCandidateType.scene, "听雨轩"),
    ):
        db.add(
            ShotExtractedCandidate(
                shot_id=shot_id,
                candidate_type=candidate_type,
                candidate_name=name,
                payload={},
                source="extraction",
            )
        )
    await db.flush()


async def _build_and_confirm(db, *, chapter_id: str, scene_extra: dict[str, str]) -> dict:
    clear_chapter_profile_cache()
    caller, _ = make_recording_stub_caller(_payload(scene_extra))
    await build_chapter_asset_profiles(db, chapter_id=chapter_id, llm_caller=caller)
    return await confirm_chapter_asset_profiles(db, chapter_id=chapter_id)


# ---------------------------------------------------------------------------
# ① 全局资产：不写全局列，资料进章节 overlay
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_global_scene_is_not_overwritten_and_overlay_is_persisted() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        result = await _build_and_confirm(db, chapter_id="chap-a", scene_extra={"light_tone": "烛火暖黄"})

        scene = await db.get(Scene, "scene-global")
        # 全局资产的通用资料与图片提示词**一个字都没变**
        assert scene.description == GLOBAL_SCENE_DESCRIPTION

        entry = next(item for item in result["results"] if item["name"] == "听雨轩")
        assert entry["action"] == "link_existing"
        assert entry["global_write_skipped"] is True
        assert entry["chapter_scoped"] is True
        assert entry["description_written"] is False
        assert "global_description" in entry["preserved"]
        # 章节资料现在落在**专用表**（chapter_asset_profiles）；确认结果里回带的是
        # chapter_record（已关联的真实资产 ID + 记录状态），语义与改造前的 overlay 一致。
        assert entry["chapter_record"]["bound"] is True
        assert entry["chapter_record"]["is_global_asset"] is True
        assert entry["chapter_record"]["asset_id"] == "scene-global"

        overlays = await load_chapter_overlays(db, chapter_id="chap-a")
        scene_overlay = next(item for item in overlays if item["name"] == "听雨轩")
        assert scene_overlay["scope"] == "chapter"
        assert scene_overlay["global_asset"] is True
        assert scene_overlay["chapter_fields"]["furnishings"] == "冰冷青砖、乌木矮几、青铜烛台"
        assert scene_overlay["chapter_fields"]["light_tone"] == "烛火暖黄"
        assert "临水小轩" in scene_overlay["plot_identity"]  # 剧情身份取自 era_location（本章字段）
        assert scene_overlay["temporary_notes"]  # 本章特有（时间天气/光线色调/相关事件）
        assert scene_overlay["shot_refs"][0]["shot_index"] == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_global_scene_image_prompt_untouched() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        scene = await db.get(Scene, "scene-global")
        scene.image_prompts = {"scene_image_front": GLOBAL_SCENE_PROMPT}
        await db.flush()

        await _build_and_confirm(db, chapter_id="chap-a", scene_extra={})
        refreshed = await db.get(Scene, "scene-global")
        assert refreshed.image_prompts == {"scene_image_front": GLOBAL_SCENE_PROMPT}, (
            "确认本章资产**绝不能**动全局资产的图片提示词"
        )
    await engine.dispose()


@pytest.mark.asyncio
async def test_character_is_project_scoped_and_overlay_records_plot_identity() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        db.add(
            Character(
                id="char-existing",
                project_id="proj-1",
                name="姜岁欢",
                description="",
                style="真人古装",
                visual_style="现实",
            )
        )
        await db.flush()
        result = await _build_and_confirm(db, chapter_id="chap-a", scene_extra={})

        girl = next(item for item in result["results"] if item["name"] == "姜岁欢")
        assert girl["action"] == "link_existing"
        assert girl["description_written"] is True  # 角色归属项目 → 允许写入
        assert girl["global_write_skipped"] is False
        assert girl["chapter_scoped"] is False

        row = await db.get(Character, "char-existing")
        assert "外貌：鹅蛋脸杏眼" in row.description

        overlays = await load_chapter_overlays(db, chapter_id="chap-a")
        girl_overlay = next(item for item in overlays if item["name"] == "姜岁欢")
        assert girl_overlay["global_asset"] is False
        assert "将军府庶女" in girl_overlay["plot_identity"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_existing_character_description_is_never_overwritten() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        db.add(
            Character(
                id="char-existing",
                project_id="proj-1",
                name="姜岁欢",
                description="人工写好的角色描述，一个字都不许动",
                style="真人古装",
                visual_style="现实",
            )
        )
        await db.flush()
        await _build_and_confirm(db, chapter_id="chap-a", scene_extra={})
        row = await db.get(Character, "char-existing")
        assert row.description == "人工写好的角色描述，一个字都不许动"
    await engine.dispose()


# ---------------------------------------------------------------------------
# ② 章节隔离：同一全局场景，两章资料互不污染
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_two_chapters_keep_separate_overlays_for_the_same_global_scene() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        await _build_and_confirm(db, chapter_id="chap-a", scene_extra={"light_tone": "烛火暖黄", "atmosphere": "幽闭不安"})
        await _build_and_confirm(db, chapter_id="chap-b", scene_extra={"light_tone": "白日冷白", "atmosphere": "明亮平静"})

        overlays_a = {item["name"]: item for item in await load_chapter_overlays(db, chapter_id="chap-a")}
        overlays_b = {item["name"]: item for item in await load_chapter_overlays(db, chapter_id="chap-b")}

        assert overlays_a["听雨轩"]["chapter_fields"]["light_tone"] == "烛火暖黄"
        assert overlays_b["听雨轩"]["chapter_fields"]["light_tone"] == "白日冷白"
        assert overlays_a["听雨轩"]["chapter_id"] == "chap-a"
        assert overlays_b["听雨轩"]["chapter_id"] == "chap-b"
        # 全局行仍然只有一个、描述没被任何一章改过
        scene = await db.get(Scene, "scene-global")
        assert scene.description == GLOBAL_SCENE_DESCRIPTION
    await engine.dispose()


@pytest.mark.asyncio
async def test_image_prompt_profile_is_scoped_to_the_requested_chapter() -> None:
    """图片提示词装载画像时只读**本章**资料：A 章读到"烛火暖黄"，B 章读到"白日冷白"。"""
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        await _build_and_confirm(db, chapter_id="chap-a", scene_extra={"light_tone": "烛火暖黄"})
        await _build_and_confirm(db, chapter_id="chap-b", scene_extra={"light_tone": "白日冷白"})

        profiles_a = await load_project_entity_profiles(db, project_id="proj-1", chapter_id="chap-a")
        profiles_b = await load_project_entity_profiles(db, project_id="proj-1", chapter_id="chap-b")
    await engine.dispose()

    scene_a = next(item for item in profiles_a if item.name == "听雨轩")
    scene_b = next(item for item in profiles_b if item.name == "听雨轩")

    assert "烛火暖黄" in scene_a.profile and "白日冷白" not in scene_a.profile
    assert "白日冷白" in scene_b.profile and "烛火暖黄" not in scene_b.profile
    # 全局通用资料仍然在（它属于全局资产，不是被覆盖掉的那种）
    assert "临水木构小轩" in scene_a.profile or "临水木构小轩" in scene_b.profile
    assert "外观信息不足" not in scene_a.profile
    assert "chapter_record" in scene_a.profile_source  # 如实标注来源（专用表里的本章资料）


@pytest.mark.asyncio
async def test_overlay_row_is_linked_so_readiness_does_not_regress() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        result = await _build_and_confirm(db, chapter_id="chap-a", scene_extra={})
        readiness = result["asset_readiness"]
        names = {item["name"] for item in readiness["items"]}
        assert {"姜岁欢", "听雨轩", "镶银匕首"} <= names

        # 带章节资料的候选行必须是 linked（否则会把资产推回"待确认"，
        # 让资产准备页出现假的 pending 状态）。章节资料本身现在存在**专用表**里，
        # 候选行上留的是证据（asset_profile / shot_refs / evidence）。
        rows = (await db.execute(ShotExtractedCandidate.__table__.select())).all()
        evidence_rows = [
            row
            for row in rows
            if str(row.shot_id) == "shot-a1"
            and isinstance(row.payload, dict)
            and row.payload.get("asset_profile")
        ]
        assert evidence_rows, "确认后本章候选行上应当留有结构化资料证据（asset_profile）"
        assert all(str(row.candidate_status) == "linked" for row in evidence_rows)

        # 章节资料落在专用表：按项目 + 章节隔离，重启不丢、重新提取候选也不丢
        records = await list_chapter_records(db, chapter_id="chap-a")
        assert records, "确认后 chapter_asset_profiles 里应当有本章资料行"
        assert all(str(record.status) == "confirmed" for record in records)
        assert all(str(record.asset_id or "") for record in records)

        # 第 2 章的候选仍未处理 → 项目级 pending 是既有正确行为，不该被 overlay 影响成"已确认"
        assert any(item["has_pending_candidate"] for item in readiness["items"])
    await engine.dispose()


@pytest.mark.asyncio
async def test_overlay_falls_back_to_chapter_only_scope_without_fabricating_evidence() -> None:
    """只在剧本原文出现、没有镜头提到它 → 仍按章节保存，但**不伪造**出场依据。"""
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        clear_chapter_profile_cache()

        async def _caller(_prompt: str) -> str:
            return json.dumps(
                {
                    "assets": [
                        {
                            "name": "听雨轩",
                            "aliases": [],
                            "asset_type": "scene",
                            "fields": {"era_location": "古代将军府临水小轩"},
                            "shot_indexes": [],
                            "evidence": [],
                        },
                        {
                            # 名字在**本章剧本原文**里有（"脚边的铜镜被碰落在地"），
                            # 但两个镜头的摘录都没写它 → 没有出场依据
                            "name": "铜镜",
                            "aliases": [],
                            "asset_type": "prop",
                            "fields": {"material": "青铜", "state": "碎成两半"},
                            "shot_indexes": [],
                            "evidence": [],
                        },
                    ]
                },
                ensure_ascii=False,
            )

        await build_chapter_asset_profiles(db, chapter_id="chap-a", llm_caller=_caller)
        result = await confirm_chapter_asset_profiles(db, chapter_id="chap-a")
        persisted = {item["name"]: item for item in await load_chapter_overlays(db, chapter_id="chap-a")}
    await engine.dispose()

    mirror = next(item for item in result["results"] if item["name"] == "铜镜")
    overlay = mirror["chapter_record"]
    assert overlay["bound"] is True
    assert persisted["铜镜"]["evidence_scope"] == "chapter_only"
    assert overlay["status"] == "confirmed"  # 确认后行状态如实回写
    assert persisted["铜镜"]["shot_refs"] == [], "没有镜头提到它 → 出场依据必须如实留空"
    assert persisted["铜镜"]["chapter_fields"]["state"] == "碎成两半"


# ---------------------------------------------------------------------------
# ③ 全局更新：差异预览 + 显式确认
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_global_update_preview_shows_diff_without_writing() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        await _build_and_confirm(db, chapter_id="chap-a", scene_extra={"light_tone": "烛火暖黄"})

        preview = await preview_global_updates(db, chapter_id="chap-a")
        scene = await db.get(Scene, "scene-global")
        assert scene.description == GLOBAL_SCENE_DESCRIPTION  # 预览不写库

        entry = next(item for item in preview["items"] if item["name"] == "听雨轩")
        assert entry["requires_confirmation"] is True
        assert entry["global_asset"] is True
        diff = entry["diff"]["description"]
        assert diff["before"] == GLOBAL_SCENE_DESCRIPTION
        assert diff["added"], "本章通用资料应当在提议里体现为新增段"
        # 本章特有字段（光线色调）**不进**全局提议
        assert "烛火暖黄" not in diff["proposed"]
        assert "本章特有" in json.dumps(entry["chapter_scope"], ensure_ascii=False) or entry["chapter_scope"][
            "chapter_only_fields"
        ]
        assert preview["items"][0]["diff"]["image_prompts"]["changed"] is False
    await engine.dispose()


@pytest.mark.asyncio
async def test_global_update_requires_explicit_confirmation() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        await _build_and_confirm(db, chapter_id="chap-a", scene_extra={})

        with pytest.raises(HTTPException) as exc_info:
            await apply_global_updates(
                db,
                chapter_id="chap-a",
                body={
                    "items": [{"asset_type": "scene", "asset_id": "scene-global", "apply": ["description"]}]
                },
            )
        assert exc_info.value.status_code == 409
        detail = exc_info.value.detail
        assert detail["code"] == "global_asset_update_required"
        assert detail["confirm_field"] == GLOBAL_UPDATE_CONFIRM_FIELD
        assert detail["diff"], "409 里必须把差异一起给出来，用户才能看着差异决定"

        scene = await db.get(Scene, "scene-global")
        assert scene.description == GLOBAL_SCENE_DESCRIPTION  # 没确认 → 一个字都没写
    await engine.dispose()


@pytest.mark.asyncio
async def test_global_update_applies_only_whitelisted_fields_after_confirmation() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        await _build_and_confirm(db, chapter_id="chap-a", scene_extra={"light_tone": "烛火暖黄"})

        result = await apply_global_updates(
            db,
            chapter_id="chap-a",
            body={
                GLOBAL_UPDATE_CONFIRM_FIELD: True,
                "items": [{"asset_type": "scene", "asset_id": "scene-global", "apply": ["description"]}],
            },
        )
        assert result["summary"]["applied"] >= 1
        scene = await db.get(Scene, "scene-global")
        assert "临水木构小轩" in scene.description  # 原有内容保留
        assert "三间开敞" in scene.description  # 本章通用资料合并进去
        assert "烛火暖黄" not in scene.description  # 本章特有字段仍然不写全局

        # 章节 overlay 仍然独立保存（不因为写回全局就丢掉）
        overlays = {item["name"]: item for item in await load_chapter_overlays(db, chapter_id="chap-a")}
        assert overlays["听雨轩"]["chapter_fields"]["light_tone"] == "烛火暖黄"
    await engine.dispose()


@pytest.mark.asyncio
async def test_global_update_rejects_unknown_field_and_unknown_asset() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        await _build_and_confirm(db, chapter_id="chap-a", scene_extra={})

        with pytest.raises(HTTPException) as exc_info:
            await apply_global_updates(
                db,
                chapter_id="chap-a",
                body={
                    GLOBAL_UPDATE_CONFIRM_FIELD: True,
                    "items": [{"asset_type": "scene", "asset_id": "scene-global", "apply": ["temporary_notes"]}],
                },
            )
        assert exc_info.value.status_code == 422
        assert "temporary_notes" in json.dumps(exc_info.value.detail, ensure_ascii=False)

        with pytest.raises(HTTPException) as exc_info2:
            await apply_global_updates(
                db,
                chapter_id="chap-a",
                body={
                    GLOBAL_UPDATE_CONFIRM_FIELD: True,
                    "items": [{"asset_type": "scene", "asset_id": "scene-other", "apply": ["description"]}],
                },
            )
        assert exc_info2.value.status_code == 422
        assert exc_info2.value.detail["code"] == "global_update_target_unknown"
    await engine.dispose()


@pytest.mark.asyncio
async def test_global_update_image_prompts_need_extra_flag() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_two_scene_with_prompt(db)
        with pytest.raises(HTTPException) as exc_info:
            await apply_global_updates(
                db,
                chapter_id="chap-a",
                body={
                    GLOBAL_UPDATE_CONFIRM_FIELD: True,
                    "items": [{"asset_type": "scene", "asset_id": "scene-global", "apply": ["image_prompts"]}],
                    "image_prompts": {"scene_image_front": "听雨轩，三间开敞，四面花窗，青砖地面"},
                },
            )
        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["code"] == "image_prompt_replace_required"
    await engine.dispose()


async def _seed_two_scene_with_prompt(db) -> None:
    await _seed_two_chapters(db)
    await _build_and_confirm(db, chapter_id="chap-a", scene_extra={})
    scene = await db.get(Scene, "scene-global")
    scene.image_prompts = {"scene_image_front": GLOBAL_SCENE_PROMPT}
    await db.flush()


@pytest.mark.asyncio
async def test_character_has_no_global_update_entry() -> None:
    """角色归属项目，不属于"全局资产"，因此不出现在全局更新清单里。"""
    db, engine = await build_session()
    async with db:
        await _seed_two_chapters(db)
        await _build_and_confirm(db, chapter_id="chap-a", scene_extra={})
        preview = await preview_global_updates(db, chapter_id="chap-a")
    await engine.dispose()

    assert all(item["asset_type"] != "character" for item in preview["items"])


def test_temporal_fields_excluded_from_general_fields() -> None:
    from app.services.studio.asset_overlays import general_field_keys

    for asset_type in ("scene", "prop", "costume", "character"):
        temporal = set(temporal_field_keys(asset_type))
        general = set(general_field_keys(asset_type))
        assert temporal and general
        assert not (temporal & general), f"{asset_type} 的本章特有字段不能出现在通用资料里"


def test_overlay_payload_key_is_stable() -> None:
    assert OVERLAY_PAYLOAD_KEY == "chapter_overlay"
