"""资产生产工作台：**一项资产只出现一次**的单一数据源 + 旧提示词重判 + 批量排除。

用户口径（2026-09，真实项目「御兽嫡长女」第 1 集暴露的问题）
=========================================================

1. 页面把三张表纵向堆在一起，同一批资产重复展示三次，还暴露大量后台维度；
2. 真实项目里 11 个资产（人物 7 / 场景 1 / 道具 3）描述全空、没有任何已保存提示词、
   ``chapter_asset_profiles`` 0 行 —— 页面却同时显示"可以生成图片"和"本次未提供生成依据"；
3. 旧数据里保存过的空话提示词（"外观信息不足，需人工补充"）仍然被当作"可出图"。

本文件的用例全部**零出网、零付费**：不调用任何模型、不出图；
服务层用例跑在内存库上，路由只读用例只对会话隔离层给出的**临时库**统计行数。
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.services.studio.asset_workbench import (
    REVIEW_ALIAS_CONFLICT,
    REVIEW_COSTUME_WITHOUT_ASSET,
    STATUS_NEEDS_PROFILE,
    STATUS_READY,
    build_chapter_asset_workbench,
)
from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot

PROJECT_ID = "proj-workbench"
CHAPTER_ID = "chap-workbench"
SHOT_1 = "shot-wb-1"
SHOT_2 = "shot-wb-2"

CHAPTER_TEXT = (
    "南安侯府大堂内，下人举起铁锤把钉子敲进棺材，乌鸦落在棺材板上喊救命。"
    "苏晚棠夺过铁锤撬开棺材，叶老夫人被邓嬷嬷扶着站在一旁，攥着佛珠念经。"
)

#: 真实项目的形态：人物 7 / 场景 1 / 道具 3（描述全空、无提示词、无资料行）
REAL_CHARACTERS = ("暖冬", "秋香", "秋月", "苏晚棠", "乌鸦", "下人们", "众人")
REAL_SCENE = "南安侯府大堂"
REAL_PROPS = ("钉子", "棺材", "铁锤")

GOOD_PROMPT = "双环髻插素银簪，鹅蛋脸杏眼，月白襦裙配羊脂玉佩，站姿笔直"
GOOD_PROMPT_OTHER = "银灰高髻插白玉簪，清瘦面容，凤纹织金褙子，手持翡翠佛珠"
OLD_FILLER_PROMPT = "叶老夫人（角色）：外观信息不足，需人工补充，角色正面展示，高清写实"


# ---------------------------------------------------------------------------
# 脚手架：内存库 + 资产 / 候选 / 资料行种子
# ---------------------------------------------------------------------------


async def _seed_assets(
    db: Any,
    *,
    characters: tuple[str, ...] = (),
    scene: str = "",
    props: tuple[str, ...] = (),
    costumes: tuple[str, ...] = (),
    descriptions: dict[str, str] | None = None,
    prompts: dict[str, dict[str, str]] | None = None,
) -> dict[str, str]:
    """写入资产行并**关联到项目**（场景/道具/服装靠关联表挂项目，与真实链路一致）。

    返回 ``{资产名称: 资产 id}``；``prompts`` 按名称写入 ``image_prompts``（模拟旧数据）。
    """
    from app.models.studio import (
        Character,
        Costume,
        ProjectCostumeLink,
        ProjectPropLink,
        ProjectSceneLink,
        Prop,
        Scene,
    )

    descriptions = descriptions or {}
    prompts = prompts or {}
    ids: dict[str, str] = {}
    created: dict[str, Any] = {}

    for index, name in enumerate(characters, start=1):
        asset_id = f"char-wb-{index}"
        created[name] = Character(
            id=asset_id,
            project_id=PROJECT_ID,
            name=name,
            description=descriptions.get(name, ""),
            style="真人古装",
        )
        db.add(created[name])
        ids[name] = asset_id
    if scene:
        asset_id = "scene-wb-1"
        created[scene] = Scene(
            id=asset_id, name=scene, description=descriptions.get(scene, ""), style="真人古装"
        )
        db.add(created[scene])
        db.add(ProjectSceneLink(project_id=PROJECT_ID, scene_id=asset_id))
        ids[scene] = asset_id
    for index, name in enumerate(props, start=1):
        asset_id = f"prop-wb-{index}"
        created[name] = Prop(
            id=asset_id, name=name, description=descriptions.get(name, ""), style="真人古装"
        )
        db.add(created[name])
        db.add(ProjectPropLink(project_id=PROJECT_ID, prop_id=asset_id))
        ids[name] = asset_id
    for index, name in enumerate(costumes, start=1):
        asset_id = f"costume-wb-{index}"
        created[name] = Costume(
            id=asset_id, name=name, description=descriptions.get(name, ""), style="真人古装"
        )
        db.add(created[name])
        db.add(ProjectCostumeLink(project_id=PROJECT_ID, costume_id=asset_id))
        ids[name] = asset_id
    await db.flush()

    for name, slots in prompts.items():
        asset = created.get(name)
        if asset is not None:
            asset.image_prompts = dict(slots)
    await db.flush()
    return ids


async def _seed_candidates(
    db: Any, *, rows: list[tuple[str, str, str, str, str | None]]
) -> None:
    """写候选行：``(镜头 id, 类型, 名称, 状态, 关联资产 id)``。

    同一镜头下同名候选只有一行（表上有唯一约束），所以重复出现的名称要跨镜头写
    —— 真实项目里也是这样（同一个角色在多集多个镜头里被提取出来）。
    """
    from app.models.studio import ShotExtractedCandidate

    for shot_id, candidate_type, name, candidate_status, linked in rows:
        db.add(
            ShotExtractedCandidate(
                shot_id=shot_id,
                candidate_type=candidate_type,
                candidate_name=name,
                candidate_status=candidate_status,
                linked_entity_id=linked,
                payload={},
            )
        )
    await db.flush()


async def _seed_record(
    db: Any,
    *,
    asset_type: str,
    name: str,
    asset_id: str | None,
    fields: dict[str, str],
    aliases: tuple[str, ...] = (),
    status_value: str = "confirmed",
) -> None:
    """写一行本章资产资料（``chapter_asset_profiles``，等同"分析 + 确认"之后的状态）。"""
    from app.models.studio import ChapterAssetProfile
    from app.services.studio.llm_orchestration.json_utils import normalize_name

    db.add(
        ChapterAssetProfile(
            project_id=PROJECT_ID,
            chapter_id=CHAPTER_ID,
            asset_type=asset_type,
            name=name,
            name_key=normalize_name(name),
            aliases=list(aliases),
            profile=dict(fields),
            asset_id=asset_id,
            status=status_value,
        )
    )
    await db.flush()


async def _seed_chapter(db: Any) -> None:
    """项目 + 章节 + 两个镜头（含让资产名出现在剧本摘录里）。"""
    from app.models.studio import Shot

    await seed_project_chapter_shot(
        db,
        project_id=PROJECT_ID,
        chapter_id=CHAPTER_ID,
        shot_id=SHOT_1,
        script_excerpt="△下人举起铁锤，准备把钉子敲进棺材。△苏晚棠死死盯着棺材。",
        chapter_text=CHAPTER_TEXT,
    )
    db.add(
        Shot(
            id=SHOT_2,
            chapter_id=CHAPTER_ID,
            index=2,
            title="夺锤撬棺",
            script_excerpt="△苏晚棠夺过铁锤撬开棺材，叶老夫人攥着佛珠站在一旁。",
        )
    )
    await db.flush()


def is_chinese(text: str) -> bool:
    """这段原因里至少有中文（用户看得懂的原因必须是中文）。"""
    return any("\u4e00" <= char <= "\u9fff" for char in str(text or ""))


def _run(scenario: Any) -> dict[str, Any]:
    """跑一个 ``async def (db) -> None`` 场景，然后取一次工作台响应。"""

    async def _main() -> dict[str, Any]:
        db, engine = await build_session()
        try:
            await _seed_chapter(db)
            await scenario(db)
            payload = await build_chapter_asset_workbench(db, chapter_id=CHAPTER_ID)
            await db.commit()
            return payload
        finally:
            await engine.dispose()

    return asyncio.run(_main())


def _assert_summary_matches_items(payload: dict[str, Any]) -> None:
    """顶部统计必须与列表**同源一致**：逐条断言等式，防止出现两套算法。"""
    items = payload["items"]
    summary = payload["summary"]
    assert summary["total"] == len(items)
    for asset_type in ("character", "scene", "prop", "costume"):
        assert summary["by_type"][asset_type] == len(
            [item for item in items if item["asset_type"] == asset_type]
        ), f"{asset_type} 的类型计数与列表不一致"
    for summary_key, status_key in (
        ("needs_profile", "needs_profile"),
        ("needs_prompt", "needs_prompt"),
        ("prompt_ready", "ready"),
        ("generating", "generating"),
        ("failed", "failed"),
    ):
        assert summary[summary_key] == len(
            [item for item in items if item["status"]["key"] == status_key]
        ), f"{summary_key} 与列表状态不一致"
    assert summary["has_image"] == len([item for item in items if item["image"]["has_image"]])
    assert summary["primary"] == len([item for item in items if item["image"]["has_primary"]])
    assert summary["prompt_needs_regeneration"] == len(
        [item for item in items if item["prompt"]["quality"]["needs_regeneration"]]
    )
    assert summary["pending_review"] == len(payload["pending_review"])
    # 状态是**互斥划分**：每个资产恰好落在一个状态里
    partition = (
        "needs_profile",
        "needs_prompt",
        "ready",
        "generating",
        "failed",
        "has_image",
        "primary",
    )
    assert summary["total"] == sum(
        len([item for item in items if item["status"]["key"] == key]) for key in partition
    )


def _real_project_rows(linked: dict[str, str]) -> list[tuple[str, str, str, str, str | None]]:
    """真实项目形态的候选行：18 条已关联 + 15 条待处理（与线上一次实测一致）。"""
    rows: list[tuple[str, str, str, str, str | None]] = []
    for name in REAL_CHARACTERS:
        rows.append((SHOT_1, "character", name, "linked", linked[name]))
    for name in ("乌鸦", "众人", "苏晚棠"):
        rows.append((SHOT_2, "character", name, "linked", linked[name]))
    for name in ("下人", "叶老夫人", "昭昭", "邓嬷嬷"):
        rows.append((SHOT_1, "character", name, "pending", None))
    for name in ("下人", "昭昭"):
        rows.append((SHOT_2, "character", name, "pending", None))
    for shot_id in (SHOT_1, SHOT_2):
        rows.append((shot_id, "scene", REAL_SCENE, "linked", linked[REAL_SCENE]))
        for name in REAL_PROPS:
            rows.append((shot_id, "prop", name, "linked", linked[name]))
    for name in ("佛珠", "封条", "铁棍"):
        rows.append((SHOT_1, "prop", name, "pending", None))
    rows.append((SHOT_1, "costume", "叶老夫人常服", "pending", None))
    rows.append((SHOT_1, "costume", "邓嬷嬷嬷嬷服", "pending", None))
    for name in ("苏晚棠素服", "昭昭丧服"):
        for shot_id in (SHOT_1, SHOT_2):
            rows.append((shot_id, "costume", name, "pending", None))
    return rows


# ---------------------------------------------------------------------------
# 1) 真实项目形态：没有分析资料 → 一律"待补资料"，绝不显示"可以生成图片"
# ---------------------------------------------------------------------------


def test_real_project_shape_needs_profile_and_no_fake_ready() -> None:
    """11 个资产、描述全空、无提示词、无资料行 → 全部 needs_profile / 不可出图。"""

    async def scenario(db: Any) -> None:
        linked = await _seed_assets(
            db, characters=REAL_CHARACTERS, scene=REAL_SCENE, props=REAL_PROPS
        )
        await _seed_candidates(db, rows=_real_project_rows(linked))

    payload = _run(scenario)

    assert payload["analysis"]["generated"] is False
    assert payload["analysis"]["status"] == "not_generated"
    assert payload["analysis"]["records_total"] == 0
    assert "分析本章资产" in payload["analysis"]["hint"]

    assert payload["summary"]["total"] == 11
    # 商品（product）在 MVP 里不进工作台平权，但 ASSET_TYPES 已含它，
    # 因此 by_type 会多一个恒为 0 的键（前端页签是写死的四类，不按这个键渲染）。
    assert payload["summary"]["by_type"] == {
        "character": 7,
        "scene": 1,
        "prop": 3,
        "costume": 0,
        "product": 0,
    }
    assert payload["summary"]["needs_profile"] == 11
    assert payload["summary"]["prompt_ready"] == 0

    for item in payload["items"]:
        assert item["status"]["key"] == STATUS_NEEDS_PROFILE, item["name"]
        assert item["batch_eligible"] is False
        assert item["prompt"]["text"] == ""
        assert item["prompt"]["saved"] is False
        assert item["profile_source"] == "none"

    # 服装只有候选、没有资产 → 不进资产列表，但在 pending_review 里说清"先建服装资产"
    costume_reviews = [
        entry
        for entry in payload["pending_review"]
        if entry["kind"] == REVIEW_COSTUME_WITHOUT_ASSET
    ]
    assert len(costume_reviews) == 4
    assert {entry["name"] for entry in costume_reviews} == {
        "叶老夫人常服",
        "苏晚棠素服",
        "昭昭丧服",
        "邓嬷嬷嬷嬷服",
    }
    # 无冲突的候选（人物/道具的待处理项）**不许**进 pending_review
    assert {entry["kind"] for entry in payload["pending_review"]} == {REVIEW_COSTUME_WITHOUT_ASSET}
    assert payload["technical"]["candidates_total"] == 33
    character_counts = payload["technical"]["candidates_by_type_status"]["character"]
    assert character_counts == {"linked": 10, "pending": 6}
    assert payload["technical"]["candidate_groups"] == 22
    _assert_summary_matches_items(payload)


# ---------------------------------------------------------------------------
# 2) 有资料 + 已确认 + 有可用提示词 → ready / 可出图
# ---------------------------------------------------------------------------


def test_record_with_good_prompt_is_ready_and_batch_eligible() -> None:
    async def scenario(db: Any) -> None:
        linked = await _seed_assets(
            db,
            characters=("苏晚棠", "叶老夫人"),
            prompts={"苏晚棠": {"character_image_front": GOOD_PROMPT}},
        )
        await _seed_candidates(
            db,
            rows=[
                (SHOT_1, "character", "苏晚棠", "linked", linked["苏晚棠"]),
                (SHOT_2, "character", "叶老夫人", "linked", linked["叶老夫人"]),
            ],
        )
        await _seed_record(
            db,
            asset_type="character",
            name="苏晚棠",
            asset_id=linked["苏晚棠"],
            fields={"identity": "侯府嫡长女", "appearance": "鹅蛋脸杏眼", "hairstyle": "双环髻"},
        )

    payload = _run(scenario)
    item = next(entry for entry in payload["items"] if entry["name"] == "苏晚棠")

    assert payload["analysis"]["generated"] is True
    assert item["status"]["key"] == STATUS_READY
    assert item["status"]["label"] == "可以生成图片"
    assert item["prompt"]["quality"]["verdict"] == "ok"
    assert item["prompt"]["quality"]["needs_regeneration"] is False
    assert item["batch_eligible"] is True
    assert item["profile_source"] == "chapter_record"
    assert "身份：侯府嫡长女" in item["profile_digest"]
    assert item["prompt"]["slot"] == "character_image_front"
    # 需求清单第 2 条：人物资产由「单张全身图」改为「角色设定图（左面部大特写 + 右全身三视图）」，
    # 槽位中文名随之从「角色正面图片」改为「角色设定图（正面）」
    assert item["prompt"]["slot_label"] == "角色设定图（正面）"
    assert item["script_relation"]["shot_refs"], "有出场镜头时必须给出剧本依据"
    # 另一个角色没有资料也没有提示词 → 不许跟着说"可以生成图片"
    other = next(entry for entry in payload["items"] if entry["name"] == "叶老夫人")
    assert other["status"]["key"] != STATUS_READY
    assert other["batch_eligible"] is False
    _assert_summary_matches_items(payload)


# ---------------------------------------------------------------------------
# 3) 旧空话提示词：重新判定 → 需要重新生成 + 排除出批量（不改动已保存内容）
# ---------------------------------------------------------------------------


def test_old_vague_filler_prompt_is_marked_for_regeneration() -> None:
    async def scenario(db: Any) -> None:
        linked = await _seed_assets(
            db,
            characters=("叶老夫人",),
            prompts={"叶老夫人": {"character_image_front": OLD_FILLER_PROMPT}},
        )
        await _seed_candidates(
            db, rows=[(SHOT_1, "character", "叶老夫人", "linked", linked["叶老夫人"])]
        )
        await _seed_record(
            db,
            asset_type="character",
            name="叶老夫人",
            asset_id=linked["叶老夫人"],
            fields={"identity": "侯府老夫人", "appearance": "清瘦面容", "hairstyle": "银灰高髻"},
        )

    payload = _run(scenario)
    item = payload["items"][0]

    assert item["prompt"]["quality"]["verdict"] == "needs_regeneration"
    assert item["prompt"]["quality"]["needs_regeneration"] is True
    assert item["batch_eligible"] is False
    assert item["status"]["key"] == "needs_prompt"
    assert "重新生成" in item["status"]["label"]
    reasons = item["prompt"]["quality"]["reasons"]
    assert reasons
    assert all(is_chinese(reason) for reason in reasons)
    assert any("空话" in reason for reason in reasons)
    # 旧文本仍然如实展示（只标记，不删改）
    assert item["prompt"]["text"] == OLD_FILLER_PROMPT
    assert payload["summary"]["prompt_needs_regeneration"] == 1
    _assert_summary_matches_items(payload)


def test_two_characters_with_duplicate_prompts_both_need_regeneration() -> None:
    """两个**不同**人物拿到同一段提示词 → 双方都要重新生成。"""
    duplicate = "侯府女眷，正面全身参考图，干净背景，高清写实，电影感，柔和主光"
    fields = {"identity": "侯府女眷", "appearance": "面容清瘦", "hairstyle": "高髻"}

    async def scenario(db: Any) -> None:
        linked = await _seed_assets(
            db,
            characters=("苏晚棠", "叶老夫人"),
            prompts={
                "苏晚棠": {"character_image_front": duplicate},
                "叶老夫人": {"character_image_front": duplicate},
            },
        )
        await _seed_candidates(
            db,
            rows=[
                (SHOT_1, "character", "苏晚棠", "linked", linked["苏晚棠"]),
                (SHOT_2, "character", "叶老夫人", "linked", linked["叶老夫人"]),
            ],
        )
        for name in ("苏晚棠", "叶老夫人"):
            await _seed_record(
                db, asset_type="character", name=name, asset_id=linked[name], fields=fields
            )

    payload = _run(scenario)
    assert len(payload["items"]) == 2
    for item in payload["items"]:
        assert item["prompt"]["quality"]["needs_regeneration"] is True, item["name"]
        assert item["batch_eligible"] is False
        assert any(
            "重复" in reason or "逐字相同" in reason
            for reason in item["prompt"]["quality"]["reasons"]
        ), item["prompt"]["quality"]["reasons"]
    assert payload["summary"]["prompt_needs_regeneration"] == 2
    assert payload["summary"]["prompt_ready"] == 0
    _assert_summary_matches_items(payload)


def test_old_prompt_is_judged_even_before_the_chapter_is_analyzed() -> None:
    """本章还没分析、但库里存着旧空话提示词：**不许展示成可出图**，但要标"需要重新生成"。"""

    async def scenario(db: Any) -> None:
        linked = await _seed_assets(
            db,
            characters=("苏晚棠",),
            prompts={"苏晚棠": {"character_image_front": OLD_FILLER_PROMPT}},
        )
        await _seed_candidates(
            db, rows=[(SHOT_1, "character", "苏晚棠", "linked", linked["苏晚棠"])]
        )

    payload = _run(scenario)
    item = payload["items"][0]

    assert payload["analysis"]["generated"] is False
    # 页面不许出现"可以生成图片"的假象
    assert item["status"]["key"] == STATUS_NEEDS_PROFILE
    assert item["prompt"]["text"] == ""
    assert item["prompt"]["saved"] is False
    assert item["batch_eligible"] is False
    # 但旧提示词照样被判过：命中空话 → 需要重新生成（前端据此给"一键重新生成"入口）
    assert item["prompt"]["quality"]["verdict"] == "needs_regeneration"
    assert item["prompt"]["quality"]["needs_regeneration"] is True
    assert item["prompt"]["saved_slots"] == ["character_image_front"]
    assert any("空话" in reason for reason in item["prompt"]["quality"]["reasons"])
    assert payload["summary"]["prompt_needs_regeneration"] == 1
    assert payload["technical"]["hidden_library_prompts"] == 1
    _assert_summary_matches_items(payload)


# ---------------------------------------------------------------------------
# 3.5) 图片 / 出图任务 → has_image / primary / generating / failed
# ---------------------------------------------------------------------------


def test_image_and_task_states_drive_the_workbench_status() -> None:
    """有图未定版 → has_image；已定版 → primary；在途 → generating；上次失败 → failed。"""

    async def scenario(db: Any) -> None:
        from app.models.studio import CharacterImage, FileItem
        from app.models.task import GenerationTask
        from app.models.task_links import GenerationTaskLink

        linked = await _seed_assets(
            db,
            characters=("甲在途", "乙失败", "丙有图", "丁定版"),
            prompts={
                "丙有图": {"character_image_front": GOOD_PROMPT},
                "丁定版": {"character_image_front": GOOD_PROMPT_OTHER},
            },
        )
        fields = {"identity": "侯府女眷", "appearance": "面容清瘦", "hairstyle": "高髻"}
        for name in ("甲在途", "乙失败", "丙有图", "丁定版"):
            await _seed_record(
                db, asset_type="character", name=name, asset_id=linked[name], fields=fields
            )
        await _seed_candidates(
            db,
            rows=[
                (SHOT_1, "character", name, "linked", linked[name])
                for name in ("甲在途", "乙失败", "丙有图", "丁定版")
            ],
        )
        db.add(FileItem(id="file-wb-1", type="image", name="图", storage_key="wb/1.png"))
        db.add(FileItem(id="file-wb-2", type="image", name="图", storage_key="wb/2.png"))
        await db.flush()
        # 丙：有图但未定版；丁：已定版
        db.add(
            CharacterImage(
                character_id=linked["丙有图"],
                file_id="file-wb-1",
                is_primary=False,
                view_angle="FRONT",
                quality_level="HIGH",
            )
        )
        db.add(
            CharacterImage(
                character_id=linked["丁定版"],
                file_id="file-wb-2",
                is_primary=True,
                view_angle="FRONT",
                quality_level="HIGH",
            )
        )
        # 甲：在途任务；乙：最近一次失败
        db.add(
            GenerationTask(id="task-wb-run", mode="async_polling", task_kind="image_generation",
                           status="running", payload={})
        )
        db.add(
            GenerationTask(id="task-wb-failed", mode="async_polling", task_kind="image_generation",
                           status="failed", payload={})
        )
        await db.flush()
        db.add(
            GenerationTaskLink(
                task_id="task-wb-run",
                resource_type="image",
                relation_type="character_image",
                relation_entity_id=linked["甲在途"],
            )
        )
        db.add(
            GenerationTaskLink(
                task_id="task-wb-failed",
                resource_type="image",
                relation_type="character_image",
                relation_entity_id=linked["乙失败"],
            )
        )
        await db.flush()

    payload = _run(scenario)
    by_name = {item["name"]: item for item in payload["items"]}

    assert by_name["甲在途"]["status"]["key"] == "generating"
    assert by_name["乙失败"]["status"]["key"] == "failed"
    assert by_name["丙有图"]["status"]["key"] == "has_image"
    assert by_name["丁定版"]["status"]["key"] == "primary"
    assert by_name["丙有图"]["image"] == {
        "has_image": True,
        "has_primary": False,
        "image_id": by_name["丙有图"]["image"]["image_id"],
        "thumbnail": by_name["丙有图"]["image"]["thumbnail"],
        "image_count": 1,
    }
    assert by_name["丙有图"]["image"]["image_id"] is not None
    assert by_name["丁定版"]["image"]["has_primary"] is True
    # 有图和定版都算"已经有产出"，也能再次出图（提示词可用）
    assert payload["summary"]["has_image"] == 2
    assert payload["summary"]["primary"] == 1
    assert payload["summary"]["generating"] == 1
    assert payload["summary"]["failed"] == 1
    assert by_name["丙有图"]["batch_eligible"] is True
    assert by_name["甲在途"]["batch_eligible"] is False
    _assert_summary_matches_items(payload)


# ---------------------------------------------------------------------------
# 4) pending_review：只收真正需要人工的
# ---------------------------------------------------------------------------


def test_pending_review_only_contains_real_problems() -> None:
    """无冲突候选不进；别名指向两个不同资产 → 进（kind=alias_conflict）。"""

    async def scenario(db: Any) -> None:
        # 库里两个**不同**资产：本章资料行把它们当成同一个资产的两个写法
        linked = await _seed_assets(db, characters=("苏晚棠", "老夫人李氏"))
        await _seed_candidates(
            db,
            rows=[
                # 无冲突：库里没有同名资产，也没有别名分叉
                (SHOT_1, "character", "昭昭", "pending", None),
                (SHOT_1, "prop", "佛珠", "pending", None),
                (SHOT_1, "character", "苏晚棠", "linked", linked["苏晚棠"]),
            ],
        )
        await _seed_record(
            db,
            asset_type="character",
            name="苏晚棠",
            asset_id=linked["苏晚棠"],
            aliases=("老夫人李氏",),
            fields={"identity": "侯府嫡长女", "appearance": "鹅蛋脸杏眼", "hairstyle": "双环髻"},
        )

    payload = _run(scenario)
    kinds = {entry["kind"] for entry in payload["pending_review"]}
    names = {entry["name"] for entry in payload["pending_review"]}

    assert kinds == {REVIEW_ALIAS_CONFLICT}
    alias_entry = payload["pending_review"][0]
    assert alias_entry["name"] == "苏晚棠"
    assert alias_entry["conflict_code"]
    assert "两个不同资产" in alias_entry["reason"]
    assert len(alias_entry["existing_asset_ids"] or []) == 2, "必须点名冲突的是哪两个资产"
    # 无冲突的候选不许要求用户逐条确认
    assert "昭昭" not in names
    assert "佛珠" not in names
    _assert_summary_matches_items(payload)


# ---------------------------------------------------------------------------
# 5) 路由形状 + 只读
# ---------------------------------------------------------------------------


def test_workbench_route_shape_and_read_only(client: Any, session_database: Any) -> None:
    """走真实路由：响应形状正确，且**调用前后库里业务表行数不变**（含 stale 情形）。"""
    from tests._prod_db_snapshot import read_row_counts

    db_path = session_database.db_path
    assert db_path is not None, "会话隔离层必须给出临时库路径"
    url = f"/api/v1/studio/chapters/{CHAPTER_ID}/asset-workbench"

    async def _seed_sqlite() -> None:
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

        from app.models.studio import Chapter, ChapterAssetProfileRun, Project, Shot

        engine = create_async_engine(str(session_database.url), future=True)
        maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with maker() as db:
            db.add(
                Project(
                    id=PROJECT_ID,
                    name="工作台只读用例",
                    description="",
                    style="真人古装",
                    visual_style="现实",
                )
            )
            await db.flush()
            db.add(
                Chapter(
                    id=CHAPTER_ID,
                    project_id=PROJECT_ID,
                    index=1,
                    title="试稿",
                    raw_text=CHAPTER_TEXT,
                    condensed_text=CHAPTER_TEXT,
                )
            )
            db.add(
                Shot(id=SHOT_1, chapter_id=CHAPTER_ID, index=1, title="钉棺", script_excerpt="△苏晚棠。")
            )
            await db.flush()
            # 一条**内容签名与当前剧本不一致**的生成记录：工作台只回报 stale，不许改写它
            db.add(
                ChapterAssetProfileRun(
                    project_id=PROJECT_ID,
                    chapter_id=CHAPTER_ID,
                    cache_key="cache-key-of-an-older-script-version",
                    source_hash="older-source-hash",
                    source_summary={},
                    status="generated",
                    item_total=0,
                    llm_called=False,
                    dry_run=True,
                    extra_instructions="",
                    meta={},
                    technical={},
                    warnings=[],
                )
            )
            await db.commit()
        await engine.dispose()

    asyncio.run(_seed_sqlite())

    before, error = read_row_counts(db_path)
    assert not error, f"取不到行数快照：{error}"
    response = client.get(url)
    after, error = read_row_counts(db_path)
    assert not error, f"取不到行数快照：{error}"

    assert response.status_code == 200, response.text
    body = response.json()
    data = body["data"]
    assert data["chapter_title"] == "试稿"
    assert data["script_chars"] == len(CHAPTER_TEXT)
    for key in (
        "chapter_id",
        "project_id",
        "chapter_title",
        "script_chars",
        "analysis",
        "summary",
        "items",
        "pending_review",
        "technical",
    ):
        assert key in data, f"响应缺少字段 {key}"
    for key in (
        "generated",
        "status",
        "status_label",
        "content_changed",
        "records_total",
        "generated_at",
        "hint",
    ):
        assert key in data["analysis"], f"analysis 缺少字段 {key}"
    assert data["analysis"]["status"] == "stale", "内容签名不一致时必须如实标成 stale"
    assert data["analysis"]["content_changed"] is True
    assert data["analysis"]["generated"] is True
    assert "重新分析" in data["analysis"]["hint"]
    assert before == after, "只读接口不许改动任何表（包括不许把 run 标成 stale）"


# ---------------------------------------------------------------------------
# 6) 旧提示词排除出批量出图（与工作台**同一份判定**）
# ---------------------------------------------------------------------------


def test_batch_build_targets_excludes_old_filler_prompt() -> None:
    """批量出图的计划阶段必须排除"旧空话提示词"，并如实回报原因。"""
    from app.services.studio.image_pipeline.image_pipeline import build_targets

    async def _main() -> tuple[list[Any], list[str], list[Any], list[str]]:
        from app.models.studio import Character, Project

        db, engine = await build_session()
        try:
            db.add(Project(id="proj-batch", name="批量排除用例", description="", style="真人古装"))
            await db.flush()
            db.add(
                Character(
                    id="char-bad",
                    project_id="proj-batch",
                    name="叶老夫人",
                    description="清瘦面容",
                    style="真人古装",
                )
            )
            db.add(
                Character(
                    id="char-good",
                    project_id="proj-batch",
                    name="苏晚棠",
                    description="鹅蛋脸杏眼",
                    style="真人古装",
                )
            )
            await db.flush()
            bad = await db.get(Character, "char-bad")
            bad.image_prompts = {"character_image_front": OLD_FILLER_PROMPT}
            good = await db.get(Character, "char-good")
            good.image_prompts = {"character_image_front": GOOD_PROMPT}
            await db.flush()

            bad_targets, bad_warnings = await build_targets(
                db,
                project_id="proj-batch",
                asset_type="character",
                stage="character_sheet",
                asset_ids=["char-bad"],
            )
            good_targets, good_warnings = await build_targets(
                db,
                project_id="proj-batch",
                asset_type="character",
                stage="character_sheet",
                asset_ids=["char-good"],
            )
            return bad_targets, bad_warnings, good_targets, good_warnings
        finally:
            await engine.dispose()

    bad_targets, bad_warnings, good_targets, good_warnings = asyncio.run(_main())

    assert bad_targets == [], "旧空话提示词必须被排除出批量"
    assert any("排除 1 项" in warning for warning in bad_warnings), bad_warnings
    assert any("叶老夫人" in warning and "空话" in warning for warning in bad_warnings), bad_warnings
    assert len(good_targets) == 1, "可用提示词不许被误伤"
    assert good_targets[0].prompt == GOOD_PROMPT
    assert not any("排除" in warning for warning in good_warnings)
