"""「广告剧情流程」四件套的链路测试：brief（免费）→ generate（草稿）→ confirm（正式产物）。

覆盖用户给的验收口径：

- **brief 保存永不触模型**（用一个"被调用就炸"的替身守住这条）；
- 演练模式下 generate 返回占位且**不写 plan**（走真实路由，不绕服务层）；
- 草稿只进 ``drama_plan_drafts``，确认之前**零正式行**；确认后一个事务落齐
  章节标题/主线 + 角色 + 场景 + 商品 + 分镜（真实时长/景别/动作）+ **对白行** + 关联行；
- 商品覆盖不足一半 → 409（不信模型自述，按关联行数判定）；
- 章节已有镜头 → 409（与 ``script_division`` 同一口径，避免新旧分镜混在一起）；
- 租约：同一章在租约内只能生成一次（重复点击不重复付费）。

零出网、零付费：模型调用一律用注入的替身；库是内存库。
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app
from app.models.studio import (
    Chapter,
    Character,
    DramaPlanDraft,
    Product,
    Project,
    ProjectProductLink,
    ProjectSceneLink,
    Scene,
    Shot,
    ShotCharacterLink,
    ShotDetail,
    ShotDialogLine,
)
from app.services.studio import drama_plan_drafts as drafts
from app.services.studio import drama_plan_service as service

PROJECT_ID = "proj-drama"
CHAPTER_ID = "chap-drama"
BASE = f"/api/v1/studio/chapters/{CHAPTER_ID}/drama-plan"

BRIEF_BODY = {
    "product_name": "紧致焕颜精华",
    "product_description": "白色磨砂瓶身，金色压泵",
    "selling_points": ["三秒吸收"],
    "target_audience": "通勤女性",
    "genre": "真人都市",
    "tone": "一本正经地荒诞",
    "shot_count": 3,
    "director_notes": "不要旁白",
}


def _plan_payload(*, product_present: tuple[bool, bool, bool] = (True, True, False)) -> dict[str, Any]:
    """一份合法草稿（3 镜，默认 2/3 出现商品 = 满足「至少一半」）。"""
    return {
        "title": "面试那天",
        "logline": "她带着一瓶精华去面试，面试官是前任",
        "selling_points": ["三秒吸收 → 她当众拍在桌上"],
        "characters": [
            {"name": "林小满", "profile": {"appearance": "鹅蛋脸"}, "shot_indexes": [1, 2, 3]},
            {"name": "周砚", "profile": {"identity": "面试官"}, "shot_indexes": [2]},
        ],
        "scenes": [{"name": "写字楼会议室", "profile": {"spatial_structure": "长桌"}, "shot_indexes": [1]}],
        "product": {
            "name": "紧致焕颜精华",
            "description": "白色磨砂瓶身，金色压泵",
            "profile": {"package": "方形瓶身"},
            "shot_indexes": [1, 2],
        },
        "shots": [
            {
                "index": 1,
                "title": "拍瓶",
                "characters": ["林小满"],
                "script_excerpt": "她把瓶子拍在桌上",
                "description": "会议室中景",
                "duration": 8,
                "camera_shot": "MS",
                "angle": "EYE_LEVEL",
                "movement": "STATIC",
                "action_beats": ["推门", "拍瓶"],
                "dialogue": [{"speaker": "林小满", "text": "我不用补妆。", "mode": "DIALOGUE"}],
                "product_present": product_present[0],
            },
            {
                "index": 2,
                "title": "抬头",
                "characters": ["林小满", "周砚"],
                "description": "过肩特写",
                "duration": 5,
                "camera_shot": "CU",
                "angle": "OVER_SHOULDER",
                "movement": "DOLLY_IN",
                "action_beats": ["抬头"],
                "dialogue": [{"speaker": "周砚", "text": "好久不见。", "mode": "DIALOGUE"}],
                "product_present": product_present[1],
            },
            {
                "index": 3,
                "title": "转身",
                "characters": ["林小满"],
                "description": "全景",
                "duration": 4,
                "camera_shot": "LS",
                "angle": "EYE_LEVEL",
                "movement": "PAN",
                "action_beats": ["转身"],
                "dialogue": [],
                "product_present": product_present[2],
            },
        ],
        "climax": "前任说这瓶是他买的",
        "warnings": [],
    }


def _fake_preview(plan: dict[str, Any] | None = None, warnings: list[str] | None = None):
    """替身：返回与真实 ``preview_drama_plan`` 同形状的结果（零出网）。"""

    async def _preview(_db: Any, *, chapter_id: str, brief: dict[str, Any], llm_caller: Any = None) -> dict[str, Any]:
        return {
            "plan": plan if plan is not None else _plan_payload(),
            "warnings": list(warnings or []),
            "meta": {"target": {"model_name": "deepseek-chat"}, "llm_called": True, "dry_run": False},
            "note": "替身结果（测试用，未调用模型）",
        }

    return _preview


# ---------------------------------------------------------------------------
# 脚手架
# ---------------------------------------------------------------------------


async def _build_harness_async() -> tuple[async_sessionmaker[AsyncSession], Any]:
    """内存库 + 建表（async 版：给 ``@pytest.mark.asyncio`` 的用例用）。"""
    from app.core.db import Base
    import app.models.studio  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return factory, engine


def _build_harness() -> tuple[async_sessionmaker[AsyncSession], Any]:
    """同步版（给 TestClient 用例用；不能在事件循环里调用）。"""
    return asyncio.run(_build_harness_async())


async def _seed_async(factory: async_sessionmaker[AsyncSession], *, with_shot: bool = False) -> None:
    async with factory() as session:
        session.add(Project(id=PROJECT_ID, name="广告项目", description="", style="真人都市", visual_style="现实"))
        await session.flush()
        session.add(
            Chapter(id=CHAPTER_ID, project_id=PROJECT_ID, index=1, title="第 1 集", raw_text="会议室里，她推门进来。")
        )
        if with_shot:
            session.add(Shot(id="shot-existing", chapter_id=CHAPTER_ID, index=1, title="已有镜头"))
        await session.commit()


def _seed_project_chapter(factory: async_sessionmaker[AsyncSession], *, with_shot: bool = False) -> None:
    asyncio.run(_seed_async(factory, with_shot=with_shot))


@pytest.fixture()
def routed_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, async_sessionmaker[AsyncSession]]]:
    factory, engine = _build_harness()
    _seed_project_chapter(factory)

    async def override_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_db
    try:
        yield TestClient(app), factory
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


async def _fetch_one(factory: async_sessionmaker[AsyncSession], model: Any, **filters: Any) -> Any:
    async with factory() as session:
        stmt = select(model)
        for key, value in filters.items():
            stmt = stmt.where(getattr(model, key) == value)
        return (await session.execute(stmt)).scalars().first()


async def _fetch_all(factory: async_sessionmaker[AsyncSession], model: Any, **filters: Any) -> list[Any]:
    async with factory() as session:
        stmt = select(model)
        for key, value in filters.items():
            stmt = stmt.where(getattr(model, key) == value)
        return list((await session.execute(stmt)).scalars().all())


# ---------------------------------------------------------------------------
# 1) brief 保存：免费，且永不触模型
# ---------------------------------------------------------------------------


def test_brief_save_is_free_and_never_calls_model(
    routed_client: tuple[TestClient, async_sessionmaker[AsyncSession]], monkeypatch: pytest.MonkeyPatch
) -> None:
    client, factory = routed_client

    async def forbidden(*_args: Any, **_kwargs: Any) -> Any:  # pragma: no cover - 被调用即失败
        raise AssertionError("保存 brief 绝不允许触发模型调用")

    monkeypatch.setattr(service.orchestration, "preview_drama_plan", forbidden)

    resp = client.put(f"{BASE}/brief", json=BRIEF_BODY)
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["has_draft"] is True
    assert data["status"] == "none"          # 行有了，但从未生成过
    assert data["plan"] is None
    assert data["brief"]["product_name"] == "紧致焕颜精华"

    row = asyncio.run(_fetch_one(factory, DramaPlanDraft, chapter_id=CHAPTER_ID))
    assert row is not None and row.status == ""
    assert row.plan == {}
    assert asyncio.run(_fetch_all(factory, Shot, chapter_id=CHAPTER_ID)) == []


# ---------------------------------------------------------------------------
# 2) generate：只落草稿，零正式行
# ---------------------------------------------------------------------------


def test_generate_stores_draft_only(
    routed_client: tuple[TestClient, async_sessionmaker[AsyncSession]], monkeypatch: pytest.MonkeyPatch
) -> None:
    client, factory = routed_client
    monkeypatch.setattr(service.orchestration, "preview_drama_plan", _fake_preview())

    assert client.put(f"{BASE}/brief", json=BRIEF_BODY).status_code == 200
    resp = client.post(f"{BASE}/generate")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["status"] == "ok"
    assert data["plan"]["title"] == "面试那天"
    assert data["model"] == "deepseek-chat"

    row = asyncio.run(_fetch_one(factory, DramaPlanDraft, chapter_id=CHAPTER_ID))
    assert row is not None and row.plan.get("title") == "面试那天"
    assert row.claim_token is None and row.claim_expires_at is None  # 租约已释放
    # 关键：确认之前一个正式行都不许有
    assert asyncio.run(_fetch_all(factory, Shot, chapter_id=CHAPTER_ID)) == []
    assert asyncio.run(_fetch_all(factory, Character, project_id=PROJECT_ID)) == []
    assert asyncio.run(_fetch_all(factory, Product)) == []
    chapter = asyncio.run(_fetch_one(factory, Chapter, id=CHAPTER_ID))
    assert chapter is not None and chapter.title == "第 1 集"  # 章节还没被改


def test_generate_before_brief_is_409(routed_client: tuple[TestClient, async_sessionmaker[AsyncSession]]) -> None:
    """没保存过 brief 就点生成 → 409 结构化明细（不是 500，也不是空跑一次模型）。"""
    client, _factory = routed_client
    resp = client.post(f"{BASE}/generate")
    assert resp.status_code == 409
    assert resp.json()["meta"]["error"]["code"] == "drama_plan_brief_required"


# ---------------------------------------------------------------------------
# 3) 演练：走真实路由，返回占位且不写 plan
# ---------------------------------------------------------------------------


def test_generate_in_dry_run_writes_no_plan(
    routed_client: tuple[TestClient, async_sessionmaker[AsyncSession]]
) -> None:
    """演练模式（conftest 强制）下：真实编排路径返回占位，草稿列**不写 plan**。"""
    client, factory = routed_client
    assert client.put(f"{BASE}/brief", json=BRIEF_BODY).status_code == 200

    resp = client.post(f"{BASE}/generate")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["plan"] is None, "演练模式不许给假草稿"
    assert data["status"] == "none"
    assert "未生成草稿" in data["note"]

    row = asyncio.run(_fetch_one(factory, DramaPlanDraft, chapter_id=CHAPTER_ID))
    assert row is not None and row.plan == {}
    assert row.status == ""
    assert row.meta.get("llm_called") is False


# ---------------------------------------------------------------------------
# 4) 租约：同一章在租约内只能生成一次
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_lease_blocks_second_generate_within_window() -> None:
    """抢到租约后再抢 → 409 drama_plan_generating（重复点击不重复付费的落点）。"""
    factory, engine = await _build_harness_async()
    await _seed_async(factory)
    try:
        async with factory() as session:
            await drafts.save_brief(session, chapter_id=CHAPTER_ID, project_id=PROJECT_ID, brief=BRIEF_BODY)
            await session.commit()
        async with factory() as session:
            row, token = await drafts.claim_for_generate(session, chapter_id=CHAPTER_ID)
            assert row.status == "running" and token
            await session.commit()
        async with factory() as session:
            with pytest.raises(Exception) as info:
                await drafts.claim_for_generate(session, chapter_id=CHAPTER_ID)
            assert getattr(info.value, "status_code", None) == 409
            assert info.value.detail["code"] == "drama_plan_generating"
            # 租约持有者的令牌还能写结果
            assert await drafts.mark_ok(
                session, chapter_id=CHAPTER_ID, token=token, plan=_plan_payload(), model="m", meta={}
            ) is not None
            await session.commit()
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------------
# 5) confirm：一个事务落齐正式产物
# ---------------------------------------------------------------------------


def test_confirm_materializes_chapter_shots_dialog_assets_and_links(
    routed_client: tuple[TestClient, async_sessionmaker[AsyncSession]], monkeypatch: pytest.MonkeyPatch
) -> None:
    client, factory = routed_client
    monkeypatch.setattr(service.orchestration, "preview_drama_plan", _fake_preview())
    assert client.put(f"{BASE}/brief", json=BRIEF_BODY).status_code == 200
    assert client.post(f"{BASE}/generate").status_code == 200

    resp = client.post(f"{BASE}/confirm")
    assert resp.status_code == 200, resp.text
    counts = resp.json()["data"]
    assert counts["shots_created"] == 3
    assert counts["dialog_lines_created"] == 2
    assert counts["characters_created"] == 2
    assert counts["scenes_created"] == 1
    assert counts["product_created"] is True
    assert counts["shot_product_links"] == 2          # 3 镜里 2 镜出现商品
    assert counts["shot_character_links"] == 4        # 1 + 2 + 1

    # 章节：标题与主线被写入
    chapter = asyncio.run(_fetch_one(factory, Chapter, id=CHAPTER_ID))
    assert chapter is not None
    assert chapter.title == "面试那天"
    assert chapter.summary == "她带着一瓶精华去面试，面试官是前任"
    assert chapter.storyboard_count == 3

    # 分镜：真实时长 / 景别 / 机位 / 运镜 / 动作拍点（不是硬编码的 ms/eye_level/4 秒）
    shots = asyncio.run(_fetch_all(factory, Shot, chapter_id=CHAPTER_ID))
    assert [shot.index for shot in shots] == [1, 2, 3]
    details = {shot.id: asyncio.run(_fetch_one(factory, ShotDetail, id=shot.id)) for shot in shots}
    first = details[shots[0].id]
    assert first is not None
    assert first.duration == 8
    assert first.camera_shot == "MS"
    assert first.movement == "STATIC"
    assert first.action_beats == ["推门", "拍瓶"]
    second = details[shots[1].id]
    assert second is not None and second.duration == 5 and second.movement == "DOLLY_IN"

    # 对白独立表（script_division 不写这张表，这是本函数存在的核心理由之一）
    lines = asyncio.run(_fetch_all(factory, ShotDialogLine, shot_detail_id=shots[0].id))
    assert [line.text for line in lines] == ["我不用补妆。"]
    assert lines[0].speaker_name == "林小满"
    assert lines[0].speaker_character_id is not None

    # 资产与关联行
    characters = asyncio.run(_fetch_all(factory, Character, project_id=PROJECT_ID))
    assert {item.name for item in characters} == {"林小满", "周砚"}
    assert all(item.description for item in characters)  # 画像文本已渲染
    scenes = asyncio.run(_fetch_all(factory, Scene))
    assert [item.name for item in scenes] == ["写字楼会议室"]
    assert asyncio.run(_fetch_all(factory, ProjectSceneLink, project_id=PROJECT_ID))
    product = asyncio.run(_fetch_one(factory, Product, name="紧致焕颜精华"))
    assert product is not None
    links = asyncio.run(_fetch_all(factory, ProjectProductLink, project_id=PROJECT_ID))
    assert sum(1 for link in links if link.shot_id) == 2      # shot 档 = 出现商品的镜头数
    assert sum(1 for link in links if not link.shot_id) == 1  # 项目档
    assert asyncio.run(_fetch_all(factory, ShotCharacterLink, shot_id=shots[1].id))


def test_confirm_without_draft_is_409(routed_client: tuple[TestClient, async_sessionmaker[AsyncSession]]) -> None:
    client, _factory = routed_client
    assert client.put(f"{BASE}/brief", json=BRIEF_BODY).status_code == 200
    resp = client.post(f"{BASE}/confirm")
    assert resp.status_code == 409
    assert resp.json()["meta"]["error"]["code"] == "drama_plan_draft_missing"


def test_confirm_rejects_chapter_with_existing_shots(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    """章节已有镜头 → 409（与 script_division 同一口径，避免新旧分镜混在一起）。"""
    factory, engine = _build_harness()
    _seed_project_chapter(factory, with_shot=True)

    async def override_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            try:
                yield session
                await session.commit()   # 与 conftest 的会话语义一致：成功即提交
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_db
    monkeypatch.setattr(service.orchestration, "preview_drama_plan", _fake_preview())
    try:
        client = TestClient(app)
        assert client.put(f"{BASE}/brief", json=BRIEF_BODY).status_code == 200
        assert client.post(f"{BASE}/generate").status_code == 200
        resp = client.post(f"{BASE}/confirm")
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert resp.status_code == 409
    assert resp.json()["meta"]["error"]["code"] == "drama_plan_chapter_not_empty"


def test_confirm_rejects_insufficient_product_coverage(
    routed_client: tuple[TestClient, async_sessionmaker[AsyncSession]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """商品只出现在 1/3 镜 → confirm 拒绝（按关联行数判定，不信模型自述）。"""
    client, _factory = routed_client
    monkeypatch.setattr(
        service.orchestration,
        "preview_drama_plan",
        _fake_preview(_plan_payload(product_present=(True, False, False))),
    )
    assert client.put(f"{BASE}/brief", json=BRIEF_BODY).status_code == 200
    assert client.post(f"{BASE}/generate").status_code == 200

    resp = client.post(f"{BASE}/confirm")
    assert resp.status_code == 409
    error = resp.json()["meta"]["error"]
    assert error["code"] == "drama_plan_product_coverage"
    assert error["product_shots"] == 1 and error["required"] == 2


def test_manual_edit_is_saved_and_used_by_confirm(
    routed_client: tuple[TestClient, async_sessionmaker[AsyncSession]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """人工编辑必须能存下来（刷新不丢），并且确认落库用的是**编辑后**的草稿。"""
    client, factory = routed_client
    monkeypatch.setattr(service.orchestration, "preview_drama_plan", _fake_preview())
    assert client.put(f"{BASE}/brief", json=BRIEF_BODY).status_code == 200
    assert client.post(f"{BASE}/generate").status_code == 200

    edited = _plan_payload()
    edited["title"] = "手改后的标题"
    edited["shots"][0]["duration"] = 12          # 人工把第一镜改成 12 秒
    edited["shots"][0]["title"] = "手改：拍瓶"
    edited["shots"][1]["product_present"] = False  # 仍是 1/3？不：第一镜仍为 True → 1/3 不满足
    # 保持「至少一半」：把第 3 镜也标成出现商品，于是 2/3 满足
    edited["shots"][2]["product_present"] = True

    resp = client.put(f"{BASE}/draft", json=edited)
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["plan"]["title"] == "手改后的标题"

    # 刷新后（重新 GET）读到的是编辑后的草稿
    assert client.get(BASE).json()["data"]["plan"]["title"] == "手改后的标题"

    confirmed = client.post(f"{BASE}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["data"]["shot_product_links"] == 2

    shots = asyncio.run(_fetch_all(factory, Shot, chapter_id=CHAPTER_ID))
    first = asyncio.run(_fetch_one(factory, ShotDetail, id=shots[0].id))
    assert first is not None and first.duration == 12  # 落库用的是手改后的时长


def test_manual_edit_normalizes_enums_and_rejects_broken_structure(
    routed_client: tuple[TestClient, async_sessionmaker[AsyncSession]]
) -> None:
    """手改草稿也过同一套归一化（非法枚举不会原样落库）；结构坏了才 422。"""
    client, _factory = routed_client
    assert client.put(f"{BASE}/brief", json=BRIEF_BODY).status_code == 200

    # (1) 非法景别：DTO 里 camera_shot 是普通字符串，不归一就会把脏值写进 shot_details。
    #     这里必须被归一到默认值，并带回一条 warning（不静默改掉用户输入）。
    edited = _plan_payload()
    edited["shots"][0]["camera_shot"] = "不存在的景别"
    resp = client.put(f"{BASE}/draft", json=edited)
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["plan"]["shots"][0]["camera_shot"] == "MS"
    assert any("景别" in item for item in data["plan"]["warnings"])

    # (2) 结构坏掉（shots 不是数组）→ 422，且**不覆盖**已经保存的草稿
    broken = dict(_plan_payload())
    broken["shots"] = "这不是数组"
    bad = client.put(f"{BASE}/draft", json=broken)
    assert bad.status_code == 422
    assert bad.json()["meta"]["error"]["code"] == "drama_plan_invalid_draft"
    assert client.get(BASE).json()["data"]["plan"]["shots"][0]["camera_shot"] == "MS"


def test_generate_returns_blocked_envelope_when_guard_trips(
    routed_client: tuple[TestClient, async_sessionmaker[AsyncSession]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """守卫兜底：服务层抛出拦截异常时，路由必须回 409 结构化信封且 `paid_call_made=false`。

    这条锁的是验收里那句「漏挂守卫 409 且 paid_call_made=false」：
    演练/未确认真实付费时服务层自己会返回占位，**但万一某条新路径漏了服务层判定**，
    路由这一层必须把它变成用户看得懂的结构化 409，而不是 500 或"静默成功"。
    """
    from app.services.studio.llm_orchestration import dry_run

    client, _factory = routed_client
    assert client.put(f"{BASE}/brief", json=BRIEF_BODY).status_code == 200

    async def blocked(*_args: Any, **_kwargs: Any) -> Any:
        raise dry_run.DryRunBlocked("剧情策划生成", outlet=dry_run.OUTLET_LLM)

    monkeypatch.setattr(service.orchestration, "preview_drama_plan", blocked)

    resp = client.post(f"{BASE}/generate")
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == 409
    assert body["data"] is None
    error = body["meta"]["error"]
    assert error["code"] == "paid_outlet_blocked"
    # 「被拦 = 没有发生任何真实调用」这件事必须由后端自证
    assert error["paid_call_made"] is False
    assert error["outlet"] == "llm"


def test_generate_with_broken_json_is_422_and_writes_no_draft(
    routed_client: tuple[TestClient, async_sessionmaker[AsyncSession]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """模型返回不是 JSON → 422，且草稿列**保持为空**（不写半成品），并把失败原因如实记下。"""
    from app.services.studio.llm_orchestration import drama_plan as orchestration
    from app.services.studio.llm_orchestration.support import raise_parse_failure
    from app.services.studio.llm_orchestration.json_utils import JSONParseError

    client, factory = routed_client
    assert client.put(f"{BASE}/brief", json=BRIEF_BODY).status_code == 200

    async def broken(*_args: Any, **_kwargs: Any) -> Any:
        # 真实路径里解析失败就是这么抛的（support.raise_parse_failure → 422 + 结构化明细）
        raise_parse_failure(JSONParseError("模型返回的 JSON 顶层必须是对象。", raw_text="抱歉，我不能完成这个请求。"))
        raise AssertionError("unreachable")  # pragma: no cover

    monkeypatch.setattr(orchestration, "preview_drama_plan", broken)

    resp = client.post(f"{BASE}/generate")
    assert resp.status_code == 422
    detail = resp.json()["meta"]["error"]
    assert detail["code"] == "llm_json_parse_failed"

    row = asyncio.run(_fetch_one(factory, DramaPlanDraft, chapter_id=CHAPTER_ID))
    assert row is not None
    assert row.plan == {}, "解析失败绝不允许写半成品草稿"
    assert row.status == "failed"
    assert "JSON" in row.error
    assert row.claim_token is None, "失败后租约必须释放，否则会卡住 5 分钟"
    # 正式产物一行都没有
    assert asyncio.run(_fetch_all(factory, Shot, chapter_id=CHAPTER_ID)) == []


# ---------------------------------------------------------------------------
# 6) 项目级入口：找 / 建可用空章节
# ---------------------------------------------------------------------------


def test_project_endpoint_reuses_empty_chapter_then_creates(
    routed_client: tuple[TestClient, async_sessionmaker[AsyncSession]]
) -> None:
    client, factory = routed_client
    url = f"/api/v1/studio/projects/{PROJECT_ID}/drama-plan/chapter"

    first = client.post(url, json={"product_name": "紧致焕颜精华"})
    assert first.status_code == 200, first.text
    assert first.json()["data"]["chapter_id"] == CHAPTER_ID
    assert first.json()["data"]["created"] is False  # 复用了种子里那个没有分镜的章节

    # 把这一集填上分镜后，再取应新建一个（标题取商品名）
    async def _add_shot() -> None:
        async with factory() as session:
            session.add(Shot(id="shot-x", chapter_id=CHAPTER_ID, index=1, title="占位"))
            await session.commit()

    asyncio.run(_add_shot())
    second = client.post(url, json={"product_name": "焕颜面霜"})
    assert second.status_code == 200, second.text
    data = second.json()["data"]
    assert data["created"] is True
    assert data["chapter_id"] != CHAPTER_ID
    assert data["title"] == "焕颜面霜"
