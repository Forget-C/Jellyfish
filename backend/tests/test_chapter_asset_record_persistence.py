"""持久化验收：**生成一次 → 重启后端 → 无模型调用直接恢复 → 重新提取不丢人工修改**。

用户口径（2026-09 明示，正式使用不可接受的三件事）
=================================================

1. 资产清单只活在进程内缓存里 → 后端一重启就要**再花一次钱**；
2. 章节资料依附在候选行 payload 上 → 重新提取（``replace_for_shot`` 先删后建）把它清空；
3. 已经付费生成、人工确认过的结构资料会因此丢失。

所以本文件用**文件型 SQLite**（不是内存库）来真的模拟"重启"：放弃旧 engine 与旧会话，
清空进程内缓存，再用新 engine 打开同一个库文件，并且注入一个**一调用就报错**的模型桩 ——
如果它被调用了，用例就失败。这样"没有重新调用模型"这件事是被证伪式地验证的，
而不是靠读日志。

覆盖：

- 重启后 ``build_chapter_asset_profiles`` 直接读库，返回值与生成时逐字段同形；
- 重启后 ``confirm`` 依然可用（改造前这里必然 409 ``asset_profile_not_generated``）；
- 用完的钱不会白花：候选行被重新提取**全部替换**后，资料行与人工修改仍在；
- 剧本变化 → 标 ``pending_change`` + 中文提示，**不覆盖**已确认 / 人工改过的行；
- 覆盖 / 合并 / 保留 三种用户决定的行为；
- 只读入口（GET 语义）在什么都没有时**一次模型调用都不发**。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.services.studio.chapter_asset_profile_cache import clear_chapter_profile_cache
from app.services.studio.chapter_asset_profile_confirm import confirm_chapter_asset_profiles
from app.services.studio.chapter_asset_profiles import build_chapter_asset_profiles
from app.services.studio.chapter_asset_record_store import (
    RESOLVE_KEEP,
    RESOLVE_MERGE,
    RESOLVE_OVERWRITE,
    apply_manual_edit,
    get_chapter_record,
    list_chapter_records,
    resolve_pending_changes,
)

PROJECT_ID = "proj-persist"
CHAPTER_ID = "chap-persist"

CHAPTER_TEXT_V1 = (
    "将军府正堂内，秦老夫人拄着乌木拐杖逼问姜岁欢嫁妆下落。"
    "姜岁欢握紧镶银匕首，沉默不语，素白襦裙沾了泥。"
)
SHOT_1 = "秦老夫人拄着乌木拐杖立在正堂，姜岁欢跪在青砖地上。"
SHOT_2 = "姜岁欢把镶银匕首藏进袖中，素白襦裙下摆沾着泥。"

CHAPTER_TEXT_V2 = (
    "将军府正堂内，秦老夫人拄着龙头金杖逼问姜岁欢嫁妆下落。"
    "姜岁欢握紧镶银匕首，沉默不语，素白襦裙沾了雨。"
)


def _model_payload(*, variant: str = "v1") -> str:
    """桩模型返回的结构化清单（2 角色 + 1 场景 + 1 道具）。

    ``variant``：``v1`` 基线；``rename`` 道具改名（剧本里换成龙头金杖）；
    ``v2`` 名字不变、字段变化（验证"内容已变化 → 用户决定覆盖/合并/保留"）。
    """
    cane = "龙头金杖" if variant == "rename" else "乌木拐杖"
    girl_hair = "垂挂双环髻，插一支素银簪" if variant == "v2" else "双环髻，垂两缕碎发"
    cane_material = "青铜裹金" if variant == "v2" else "深色硬木"
    cane_color = "暗金" if variant == "v2" else "乌黑"
    return json.dumps(
        {
            "assets": [
                {
                    "name": "秦老夫人",
                    "aliases": ["老夫人"],
                    "asset_type": "character",
                    "fields": {
                        "appearance": "清瘦面容，鬓发一丝不苟",
                        "hairstyle": "银灰高髻，插一支白玉簪",
                        "costume_accessories": "凤纹织金褙子，配翡翠手串",
                        "personality": "威压逼人，语气冷硬",
                    },
                    "evidence": ["秦老夫人拄着乌木拐杖立在正堂"],
                    "shot_indexes": [1],
                },
                {
                    "name": "姜岁欢",
                    "aliases": ["岁欢"],
                    "asset_type": "character",
                    "fields": {
                        "appearance": "鹅蛋脸杏眼，唇色偏淡",
                        "hairstyle": girl_hair,
                        "costume_accessories": "素白襦裙，腰间垂羊脂玉佩",
                        "personality": "隐忍克制，指节发白",
                    },
                    "evidence": ["姜岁欢跪在青砖地上"],
                    "shot_indexes": [1, 2],
                },
                {
                    "name": "正堂",
                    "aliases": ["将军府·正堂"],
                    "asset_type": "scene",
                    "fields": {
                        "spatial_structure": "三开间厅堂，正中摆乌木太师椅",
                        "era_location": "古代将军府",
                        "indoor_outdoor": "内景",
                        "furnishings": "青铜烛台、青砖地面、暗红帷幔",
                        "light_tone": "烛火暖黄，明暗对比强",
                        "time_weather": "夜，风穿堂",
                    },
                    "evidence": ["将军府正堂内"],
                    "shot_indexes": [1],
                },
                {
                    "name": cane,
                    "aliases": [],
                    "asset_type": "prop",
                    "fields": {
                        "material": cane_material,
                        "color": cane_color,
                        "shape": "杖首雕兽，杖身笔直",
                        "state": "常年摩挲，握处发亮",
                        "plot_role": "逼问嫁妆时的威压道具",
                        "owner": "秦老夫人",
                    },
                    "evidence": ["秦老夫人拄着乌木拐杖"],
                    "shot_indexes": [1],
                },
            ]
        },
        ensure_ascii=False,
    )


class _RecordingStub:
    """可注入的模型桩：记录提示词、返回固定 JSON（零出网、零付费）。"""

    def __init__(self, payload: str) -> None:
        self.payload = payload
        self.prompts: list[str] = []

    async def __call__(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.payload


async def _boom(_prompt: str) -> str:
    raise AssertionError("重启后**不允许**再调用模型：资料必须从数据库直接读回")


def _engine(db_path: Path):
    return create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)


async def _create_tables(engine: Any) -> None:
    from app.core.db import Base
    from app.models.studio import ChapterAssetProfile, ChapterAssetProfileRun  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def _open(db_path: Path) -> tuple[AsyncSession, Any, async_sessionmaker[AsyncSession]]:
    """打开（或新建）库文件；返回会话 / engine / sessionmaker。"""
    engine = _engine(db_path)
    await _create_tables(engine)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    return maker(), engine, maker


async def _seed(db: AsyncSession, *, chapter_text: str = CHAPTER_TEXT_V1) -> None:
    from app.models.studio import Chapter, Project, Shot
    from app.models.types import ShotCandidateType

    db.add(
        Project(id=PROJECT_ID, name="持久化验收项目", description="", style="真人古装", visual_style="现实")
    )
    await db.flush()
    db.add(
        Chapter(
            id=CHAPTER_ID,
            project_id=PROJECT_ID,
            index=1,
            title="第一集",
            raw_text=chapter_text,
            condensed_text=chapter_text,
        )
    )
    await db.flush()
    db.add(Shot(id="shot-p1", chapter_id=CHAPTER_ID, index=1, title="正堂逼问", script_excerpt=SHOT_1))
    db.add(Shot(id="shot-p2", chapter_id=CHAPTER_ID, index=2, title="藏刃", script_excerpt=SHOT_2))
    await db.flush()
    from app.models.studio import ShotExtractedCandidate

    for shot_id, candidate_type, name in (
        ("shot-p1", ShotCandidateType.character, "秦老夫人"),
        ("shot-p1", ShotCandidateType.scene, "正堂"),
        ("shot-p1", ShotCandidateType.prop, "乌木拐杖"),
        ("shot-p2", ShotCandidateType.character, "姜岁欢"),
    ):
        db.add(
            ShotExtractedCandidate(
                shot_id=shot_id, candidate_type=candidate_type, candidate_name=name, payload={}
            )
        )
    await db.commit()


def _items(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {item["group_key"]: item for item in payload["user_flow"]["items"]}


def _fingerprint(item: dict[str, Any]) -> dict[str, Any]:
    """清单项的"资料指纹"：结构、别名、依据、出场镜头（用于比对生成时 vs 重启后）。"""
    return {
        "asset_type": item["asset_type"],
        "name": item["name"],
        "aliases": item["aliases"],
        "fields": item["fields"],
        "shot_refs": [
            {key: ref.get(key) for key in ("shot_id", "shot_index", "title")} for ref in item["shot_refs"]
        ],
        "evidence": [entry.get("snippet") for entry in item["evidence"]],
        "summary": item["summary"],
    }


def test_generate_then_restart_reads_database_without_any_model_call(tmp_path: Path) -> None:
    """**核心用例**：生成一次 → 模拟重启 → 无模型调用直接恢复，且清单逐字段同形。"""
    db_path = tmp_path / "persist.db"

    async def _phase_one() -> dict[str, Any]:
        db, engine, _maker = await _open(db_path)
        async with db:
            await _seed(db)
            clear_chapter_profile_cache()
            stub = _RecordingStub(_model_payload())
            generated = await build_chapter_asset_profiles(db, chapter_id=CHAPTER_ID, llm_caller=stub)
            await db.commit()
            assert len(stub.prompts) == 1, "第 1 次（也是唯一一次）生成应当只调用一次模型"
            assert generated["persistence"]["generated"] is True
            assert generated["persistence"]["llm_called"] is True
            assert generated["persistence"]["reconcile"]["created"], "生成结果必须落库"
            assert generated["meta"]["from_cache"] is False
        await engine.dispose()
        return generated

    generated = asyncio.run(_phase_one())

    async def _phase_two() -> tuple[dict[str, Any], int]:
        clear_chapter_profile_cache()  # 清掉进程内缓存 —— 它在重启后本来就没了
        db, engine, _maker = await _open(db_path)
        async with db:
            # llm_caller 换成"一调用就报错"的桩：库里有资料时必须走读库分支
            restored = await build_chapter_asset_profiles(db, chapter_id=CHAPTER_ID, llm_caller=_boom)
            await db.commit()
            records = await list_chapter_records(db, chapter_id=CHAPTER_ID)
        await engine.dispose()
        return restored, len(records)

    restored, record_total = asyncio.run(_phase_two())

    assert record_total == 4
    assert restored["persistence"]["source"] == "database"
    assert restored["persistence"]["llm_called"] is False, "重启后的恢复**不得**再调用模型"
    assert restored["persistence"]["generated_by_llm"] is True, "但这份清单当初确实是真实调用产生的"
    assert restored["persistence"]["content_changed"] is False, "剧本没变，不该标成内容已变化"
    assert restored["persistence"]["status_label"].startswith("已生成")

    left = {key: _fingerprint(item) for key, item in _items(generated).items()}
    right = {key: _fingerprint(item) for key, item in _items(restored).items()}
    assert left == right, "重启后读回来的清单必须与生成时逐字段同形"
    assert restored["user_flow"]["summary"] == generated["user_flow"]["summary"]
    assert restored["technical_detail"]["alias_merge"] == generated["technical_detail"]["alias_merge"]


def test_confirm_after_restart_no_longer_requires_a_new_analysis(tmp_path: Path) -> None:
    """改造前的真实故障：重启后 ``confirm`` 必然 409、用户只能再花一次钱。"""
    db_path = tmp_path / "confirm.db"

    async def _phase_one() -> None:
        db, engine, _maker = await _open(db_path)
        async with db:
            await _seed(db)
            clear_chapter_profile_cache()
            stub = _RecordingStub(_model_payload())
            await build_chapter_asset_profiles(db, chapter_id=CHAPTER_ID, llm_caller=stub)
            await db.commit()
        await engine.dispose()

    asyncio.run(_phase_one())

    async def _phase_two() -> dict[str, Any]:
        clear_chapter_profile_cache()
        db, engine, _maker = await _open(db_path)
        async with db:
            confirmed = await confirm_chapter_asset_profiles(db, chapter_id=CHAPTER_ID)
            await db.commit()
            records = await list_chapter_records(db, chapter_id=CHAPTER_ID)
        await engine.dispose()
        return {"confirm": confirmed, "records": [str(record.status) for record in records]}

    result = asyncio.run(_phase_two())
    summary = result["confirm"]["summary"]
    assert summary["created"] + summary["linked"] == 4
    assert summary["chapter_records_bound"] == 4, "确认必须把真实资产 ID 写回资料行"
    assert all(status == "confirmed" for status in result["records"])


def test_candidate_reextract_keeps_records_and_manual_edits(tmp_path: Path) -> None:
    """重新提取候选（先删后建）之后，资料行与人工修改**一个字都不能少**。"""
    db_path = tmp_path / "reextract.db"

    async def _run() -> dict[str, Any]:
        db, engine, _maker = await _open(db_path)
        async with db:
            await _seed(db)
            clear_chapter_profile_cache()
            stub = _RecordingStub(_model_payload())
            await build_chapter_asset_profiles(db, chapter_id=CHAPTER_ID, llm_caller=stub)
            await db.commit()
            await confirm_chapter_asset_profiles(db, chapter_id=CHAPTER_ID)
            await db.commit()

            record = await get_chapter_record(db, chapter_id=CHAPTER_ID, asset_type="character", name="姜岁欢")
            assert record is not None
            await apply_manual_edit(
                db,
                record=record,
                fields={"hairstyle": "垂挂双环髻，插一支素银簪（人工改）"},
                notes=["这一版按导演要求改成素银簪"],
            )
            await db.commit()

            # 重新提取：该镜头的候选被**整体替换**（改造前这一步会连 overlay 一起清掉）
            from app.services.studio.shot_extracted_candidates import replace_for_shot

            await replace_for_shot(
                db,
                shot_id="shot-p1",
                candidates=[
                    {"candidate_type": "character", "candidate_name": "秦老夫人", "payload": {}},
                    {"candidate_type": "scene", "candidate_name": "正堂", "payload": {}},
                ],
            )
            await db.commit()

            records = await list_chapter_records(db, chapter_id=CHAPTER_ID)
            restored = await build_chapter_asset_profiles(db, chapter_id=CHAPTER_ID, llm_caller=_boom)
            await db.commit()
        await engine.dispose()
        girl = next(record for record in records if record.name == "姜岁欢")
        return {
            "total": len(records),
            "hairstyle": girl.manual_overrides.get("hairstyle"),
            "notes": list(girl.user_notes or []),
            "restored": restored,
        }

    result = asyncio.run(_run())
    assert result["total"] == 4, "重新提取候选不得删除任何资料行"
    assert "人工改" in str(result["hairstyle"])
    assert result["notes"] == ["这一版按导演要求改成素银簪"]

    girl_item = _items(result["restored"])["character:姜岁欢"]
    assert "人工改" in girl_item["fields"]["hairstyle"], "人工修改必须出现在生效画像里（图片提示词读的就是它）"
    assert girl_item["manual_edited"] is True


def test_reanalysis_marks_pending_change_and_never_overwrites_protected_rows(tmp_path: Path) -> None:
    """剧本变了 → 标"内容已变化，建议重新分析"；已确认 / 人工改过的行只记待决定。"""
    db_path = tmp_path / "pending.db"

    async def _run() -> dict[str, Any]:
        db, engine, _maker = await _open(db_path)
        async with db:
            await _seed(db)
            clear_chapter_profile_cache()
            await build_chapter_asset_profiles(db, chapter_id=CHAPTER_ID, llm_caller=_RecordingStub(_model_payload()))
            await db.commit()
            await confirm_chapter_asset_profiles(db, chapter_id=CHAPTER_ID)
            await db.commit()

            # 剧本变化：拐杖改成龙头金杖，同时看板的字段也换了
            from app.models.studio import Chapter, Shot
            from sqlalchemy import select

            chapter = await db.get(Chapter, CHAPTER_ID)
            chapter.raw_text = CHAPTER_TEXT_V2
            chapter.condensed_text = CHAPTER_TEXT_V2
            shot = (await db.execute(select(Shot).where(Shot.id == "shot-p1"))).scalars().first()
            shot.script_excerpt = "秦老夫人拄着龙头金杖立在正堂，姜岁欢跪在青砖地上。"
            await db.commit()

            # 只读入口：先把"内容已变化"如实报出来（不覆盖、不重跑）
            stale_view = await build_chapter_asset_profiles(db, chapter_id=CHAPTER_ID)
            await db.commit()

            # 重新分析（第 2 次模型调用）：结果与库里逐条对账
            stub2 = _RecordingStub(_model_payload(variant="rename"))
            regenerated = await build_chapter_asset_profiles(
                db, chapter_id=CHAPTER_ID, llm_caller=stub2, refresh=True
            )
            await db.commit()
            records = await list_chapter_records(db, chapter_id=CHAPTER_ID)
        await engine.dispose()
        return {"stale_view": stale_view, "regenerated": regenerated, "records": records}

    result = asyncio.run(_run())

    # ① 只读入口如实报"内容已变化，建议重新分析"
    stale = result["stale_view"]["persistence"]
    assert stale["content_changed"] is True
    assert "内容已变化，建议重新分析" in stale["content_changed_hint"]
    assert stale["llm_called"] is False, "只读入口不得调用模型"
    assert stale["generated_by_llm"] is True

    # ② 受保护行（已确认）**没有**被新结果覆盖，只挂着待决定
    regenerated = result["regenerated"]
    assert regenerated["persistence"]["reconcile"]["requires_decision"], "受保护行必须走待决定，而不是直接覆盖"
    girl = next(record for record in result["records"] if record.name == "姜岁欢")
    cane_rows = [record for record in result["records"] if record.asset_type == "prop"]
    assert girl.status == "pending_change"
    assert girl.pending_profile, "新结果必须完整保留在 pending_profile 里等用户决定"
    assert girl.asset_id, "已关联的真实资产 ID 不得被抹掉"
    # 老的"乌木拐杖"行没有被删除，它的真实资产关联还在；新名字作为**独立新行**落库
    old_cane = next(row for row in cane_rows if row.name == "乌木拐杖")
    new_cane = next(row for row in cane_rows if row.name == "龙头金杖")
    assert old_cane.asset_id, "受保护行的真实资产关联不得被抹掉"
    assert not new_cane.asset_id, "新出现的资产还没确认，如实留空"

    async def _decide() -> dict[str, Any]:
        db, engine, _maker = await _open(db_path)
        async with db:
            decisions = await resolve_pending_changes(
                db,
                chapter_id=CHAPTER_ID,
                decisions=[
                    {"group_key": "character:姜岁欢", "action": RESOLVE_MERGE},
                    {"group_key": "character:秦老夫人", "action": RESOLVE_KEEP},
                ],
            )
            await db.commit()
            records = await list_chapter_records(db, chapter_id=CHAPTER_ID)
        await engine.dispose()
        return {"decisions": decisions, "records": records}

    decided = asyncio.run(_decide())
    actions = {entry["group_key"]: entry for entry in decided["decisions"]["results"]}
    assert actions["character:姜岁欢"]["ok"] is True
    assert actions["character:姜岁欢"]["action"] == RESOLVE_MERGE
    assert actions["character:秦老夫人"]["action"] == RESOLVE_KEEP
    girl_after = next(record for record in decided["records"] if record.name == "姜岁欢")
    assert girl_after.status == "confirmed"
    assert not girl_after.pending_profile, "决定之后待决定必须清空"


def test_decisions_overwrite_keeps_manual_and_merge_only_fills_empty(tmp_path: Path) -> None:
    """覆盖 / 合并的语义：覆盖只换模型侧资料，人工修改保留；合并只补空字段。"""
    db_path = tmp_path / "decisions.db"

    async def _run() -> dict[str, Any]:
        db, engine, _maker = await _open(db_path)
        async with db:
            await _seed(db)
            clear_chapter_profile_cache()
            await build_chapter_asset_profiles(db, chapter_id=CHAPTER_ID, llm_caller=_RecordingStub(_model_payload()))
            await db.commit()
            await confirm_chapter_asset_profiles(db, chapter_id=CHAPTER_ID)
            await db.commit()

            girl = await get_chapter_record(db, chapter_id=CHAPTER_ID, asset_type="character", name="姜岁欢")
            await apply_manual_edit(db, record=girl, fields={"hairstyle": "人工指定的发型"}, notes=["人工补充"])
            await db.commit()

            # 第二次分析给出不同字段 → 受保护行挂 pending
            await build_chapter_asset_profiles(
                db,
                chapter_id=CHAPTER_ID,
                llm_caller=_RecordingStub(_model_payload(variant="v2")),
                refresh=True,
            )
            await db.commit()

            await resolve_pending_changes(
                db,
                chapter_id=CHAPTER_ID,
                decisions=[{"group_key": "prop:乌木拐杖", "action": RESOLVE_OVERWRITE}],
            )
            await db.commit()
            cane = await get_chapter_record(db, chapter_id=CHAPTER_ID, asset_type="prop", name="乌木拐杖")
            girl = await get_chapter_record(db, chapter_id=CHAPTER_ID, asset_type="character", name="姜岁欢")
        await engine.dispose()
        return {"cane": cane, "girl": girl}

    result = asyncio.run(_run())
    # 覆盖：模型侧资料按新结果落下来，人工修改照旧生效
    assert (result["girl"].manual_overrides or {}).get("hairstyle") == "人工指定的发型"
    assert list(result["girl"].user_notes or []) == ["人工补充"]
    # 本次只处置了道具那一行：被处置的行待决定清空，没处置的行仍然挂着（不擅自替用户决定）
    assert result["cane"].status == "confirmed"
    assert not result["cane"].pending_profile
    assert result["girl"].pending_profile
    assert result["girl"].status == "pending_change"


def test_readonly_entry_never_generates_when_database_is_empty(tmp_path: Path) -> None:
    """库里什么都没有时，只读入口（GET 语义）一次模型调用都不发，并给出中文引导。"""
    db_path = tmp_path / "empty.db"

    async def _run() -> dict[str, Any]:
        db, engine, _maker = await _open(db_path)
        async with db:
            await _seed(db)
            clear_chapter_profile_cache()
            payload = await build_chapter_asset_profiles(
                db, chapter_id=CHAPTER_ID, llm_caller=_boom, allow_generate=False
            )
        await engine.dispose()
        return payload

    payload = asyncio.run(_run())
    assert payload["persistence"]["generated"] is False
    assert payload["persistence"]["status"] == "not_generated"
    assert payload["user_flow"]["items"] == []
    assert "POST /api/v1/studio/chapters/" in payload["persistence"]["hint"]
    assert payload["meta"]["llm_called"] is False


@pytest.mark.parametrize("action", [RESOLVE_OVERWRITE, RESOLVE_MERGE, RESOLVE_KEEP])
def test_resolve_actions_are_all_idempotent_when_nothing_pending(tmp_path: Path, action: str) -> None:
    """没有待决定时给决定：如实回报"没有待决定"，不报错、不改数据。"""
    db_path = tmp_path / f"noop-{action}.db"

    async def _run() -> dict[str, Any]:
        db, engine, _maker = await _open(db_path)
        async with db:
            await _seed(db)
            clear_chapter_profile_cache()
            await build_chapter_asset_profiles(db, chapter_id=CHAPTER_ID, llm_caller=_RecordingStub(_model_payload()))
            await db.commit()
            before = await get_chapter_record(db, chapter_id=CHAPTER_ID, asset_type="prop", name="乌木拐杖")
            before_profile = dict(before.profile or {})
            outcome = await resolve_pending_changes(
                db,
                chapter_id=CHAPTER_ID,
                decisions=[{"group_key": "prop:乌木拐杖", "action": action}],
            )
            await db.commit()
            after = await get_chapter_record(db, chapter_id=CHAPTER_ID, asset_type="prop", name="乌木拐杖")
            after_profile = dict(after.profile or {})
        await engine.dispose()
        return {"outcome": outcome, "before": before_profile, "after": after_profile}

    result = asyncio.run(_run())
    assert result["outcome"]["results"][0]["ok"] is False
    assert "没有待决定" in result["outcome"]["results"][0]["reason"]
    assert result["before"] == result["after"]
