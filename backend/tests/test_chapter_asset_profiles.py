"""第 2 步「资产准备」的数据链路：结构化资料 / 别名合并 / 冲突判定 / 落库 / 生产区可读。

这一批用例覆盖用户口径里的 ①②③④，并且**每一步都断言"资料没有丢"**：
从本章完整剧本 → 结构化清单 → 确认落库 → 图片提示词的画像卡，
只要哪一层把资料丢了，下面就会有一条用例红。
"""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from app.models.studio import Character, Chapter, Project, Prop, Scene, Shot, ShotExtractedCandidate
from app.models.types import ShotCandidateType
from app.services.studio.asset_profiles import (
    normalize_profile,
    profile_missing_fields,
    render_profile_text,
)
from app.services.studio.chapter_asset_profile_cache import clear_chapter_profile_cache
from app.services.studio.chapter_asset_profile_confirm import confirm_chapter_asset_profiles
from app.services.studio.chapter_asset_profiles import build_chapter_asset_profiles
from tests.llm_orchestration_fixtures import build_session, make_recording_stub_caller

CHAPTER_TEXT = (
    "第一场 日 内 将军府·正堂\n"
    "秦老夫人拄着乌木拐杖立于堂前，凤纹织金褙子一丝不苟。\n"
    "姜岁欢跪在青砖地上，素白襦裙沾了泥，腰间垂着一枚羊脂玉佩。\n"
    "秦老夫人：把嫁妆单子交出来。\n"
)
SHOT_1 = "秦老夫人拄乌木拐杖立于堂前，威压逼问；姜岁欢跪在青砖地上，腰间垂羊脂玉佩。"
SHOT_2 = "姜岁欢攥紧羊脂玉佩起身，素白襦裙下摆沾着泥。"


def _model_payload() -> dict[str, object]:
    """一份"大模型应该返回"的结构化清单（桩，不出网）。"""
    return {
        "assets": [
            {
                "name": "姜岁欢",
                "aliases": ["岁欢"],
                "asset_type": "character",
                "fields": {
                    "identity": "将军府庶女",
                    "relations": "秦老夫人的孙女",
                    "gender_age": "女，十六岁",
                    "era": "古代架空王朝",
                    "appearance": "鹅蛋脸杏眼，肤色白皙，身形纤细",
                    "hairstyle": "乌黑长直发束双环髻",
                    "costume_accessories": "素白交领襦裙，腰间垂羊脂玉佩",
                    "personality": "隐忍倔强",
                },
                "shot_indexes": [1, 2],
                "evidence": ["姜岁欢跪在青砖地上，素白襦裙沾了泥，腰间垂着一枚羊脂玉佩。"],
            },
            {
                "name": "姜岁欢",
                "aliases": ["欢儿"],
                "asset_type": "character",
                "fields": {"appearance": "鹅蛋脸杏眼", "personality": "外柔内刚"},
                "shot_indexes": [2],
                "evidence": [],
            },
            {
                "name": "秦老夫人",
                "aliases": ["老夫人"],
                "asset_type": "character",
                "fields": {
                    "identity": "将军府当家主母",
                    "relations": "姜岁欢的祖母",
                    "gender_age": "女，六十余岁",
                    "era": "古代架空王朝",
                    "appearance": "鬓发花白，面容清瘦严峻",
                    "hairstyle": "圆髻插银簪",
                    "costume_accessories": "凤纹织金褙子，拄乌木拐杖",
                    "personality": "刻薄强势",
                },
                "shot_indexes": [1],
                "evidence": ["秦老夫人拄着乌木拐杖立于堂前，凤纹织金褙子一丝不苟。"],
            },
            {
                "name": "将军府·正堂",
                "aliases": ["正堂"],
                "asset_type": "scene",
                "fields": {
                    "era_location": "古代将军府正堂",
                    "indoor_outdoor": "室内",
                    "time_weather": "白天，晴",
                    "spatial_structure": "高梁方厅，正中设主位",
                    "furnishings": "青砖地面，乌木太师椅，条案上摆青铜香炉",
                    "light_tone": "顶光下的冷白日光，梁柱投影深重",
                    "atmosphere": "肃穆压抑",
                },
                "shot_indexes": [1],
                "evidence": [],
            },
            {
                "name": "乌木拐杖",
                "aliases": [],
                "asset_type": "prop",
                "fields": {
                    "material": "乌木",
                    "color": "深褐近黑",
                    "shape": "直杆带龙首弯柄",
                    "size": "约一米二",
                    "state": "包浆温润，握柄处有磨痕",
                    "usage": "支撑行走，也用来指点训斥",
                    "owner": "秦老夫人",
                    "plot_role": "威压的视觉符号",
                },
                "shot_indexes": [1],
                "evidence": [],
            },
            {
                "name": "素白襦裙",
                "aliases": [],
                "asset_type": "costume",
                "fields": {
                    "wearer": "姜岁欢",
                    "identity_era": "古代庶女常服",
                    "style": "交领右衽，上襦下裙",
                    "color": "素白",
                    "material": "细棉布",
                    "accessories": "素色布腰带",
                    "occasion": "日常与堂前回话",
                },
                "shot_indexes": [1, 2],
                "evidence": [],
            },
            {
                "name": "并不存在的黑衣人",
                "aliases": [],
                "asset_type": "character",
                "fields": {"appearance": "黑袍蒙面"},
                "shot_indexes": [9],
                "evidence": [],
            },
            {
                "name": "妆容",
                "aliases": [],
                "asset_type": "makeup",
                "fields": {"style": "淡妆"},
                "shot_indexes": [1],
                "evidence": [],
            },
        ]
    }


async def _seed(db, *, chapter_text: str = CHAPTER_TEXT) -> None:
    db.add(Project(id="proj-1", name="测试项目", description="", style="真人古装", visual_style="现实"))
    await db.flush()
    db.add(
        Chapter(
            id="chap-1",
            project_id="proj-1",
            index=1,
            title="第一集",
            raw_text=chapter_text,
            condensed_text=chapter_text,
        )
    )
    await db.flush()
    db.add(Shot(id="shot-1", chapter_id="chap-1", index=1, title="正堂逼问", script_excerpt=SHOT_1))
    db.add(Shot(id="shot-2", chapter_id="chap-1", index=2, title="起身", script_excerpt=SHOT_2))
    await db.flush()


async def _seed_candidates(db) -> None:
    """按第 1 层（/script-processing/extract）的真实落库形态写入候选。"""
    rows = [
        ("shot-1", ShotCandidateType.character, "秦老夫人", {"description": ""}),
        ("shot-1", ShotCandidateType.character, "姜岁欢", {"description": ""}),
        ("shot-1", ShotCandidateType.scene, "将军府·正堂", {}),
        ("shot-1", ShotCandidateType.prop, "乌木拐杖", {}),
        ("shot-2", ShotCandidateType.costume, "素白襦裙", {}),
    ]
    for shot_id, candidate_type, name, payload in rows:
        db.add(
            ShotExtractedCandidate(
                shot_id=shot_id,
                candidate_type=candidate_type,
                candidate_name=name,
                payload=payload,
            )
        )
    await db.flush()


# ---------------------------------------------------------------------------
# ① 结构化资料：基于本章完整剧本 + 分镜
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_profiles_reads_full_chapter_script_and_shots() -> None:
    """提示词里必须带**本章完整剧本**与**分镜（含镜头 id/序号）**，而不是只有一个镜头。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        clear_chapter_profile_cache()
        caller, prompts = make_recording_stub_caller(_model_payload())
        result = await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
    await engine.dispose()

    prompt = prompts[0]
    assert "姜岁欢跪在青砖地上，素白襦裙沾了泥，腰间垂着一枚羊脂玉佩。" in prompt  # 章节原文
    assert "镜头 1（shot-1）" in prompt and "镜头 2（shot-2）" in prompt  # 分镜（带 id 与序号）
    assert "秦老夫人" in prompt and "将军府·正堂" in prompt  # 已有候选被复用
    assert abs(result["script_chars"] - len(CHAPTER_TEXT)) <= 2  # load_chapter_source 会 strip 首尾空白
    assert result["shot_total"] == 2


@pytest.mark.asyncio
async def test_profile_fields_and_evidence_are_kept() -> None:
    """四类资产各自的结构化字段 + 出场镜头 + 剧本原文依据都必须留下。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        result = await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
    await engine.dispose()

    items = {item["name"]: item for item in result["user_flow"]["items"]}
    assert set(items) >= {"姜岁欢", "秦老夫人", "将军府·正堂", "乌木拐杖", "素白襦裙"}

    girl = items["姜岁欢"]
    assert girl["asset_type"] == "character"
    assert girl["fields"]["appearance"] == "鹅蛋脸杏眼，肤色白皙，身形纤细"
    assert girl["fields"]["hairstyle"] == "乌黑长直发束双环髻"
    assert [ref["shot_index"] for ref in girl["shot_refs"]] == [1, 2]
    assert "青砖地" in girl["shot_refs"][0]["script_excerpt"]
    assert "外貌：鹅蛋脸杏眼" in girl["summary"]

    prop = items["乌木拐杖"]
    assert prop["fields"]["material"] == "乌木"
    assert prop["fields"]["shape"] == "直杆带龙首弯柄"
    assert prop["fields"]["owner"] == "秦老夫人"

    scene = items["将军府·正堂"]
    assert scene["fields"]["indoor_outdoor"] == "室内"
    assert scene["fields"]["furnishings"] == "青砖地面，乌木太师椅，条案上摆青铜香炉"

    costume = items["素白襦裙"]
    assert costume["fields"]["wearer"] == "姜岁欢"
    assert costume["fields"]["style"] == "交领右衽，上襦下裙"


@pytest.mark.asyncio
async def test_unmatched_and_hallucinated_items_are_dropped_with_reason() -> None:
    """类型不在范围内 / 原文里根本没有的条目 → 丢弃，并给中文原因（不猜、不编）。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        result = await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
    await engine.dispose()

    dropped = {entry["name"]: entry for entry in result["technical_detail"]["dropped_model_items"]}
    assert "并不存在的黑衣人" in dropped
    assert "原文" in dropped["并不存在的黑衣人"]["reason"]
    assert "妆容" in dropped
    assert "类型" in dropped["妆容"]["reason"]
    names = {item["name"] for item in result["user_flow"]["items"]}
    assert "并不存在的黑衣人" not in names and "妆容" not in names


@pytest.mark.asyncio
async def test_dry_run_returns_placeholder_not_invented_details() -> None:
    """演练模式：不编造外观细节，占位内容带 DRY_RUN 标记（不可能被误存成已就绪）。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        clear_chapter_profile_cache()
        result = await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=None)
    await engine.dispose()

    assert result["meta"]["llm_called"] is False
    assert result["meta"]["dry_run"] is True
    for item in result["user_flow"]["items"]:
        assert "[DRY_RUN 占位]" in item["summary"]
    assert result["user_flow"]["summary"]["asset_total"] == 5


# ---------------------------------------------------------------------------
# ② 别名与重复候选合并（保留全部来源证据）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_aliases_and_duplicate_candidates_merge_into_one_group() -> None:
    """模型把同一角色写成两条（姜岁欢 / 别名 岁欢、欢儿）→ 合成**一个**聚合组。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        result = await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)

    await engine.dispose()

    items = result["user_flow"]["items"]
    girls = [item for item in items if item["name"] == "姜岁欢"]
    assert len(girls) == 1, "同一实体不同叫法必须合成一组，不能出现两条"
    girl = girls[0]
    assert set(girl["aliases"]) >= {"岁欢", "欢儿"}
    # 字段是并集（第二条给了 personality 的另一次写法时，先到先得、不丢第一条）
    assert girl["fields"]["appearance"] == "鹅蛋脸杏眼，肤色白皙，身形纤细"

    merge = [entry for entry in result["technical_detail"]["alias_merge"] if entry["canonical_name"] == "姜岁欢"][0]
    assert set(merge["merged_names"]) == {"姜岁欢"}
    assert len(merge["sources"]) == 2, "同一组的每个来源条目都要留证据"
    assert {entry["name"] for entry in merge["sources"]} == {"姜岁欢"}


@pytest.mark.asyncio
async def test_candidate_group_keeps_alias_from_candidate_table() -> None:
    """候选表里已有的别名也要保留（聚合组的 aliases 是并集，不是覆盖）。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        # 候选表里多一条同一角色的另一种叫法
        db.add(
            ShotExtractedCandidate(
                shot_id="shot-2",
                candidate_type=ShotCandidateType.character,
                candidate_name="姜岁欢",
                payload={},
            )
        )
        await db.flush()
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        result = await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
    await engine.dispose()

    girl = next(item for item in result["user_flow"]["items"] if item["name"] == "姜岁欢")
    assert girl["shot_count"] == 2  # 两个镜头都算上


# ---------------------------------------------------------------------------
# ③ 已有资产自动匹配 + 冲突判定
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_conflict_items_are_auto_confirmable() -> None:
    """库里什么都没有 → 全部可直接确认（create_new），不需要人工。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        result = await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
    await engine.dispose()

    summary = result["user_flow"]["summary"]
    assert summary["needs_review"] == 0
    assert summary["auto_confirmable"] == summary["asset_total"]
    for item in result["user_flow"]["items"]:
        assert item["suggested_action"] == "create_new"
        assert item["auto_confirmable"] is True


@pytest.mark.asyncio
async def test_same_name_other_type_is_a_conflict_with_reason() -> None:
    """库里已有同名**场景**，本次判成**角色** → 冲突，需人工（并给出原因）。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        db.add(Scene(id="scene-x", name="姜岁欢", description="", style="真人古装"))
        await db.flush()
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        result = await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
    await engine.dispose()

    girl = next(item for item in result["user_flow"]["items"] if item["name"] == "姜岁欢")
    assert girl["auto_confirmable"] is False
    assert girl["conflict"]["code"] == "same_name_other_type"
    assert "场景" in girl["conflict"]["reason"]
    review = result["user_flow"]["needs_review"]
    assert any(entry["name"] == "姜岁欢" for entry in review)


@pytest.mark.asyncio
async def test_existing_same_type_is_link_existing_and_not_a_conflict() -> None:
    """库里已有同名同类型资产且描述不矛盾 → 建议"选用已有"，不算冲突。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        db.add(
            Character(
                id="char-old",
                project_id="proj-1",
                name="姜岁欢",
                description="鹅蛋脸杏眼，乌黑长直发，素白襦裙",
                style="真人古装",
                visual_style="现实",
            )
        )
        await db.flush()
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        result = await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
    await engine.dispose()

    girl = next(item for item in result["user_flow"]["items"] if item["name"] == "姜岁欢")
    assert girl["auto_confirmable"] is True
    assert girl["suggested_action"] == "link_existing"
    assert girl["existing_asset_id"] == "char-old"
    assert "选用已有" in girl["action_reason"]
    # 库里描述与本章资料有共同用词 → 连提示都没有，更不会有冲突：
    # "同名同类型 + 描述不矛盾" 就是**可直接确认**的情形，不该把用户拉进来逐个点。
    assert girl["conflict"] is None
    assert girl["notices"] == []


# ---------------------------------------------------------------------------
# ④ 确认落库：结构完整、来源可追溯、生产区立即可读
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_confirm_creates_assets_with_structured_description() -> None:
    """无冲突项直接确认 → 资产落库，``description`` 是结构化资料（不是空、不是空话）。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
        result = await confirm_chapter_asset_profiles(db, chapter_id="chap-1")

        assert result["summary"]["created"] == 5
        assert result["summary"]["skipped"] == 0

        girl = (
            await db.execute(
                Character.__table__.select().where(Character.__table__.c.name == "姜岁欢")
            )
        ).first()
        assert girl is not None
        description = str(girl.description)
        assert "外貌：鹅蛋脸杏眼，肤色白皙，身形纤细" in description
        assert "出场镜头：#1、#2" in description
        assert "外观信息不足" not in description

        prop = (await db.execute(Prop.__table__.select())).first()
        assert prop is not None
        assert "材质：乌木" in str(prop.description)
    await engine.dispose()


@pytest.mark.asyncio
async def test_confirm_writes_evidence_into_candidate_payload() -> None:
    """候选行的 ``payload`` 保留结构化资料与剧本依据（原始候选一行不动）。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
        await confirm_chapter_asset_profiles(db, chapter_id="chap-1")

        rows = (await db.execute(ShotExtractedCandidate.__table__.select())).all()
        target = next(row for row in rows if row.candidate_name == "乌木拐杖")
        payload = target.payload if isinstance(target.payload, dict) else json.loads(target.payload)
        assert payload["asset_profile"]["material"] == "乌木"
        assert payload["shot_refs"][0]["shot_index"] == 1
        assert payload["linked_entity_id"]
        assert str(target.candidate_status) in {"linked", "ShotCandidateStatus.linked"}
    await engine.dispose()


@pytest.mark.asyncio
async def test_confirm_is_readable_by_production_area() -> None:
    """确认后立刻能被生产区读到：``asset-readiness`` 口径里能看到这些资产。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
        result = await confirm_chapter_asset_profiles(db, chapter_id="chap-1")
    await engine.dispose()

    readiness = result["asset_readiness"]
    names = {item["name"] for item in readiness["items"]}
    assert {"姜岁欢", "秦老夫人", "将军府·正堂", "乌木拐杖", "素白襦裙"} <= names
    assert readiness["summary"]["total"] == 5
    # 候选已回写 linked → 不再有"待确认"把资产推回 pending
    assert all(item["has_pending_candidate"] is False for item in readiness["items"])


@pytest.mark.asyncio
async def test_confirm_without_generated_list_is_refused() -> None:
    """没有清单（或剧本改过）就确认 → 409 明确要求先生成，不拿空清单建空资产。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        clear_chapter_profile_cache()
        with pytest.raises(HTTPException) as exc_info:
            await confirm_chapter_asset_profiles(db, chapter_id="chap-1")
    await engine.dispose()

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "asset_profile_not_generated"
    assert "生成" in exc_info.value.detail["fix"]


@pytest.mark.asyncio
async def test_confirm_skips_conflicts_unless_explicitly_confirmed() -> None:
    """冲突项默认不写入；显式给决定 + confirm_conflict 才写。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        db.add(Scene(id="scene-x", name="姜岁欢", description="", style="真人古装"))
        await db.flush()
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)

        first = await confirm_chapter_asset_profiles(db, chapter_id="chap-1")
        skipped = [item for item in first["results"] if item["action"] == "skip"]
        assert any(item["name"] == "姜岁欢" for item in skipped)
        assert first["summary"]["needs_review_remaining"] >= 1

        second = await confirm_chapter_asset_profiles(
            db,
            chapter_id="chap-1",
            selections=[{"group_key": "character:姜岁欢", "action": "create_new", "confirm_conflict": True}],
            auto_confirm_unconflicted=False,
        )
        created = [item for item in second["results"] if item["action"] == "create_new"]
        assert [item["name"] for item in created] == ["姜岁欢"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_confirm_link_existing_never_overwrites_existing_content() -> None:
    """选用已有：已有描述 / image_prompts 原样保留，只在描述为空时补写。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        db.add(
            Character(
                id="char-old",
                project_id="proj-1",
                name="姜岁欢",
                description="人工写好的描述：清冷少女",
                style="真人古装",
                visual_style="现实",
                image_prompts={"character_image_front": "人工写好的提示词，十六岁少女素白襦裙"},
            )
        )
        await db.flush()
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
        result = await confirm_chapter_asset_profiles(db, chapter_id="chap-1")

        girl = next(item for item in result["results"] if item["name"] == "姜岁欢")
        assert girl["action"] == "link_existing"
        assert girl["description_written"] is False
        assert "description" in girl["preserved"]
        assert "image_prompts" in girl["preserved"]

        row = await db.get(Character, "char-old")
        assert row.description == "人工写好的描述：清冷少女"
        assert row.image_prompts["character_image_front"] == "人工写好的提示词，十六岁少女素白襦裙"
    await engine.dispose()


# ---------------------------------------------------------------------------
# ⑤ 资料终于到达图片提示词（这条链路的核心修复）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_image_prompt_gets_structured_profile_after_confirm() -> None:
    """确认落库后，图片提示词的画像卡必须带上剧本里的结构化资料（不再出现空话）。"""
    from app.services.studio.llm_orchestration.context import (
        build_profile_cards,
        load_project_entity_profiles,
        render_profile_cards,
    )

    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
        await confirm_chapter_asset_profiles(db, chapter_id="chap-1")

        profiles = await load_project_entity_profiles(db, project_id="proj-1")
        cards = build_profile_cards(profiles, source="project")
        rendered = render_profile_cards(cards)
    await engine.dispose()

    assert "外观信息不足" not in rendered
    assert "需人工补充" not in rendered
    girl = next(card for card in cards if card.name == "姜岁欢")
    assert "鹅蛋脸杏眼" in girl.canonical_subject
    assert "双环髻" in girl.canonical_subject
    assert girl.has_structured_profile is True
    # 来源标签如实反映"这段资料是从哪来的"：本章**持久化资料行**优先
    # （2026-09 起章节资料落在专用表 chapter_asset_profiles，
    #   不再是候选 payload 的 chapter_overlay），候选结构化资料与剧本片段仍是兜底。
    assert girl.profile_source.startswith("asset_description+")
    assert "chapter_record" in girl.profile_source


@pytest.mark.asyncio
async def test_image_prompt_enrichment_falls_back_to_candidate_and_script() -> None:
    """资产描述为空时，兜底也能从候选 payload / 剧本摘录拿到资料（不只剩空话）。"""
    from app.services.studio.llm_orchestration.context import load_project_entity_profiles

    db, engine = await build_session()
    async with db:
        await _seed(db)
        db.add(
            Character(
                id="char-1",
                project_id="proj-1",
                name="姜岁欢",
                description="",
                style="真人古装",
                visual_style="现实",
            )
        )
        await db.flush()
        # 候选带了结构化资料与镜头依据（第 2 步确认时的真实形态）
        db.add(
            ShotExtractedCandidate(
                shot_id="shot-1",
                candidate_type=ShotCandidateType.character,
                candidate_name="姜岁欢",
                payload={
                    "asset_profile": {"appearance": "鹅蛋脸杏眼", "costume_accessories": "素白襦裙"},
                    "shot_refs": [
                        {"shot_id": "shot-1", "shot_index": 1, "script_excerpt": "姜岁欢跪在青砖地上。"}
                    ],
                },
            )
        )
        await db.flush()
        profiles = await load_project_entity_profiles(db, project_id="proj-1")
    await engine.dispose()

    girl = next(item for item in profiles if item.name == "姜岁欢")
    assert "鹅蛋脸杏眼" in girl.profile
    assert "出场镜头：#1" in girl.profile
    assert girl.profile_source == "candidate_profile"


@pytest.mark.asyncio
async def test_image_prompt_enrichment_falls_back_to_chapter_script_window() -> None:
    """候选没有结构化资料、分镜也没有摘录时，仍能从章节原文取到该资产的那一段。"""
    from app.services.studio.llm_orchestration.context import load_project_entity_profiles

    db, engine = await build_session()
    async with db:
        await _seed(db)
        db.add(
            Character(
                id="char-1",
                project_id="proj-1",
                name="秦老夫人",
                description="",
                style="真人古装",
                visual_style="现实",
            )
        )
        await db.flush()
        db.add(
            ShotExtractedCandidate(
                shot_id="shot-1",
                candidate_type=ShotCandidateType.character,
                candidate_name="秦老夫人",
                payload={"id": "char-1", "description": ""},
            )
        )
        await db.flush()
        profiles = await load_project_entity_profiles(db, project_id="proj-1")
    await engine.dispose()

    old_lady = next(item for item in profiles if item.name == "秦老夫人")
    assert "乌木拐杖" in old_lady.profile
    assert "剧本依据" in old_lady.profile


@pytest.mark.asyncio
async def test_render_profile_text_is_deterministic_and_skips_evidence_by_default() -> None:
    """结构化资料渲染是确定性的；默认不把"出场镜头"写进出图提示词。"""
    profile = normalize_profile("prop", {"material": "乌木", "color": "深褐"})
    profile["plot_role"] = "威压符号"
    assert render_profile_text("prop", profile) == "材质：乌木；颜色：深褐"
    assert "剧情作用：威压符号" in render_profile_text("prop", profile, include_evidence_fields=True)
    assert profile_missing_fields("prop", profile)[0] == "形状"

@pytest.mark.asyncio
async def test_created_global_assets_only_carry_general_fields() -> None:
    """即使是本次新建的全局资产（场景/道具/服装），全局行也只写"通用资料"。

    本章特有的时间天气 / 光线色调 / 状态 / 使用场合只留在章节 overlay 里，
    "新建"与"选用已有"走的是同一条边界，不搞两套标准。
    """
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
        result = await confirm_chapter_asset_profiles(db, chapter_id="chap-1")

        scene = (await db.execute(Scene.__table__.select())).first()
        prop = (await db.execute(Prop.__table__.select())).first()
        assert scene is not None and prop is not None
        scene_description = str(scene.description)
        prop_description = str(prop.description)
    await engine.dispose()

    # 通用资料写进去了（这样别的项目复用这一行也有意义）
    assert "空间结构" in scene_description
    assert "陈设" in scene_description
    assert "氛围" in scene_description
    assert "材质：乌木" in prop_description
    assert "形状" in prop_description
    # 本章特有字段**没有**写进全局行
    assert "时间天气" not in scene_description
    assert "光线色调" not in scene_description
    assert "状态：" not in prop_description
    # 资产确实建出来了、四类齐全
    assert result["summary"]["created"] == 5


# ---------------------------------------------------------------------------
# 「同名」只能是**完全同名**：上游存在性检测是子串匹配，子串命中不得当成冲突
# ---------------------------------------------------------------------------

PARTIAL_MATCH_NOTICE = "partial_name_match_in_library"


@pytest.mark.asyncio
async def test_partial_name_match_is_a_notice_not_a_conflict() -> None:
    """库里服装「姜岁欢常服」不该让角色「姜岁欢」变成"必须人工处理"（真实踩过的坑）。

    上游 ``check_names_existence`` 用 ``name ILIKE '%查询名%'`` 做子串匹配（服务于
    「新建资产」时的"是不是已经有了"提醒），于是「姜岁欢」会命中「姜岁欢常服」。
    改造前这里被当成 ``same_name_other_type`` 冲突 → 角色**永远建不出来**、也不给关联，
    后面按资产的图片提示词直接 400（验收时真实发生）。
    正确行为：不冲突、不关联、无冲突可直接确认，只用提示如实点名库里那件资产。
    """
    from app.models.studio import Costume

    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        db.add(Costume(id="costume-yc", name="姜岁欢常服", description="", style="真人古装"))
        await db.flush()
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        result = await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
    await engine.dispose()

    girl = next(item for item in result["user_flow"]["items"] if item["name"] == "姜岁欢")
    assert girl["auto_confirmable"] is True, "子串命中不得阻塞自动确认"
    assert girl["conflict"] is None
    assert girl["existing_asset_id"] is None, "不能把角色关联到一件服装上"
    assert girl["suggested_action"] == "create_new"
    assert [notice["code"] for notice in girl["notices"]] == [PARTIAL_MATCH_NOTICE]
    assert girl["notices"][0]["existing_asset_name"] == "姜岁欢常服"
    assert girl["notices"][0]["existing_asset_type"] == "costume"
    assert not result["user_flow"]["needs_review"]


@pytest.mark.asyncio
async def test_exact_same_name_other_type_is_still_a_conflict() -> None:
    """完全同名（异类型）仍然是冲突 —— 修复不能顺手把真冲突也放过去。"""
    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        db.add(Prop(id="prop-exact", name="姜岁欢", description="", style="真人古装"))
        await db.flush()
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        result = await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
    await engine.dispose()

    girl = next(item for item in result["user_flow"]["items"] if item["name"] == "姜岁欢")
    assert girl["auto_confirmable"] is False
    assert girl["conflict"]["code"] == "same_name_other_type"


@pytest.mark.asyncio
async def test_partial_same_type_match_does_not_link() -> None:
    """同类里只有"名字包含它"的资产（角色「姜岁欢」vs 角色「姜岁欢替身」）→ 不关联、只提示。"""
    from app.models.studio import Character

    db, engine = await build_session()
    async with db:
        await _seed(db)
        await _seed_candidates(db)
        db.add(
            Character(
                id="char-double",
                project_id="proj-1",
                name="姜岁欢替身",
                description="替身演员",
                style="真人古装",
                visual_style="现实",
            )
        )
        await db.flush()
        clear_chapter_profile_cache()
        caller, _ = make_recording_stub_caller(_model_payload())
        result = await build_chapter_asset_profiles(db, chapter_id="chap-1", llm_caller=caller)
    await engine.dispose()

    girl = next(item for item in result["user_flow"]["items"] if item["name"] == "姜岁欢")
    assert girl["existing_asset_id"] is None, "名字里含它 ≠ 同一样东西，不能自动关联"
    assert girl["auto_confirmable"] is True
    assert girl["suggested_action"] == "create_new"
    assert [notice["code"] for notice in girl["notices"]] == [PARTIAL_MATCH_NOTICE]
