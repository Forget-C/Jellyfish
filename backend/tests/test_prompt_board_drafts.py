"""集级提示词看板的**服务端草稿**：落库 / 恢复 / 幂等 / 与正式列隔离 / 防重复付费。

要修的问题（2026-09-19「整集视频提示词草稿丢失」）：看板按「一次一镜」**真实调用**大模型
（会产生费用），草稿此前只活在浏览器内存里 —— 刷新 / 切走 / 中断就全丢，
已经付过费的结果无法恢复，只能重新花钱生成一遍。

本文件锁住六件事：
1. 草稿**落服务端库**：新的请求（= 刷新）还能把逐镜状态读回来；
2. 草稿写入**一个字节都不碰** ``shot_details.video_prompt``，只有 ``/save`` 写正式列；
3. ``ok`` / ``failed`` 分得清，「未开始」不落行（不把两者混在一起）；
4. ``/save`` 成功后清掉**被写入镜头**的草稿，并沿用既有的 ``origin → source`` 映射；
5. 同一镜的「生成中」租约挡住并发生成（防重复付费）；租约可续、可释放、**会过期**
   （中断/进程被杀后还能续跑）；
6. 客户端自己塞进来的正文拿不到 ``draft_token``，因此仍然无法冒充「大模型生成」保存。

全程不发起任何真实调用：LLM 预览一律用 stub 替换，DRY_RUN 保持开启。
"""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app
from app.models.studio import Chapter, Project, Shot, ShotDetail
from app.services.studio import prompt_board as board
from app.services.studio import prompt_board_drafts as drafts
from tests.llm_orchestration_fixtures import build_session

CHAPTER = "proj-1::EP01"


# ---------------------------------------------------------------------------
# 脚手架：内存库 / 种子 / HTTP 客户端（每个请求一个新会话 = 一次"刷新"）
# ---------------------------------------------------------------------------


def _shot_id(index: int) -> str:
    return f"proj-1_EP01_SHOT_{index:03d}"


async def _create_all(engine) -> None:
    from app.core.db import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _build() -> tuple[async_sessionmaker[AsyncSession], object]:
    from app.core.db import Base  # noqa: F401
    import app.models  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    asyncio.run(_create_all(engine))
    return factory, engine


def _override(factory: async_sessionmaker[AsyncSession]):
    async def override_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    return override_db


@contextmanager
def _client(factory: async_sessionmaker[AsyncSession]):
    """TestClient + get_db 覆盖。**每个请求一个新会话**，第二个请求就是"刷新页面"。"""
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def _seed(factory: async_sessionmaker[AsyncSession], *, count: int = 3) -> None:
    async def run() -> None:
        async with factory() as db:
            await _seed_episode(db, count=count)

    asyncio.run(run())


async def _seed_episode(db: AsyncSession, *, count: int = 3) -> None:
    db.add(Project(id="proj-1", name="测试项目", description="", style="真人都市", visual_style="现实"))
    await db.flush()
    db.add(Chapter(id=CHAPTER, project_id="proj-1", index=1, title="EP01", raw_text="文本", condensed_text="文本"))
    await db.flush()
    for index in range(1, count + 1):
        shot_id = _shot_id(index)
        db.add(
            Shot(
                id=shot_id,
                chapter_id=CHAPTER,
                index=index,
                title=f"镜头{index}",
                script_excerpt=f"第{index}镜的剧本摘录",
                status="ready",
            )
        )
        # 正式列刻意留空：本文件要证明"草稿不写这里"
        db.add(ShotDetail(id=shot_id, camera_shot="中景", angle="平视", movement="固定", video_prompt=""))
    # 必须提交：HTTP 用例里每个请求是一个新会话，未提交的数据在会话关闭时会回滚
    await db.commit()


class _StubMeta:
    def __init__(self, **values) -> None:
        self.__dict__.update(values)


class _StubPreview:
    """替身：完全等价于"真实调用成功"的返回（不触网、不花钱）。"""

    def __init__(
        self,
        prompt: str,
        *,
        llm_called: bool = True,
        latency_ms: int = 42,
        model: str = "deepseek-chat",
        warnings: list[str] | None = None,
    ) -> None:
        self.final_prompt = prompt
        self.meta = _StubMeta(llm_called=llm_called, latency_ms=latency_ms, model=model)
        self.warnings = list(warnings or [])


def _stub_generation(monkeypatch, prompt: str) -> list[dict[str, str]]:
    """把真实 LLM 预览换成 stub，并记录**实际发生了几次生成**（防重复付费要断言这个）。

    只替换 ``preview_video_prompt`` 与 ``dry_run_enabled``，**不改** ``JELLYFISH_DRY_RUN``
    环境变量：真实调用的闸门保持关闭状态。
    """
    calls: list[dict[str, str]] = []

    async def _preview(db, *, body, llm_caller=None):  # noqa: ANN001, ARG001 - 对齐真实签名
        calls.append({"shot_id": str(body.shot_id)})
        return _StubPreview(prompt)

    monkeypatch.setattr(board, "preview_video_prompt", _preview)
    monkeypatch.setattr(board.dry_run, "dry_run_enabled", lambda: False)
    return calls


async def _official_prompt(factory: async_sessionmaker[AsyncSession], shot_id: str) -> tuple[str, str]:
    """正式列（shot_details.video_prompt / video_prompt_source）当前值。"""
    async with factory() as db:
        row = await db.get(ShotDetail, shot_id)
        return (str(row.video_prompt or ""), str(row.video_prompt_source or ""))


async def _draft_statuses(factory: async_sessionmaker[AsyncSession]) -> dict[str, str]:
    async with factory() as db:
        state = await board.load_draft_state(db, chapter_id=CHAPTER)
        return {item["shot_id"]: item["status"] for item in state["shots"]}


# ---------------------------------------------------------------------------
# 1) 幂等 upsert / 状态区分 / 不碰正式列
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_draft_upsert_is_idempotent_one_row_per_shot():
    """同一镜反复保存（页面重试/重复上报）→ 永远只有一行，内容以最后一次为准。"""
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=2)
        first = await board.save_shot_draft(
            db, chapter_id=CHAPTER, shot_id=_shot_id(1), status="ok", prompt="甲版提示词", model="deepseek-chat"
        )
        second = await board.save_shot_draft(
            db, chapter_id=CHAPTER, shot_id=_shot_id(1), status="ok", prompt="甲版提示词", model="deepseek-chat"
        )
        count = await drafts.count_for_chapter(db, chapter_id=CHAPTER)
        state = await board.load_draft_state(db, chapter_id=CHAPTER)
    finally:
        await engine.dispose()

    assert first["created"] is True
    assert second["created"] is False          # 第二次是更新，不是新行
    assert count == 1                          # 幂等：一镜一行
    assert state["summary"]["total"] == 2
    assert state["summary"]["ok"] == 1
    assert state["shots"][0]["prompt"] == "甲版提示词"


@pytest.mark.asyncio
async def test_failed_status_is_stored_and_distinguishable_from_ok_and_pending():
    """ok / failed / 未开始 三者必须分得清：失败带原因，未开始**不落行**。"""
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=3)
        await board.save_shot_draft(db, chapter_id=CHAPTER, shot_id=_shot_id(1), status="ok", prompt="成功的一版")
        await board.save_shot_draft(
            db, chapter_id=CHAPTER, shot_id=_shot_id(2), status="failed", error="上游超时（LLM 5xx）"
        )
        state = await board.load_draft_state(db, chapter_id=CHAPTER)
        rows = {item["shot_id"]: item for item in state["shots"]}
        stored_rows = await drafts.count_for_chapter(db, chapter_id=CHAPTER)
    finally:
        await engine.dispose()

    assert rows[_shot_id(1)]["status"] == "ok"
    assert rows[_shot_id(2)]["status"] == "failed"
    assert "超时" in rows[_shot_id(2)]["error"]
    assert rows[_shot_id(2)]["prompt"] == ""      # 失败且没有正文
    assert rows[_shot_id(3)]["status"] == "pending"  # 未开始
    assert rows[_shot_id(3)]["has_draft"] is False
    assert stored_rows == 2                        # 未开始不落行：只有 ok 与 failed 两行
    assert state["summary"] == {"total": 3, "ok": 1, "failed": 1, "running": 0, "pending": 1}


def test_draft_write_never_touches_official_prompt_column():
    """草稿再怎么存，``shot_details.video_prompt`` 都必须还是空的（隔离硬约束）。"""
    factory, engine = _build()
    _seed(factory, count=1)
    try:
        with _client(factory) as client:
            res = client.post(
                f"/api/v1/studio/prompt-board/{CHAPTER}/drafts",
                json={"shot_id": _shot_id(1), "status": "ok", "prompt": "草稿正文"},
            )
            assert res.status_code == 200, res.text
            assert res.json()["data"]["draft"]["status"] == "ok"
            board_res = client.get(f"/api/v1/studio/prompt-board/{CHAPTER}")
        prompt, source = asyncio.run(_official_prompt(factory, _shot_id(1)))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert board_res.json()["data"]["summary"] == {"total": 1, "with_prompt": 0, "missing": 1}
    assert prompt == "" and source == ""  # 正式列未被草稿污染


# ---------------------------------------------------------------------------
# 2) 真实生成 → 落库 → 刷新后恢复 → 用恢复的令牌保存
# ---------------------------------------------------------------------------


def test_generated_draft_persists_and_survives_refresh_then_saves_as_llm(monkeypatch):
    """核心回归：真实生成成功后草稿落库；刷新（新请求）仍能读回；用它保存得到 source=llm。"""
    factory, engine = _build()
    _seed(factory, count=3)
    calls = _stub_generation(monkeypatch, "第一镜的视频提示词")
    try:
        with _client(factory) as client:
            # ① 生成（真 LLM 被 stub 顶替；服务端此时把草稿落库）
            draft_res = client.post(
                f"/api/v1/studio/prompt-board/{CHAPTER}/draft", json={"shot_id": _shot_id(1)}
            )
            assert draft_res.status_code == 200, draft_res.text
            generated = draft_res.json()["data"]
            assert generated["status"] == "draft"
            assert generated["persisted"] is True

            # ② 刷新：全新的请求 / 全新会话，草稿必须还在
            refreshed = client.get(f"/api/v1/studio/prompt-board/{CHAPTER}/drafts")
            assert refreshed.status_code == 200, refreshed.text
            data = refreshed.json()["data"]
            row = {item["shot_id"]: item for item in data["shots"]}[_shot_id(1)]
            assert row["status"] == "ok"
            assert row["prompt"] == "第一镜的视频提示词"
            assert row["saveable"] is True
            assert row["draft_token"] == generated["draft_token"]
            assert data["summary"] == {"total": 3, "ok": 1, "failed": 0, "running": 0, "pending": 2}

            # 刷新中途正式列仍然是空的（草稿≠正式）
            assert asyncio.run(_official_prompt(factory, _shot_id(1)))[0] == ""

            # ③ 用"恢复出来的"令牌确认保存：原样走既有的 origin → source 映射
            save_res = client.post(
                f"/api/v1/studio/prompt-board/{CHAPTER}/save",
                json={
                    "entries": [
                        {"shot_id": _shot_id(1), "prompt": row["prompt"], "draft_token": row["draft_token"]}
                    ],
                    "mode": "fill_empty",
                    "origin": "llm_draft",
                    "allow_partial": True,
                },
            )
            assert save_res.status_code == 200, save_res.text
            saved = save_res.json()["data"]
            assert saved["applied_count"] == 1
            assert saved["source"] == "llm"
            assert saved["cleared_draft_count"] == 1  # 正式落库后草稿被清掉

            after = client.get(f"/api/v1/studio/prompt-board/{CHAPTER}/drafts").json()["data"]
        prompt, source = asyncio.run(_official_prompt(factory, _shot_id(1)))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert calls == [{"shot_id": _shot_id(1)}]     # 只生成了一次（没有重复付费）
    assert (prompt, source) == ("第一镜的视频提示词", "llm")
    assert {item["shot_id"]: item["status"] for item in after["shots"]}[_shot_id(1)] == "pending"


def test_client_reported_ok_draft_gets_no_token_and_cannot_be_saved_as_llm():
    """客户端自己塞的"ok 草稿"不算大模型产物：拿不到令牌，也就存不进 llm 来源。"""
    factory, engine = _build()
    _seed(factory, count=1)
    try:
        with _client(factory) as client:
            res = client.post(
                f"/api/v1/studio/prompt-board/{CHAPTER}/drafts",
                json={"shot_id": _shot_id(1), "status": "ok", "prompt": "我手写的一段"},
            )
            row = res.json()["data"]["draft"]
            assert row["status"] == "ok" and row["prompt"] == "我手写的一段"
            assert row["draft_token"] == "" and row["saveable"] is False

            forged = client.post(
                f"/api/v1/studio/prompt-board/{CHAPTER}/save",
                json={
                    "entries": [{"shot_id": _shot_id(1), "prompt": "我手写的一段", "draft_token": ""}],
                    "mode": "fill_empty",
                    "origin": "llm_draft",
                    "allow_partial": True,
                },
            ).json()["data"]
        prompt, _source = asyncio.run(_official_prompt(factory, _shot_id(1)))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert forged["applied_count"] == 0
    assert any("草稿令牌" in item["reason"] for item in forged["results"])
    assert prompt == ""


# ---------------------------------------------------------------------------
# 3) 保存成功后清草稿（只清被写入的镜头）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_save_clears_only_written_shot_drafts_and_maps_origin_to_source():
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=3)
        for index in (1, 2):
            await board.save_shot_draft(
                db, chapter_id=CHAPTER, shot_id=_shot_id(index), status="ok", prompt=f"草稿{index}"
            )
        result = await board.save_entries(
            db,
            chapter_id=CHAPTER,
            entries=[{"shot_id": _shot_id(1), "prompt": "外部导入的第1条"}],
            mode=board.MODE_FILL_EMPTY,
            origin="external_import",
            allow_partial=True,
        )
        remaining = await drafts.load_map(db, chapter_id=CHAPTER)
        first = await db.get(ShotDetail, _shot_id(1))
        second = await db.get(ShotDetail, _shot_id(2))
    finally:
        await engine.dispose()

    assert result["applied_count"] == 1
    assert result["source"] == "external_import"
    assert result["cleared_draft_count"] == 1
    assert _shot_id(1) not in remaining     # 已写入正式列 → 草稿清掉
    assert _shot_id(2) in remaining         # 没写入的镜头草稿保留
    assert first.video_prompt == "外部导入的第1条"
    assert first.video_prompt_source == "external_import"
    assert second.video_prompt == ""


@pytest.mark.asyncio
async def test_failed_retry_keeps_previous_generated_prompt():
    """重试失败**不能**把上一版真金白银生成出来的正文抹掉（只加失败原因）。"""
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=1)
        await drafts.upsert(
            db,
            chapter_id=CHAPTER,
            shot_id=_shot_id(1),
            status="ok",
            prompt="上一版已经生成的正文",
            source="llm",
            server_generated=True,
        )
        payload = await board.save_shot_draft(
            db, chapter_id=CHAPTER, shot_id=_shot_id(1), status="failed", error="重试超时"
        )
        state = await board.load_draft_state(db, chapter_id=CHAPTER)
    finally:
        await engine.dispose()

    assert payload["draft"]["status"] == "failed"
    assert payload["draft"]["error"] == "重试超时"
    assert payload["draft"]["prompt"] == "上一版已经生成的正文"
    assert payload["draft"]["draft_token"]  # 正文仍是服务端生成的 → 仍可保存
    assert state["summary"]["ok"] == 0 and state["summary"]["failed"] == 1


# ---------------------------------------------------------------------------
# 4) 「生成中」租约：防并发生成 / 可续租 / 可释放 / 会过期
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_claim_blocks_second_generation_without_paying_twice(monkeypatch):
    """同一镜已有进行中的生成 → 第二次调用直接 busy，**不发起**任何付费调用。"""
    db, engine = await build_session()
    calls = _stub_generation(monkeypatch, "只应生成一次")
    try:
        await _seed_episode(db, count=1)
        first_claim = await board.claim_shot_draft(db, chapter_id=CHAPTER, shot_id=_shot_id(1))
        assert first_claim["claimed"] is True

        blocked = await board.generate_draft(db, chapter_id=CHAPTER, shot_id=_shot_id(1))
        assert blocked["status"] == "busy"
        assert calls == []                      # ← 关键：一次调用都没发出去

        # 带着自己的令牌 = 续租，允许继续（页面"先占位再生成"的用法）
        resumed = await board.generate_draft(
            db, chapter_id=CHAPTER, shot_id=_shot_id(1), claim_token=first_claim["claim_token"]
        )
        assert resumed["status"] == "draft"
        assert calls == [{"shot_id": _shot_id(1)}]

        # 生成结束 → 租约已释放，下一镜/同一镜可以正常再来
        again = await board.claim_shot_draft(db, chapter_id=CHAPTER, shot_id=_shot_id(1))
        assert again["claimed"] is True
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_expired_lease_allows_resume_after_interruption(monkeypatch):
    """租约到期（页面被关/进程被杀）→ 必须能重新抢占，不能永久卡住。"""
    db, engine = await build_session()
    calls = _stub_generation(monkeypatch, "中断后重新生成的正文")
    try:
        await _seed_episode(db, count=1)
        claimed = await board.claim_shot_draft(
            db, chapter_id=CHAPTER, shot_id=_shot_id(1), lease_seconds=60
        )
        assert claimed["claimed"] is True
        # 模拟"中断后干等过租约"：把这行的到期时间拨到过去（不睡眠，测试不拖时间）
        row = await drafts.get_row(db, chapter_id=CHAPTER, shot_id=_shot_id(1))
        row.claim_expires_at = drafts.now_utc() - timedelta(seconds=5)
        await db.commit()

        # 读层把"running 但租约已失效"渲染成 pending + interrupted（不是永远"生成中"）
        state = await board.load_draft_state(db, chapter_id=CHAPTER)
        assert state["shots"][0]["status"] == "pending"
        assert state["shots"][0]["interrupted"] is True

        retried = await board.claim_shot_draft(db, chapter_id=CHAPTER, shot_id=_shot_id(1))
        assert retried["claimed"] is True
        generated = await board.generate_draft(
            db, chapter_id=CHAPTER, shot_id=_shot_id(1), claim_token=retried["claim_token"]
        )
        assert generated["status"] == "draft"
        assert calls == [{"shot_id": _shot_id(1)}]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_release_clears_lease_and_can_record_failure():
    """用户点"停止"后不生成这一镜 → 释放租约；带原因则同时记为该镜失败。"""
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=1)
        claimed = await board.claim_shot_draft(db, chapter_id=CHAPTER, shot_id=_shot_id(1))
        released = await board.release_shot_draft(
            db, chapter_id=CHAPTER, shot_id=_shot_id(1), claim_token=claimed["claim_token"], error="用户停止"
        )
        assert released["released"] is True
        assert released["draft"]["status"] == "failed"
        assert released["draft"]["error"] == "用户停止"
        # 释放后可以重新抢占
        assert (await board.claim_shot_draft(db, chapter_id=CHAPTER, shot_id=_shot_id(1)))["claimed"] is True
        # 令牌不匹配时拒绝释放（不误放别人的租约）
        assert (
            await board.release_shot_draft(
                db, chapter_id=CHAPTER, shot_id=_shot_id(1), claim_token="not-the-holder"
            )
        )["released"] is False
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_release_without_result_renders_as_interrupted_not_forever_running():
    """抢占后没有结果就退出（页面关掉）→ 读层显示"未开始/已中断"，不能永远"生成中"。"""
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=1)
        claimed = await board.claim_shot_draft(db, chapter_id=CHAPTER, shot_id=_shot_id(1))
        await board.release_shot_draft(
            db, chapter_id=CHAPTER, shot_id=_shot_id(1), claim_token=claimed["claim_token"]
        )
        state = await board.load_draft_state(db, chapter_id=CHAPTER)
    finally:
        await engine.dispose()

    row = state["shots"][0]
    assert row["status"] == "pending"
    assert row["interrupted"] is True
    assert state["summary"]["running"] == 0


# ---------------------------------------------------------------------------
# 5) 端点的请求/响应形状（前端按这份契约接线）
# ---------------------------------------------------------------------------


def test_drafts_endpoints_shapes_and_delete_scope():
    """GET / POST / DELETE / claim / release 五个端点的形状与删除范围。"""
    factory, engine = _build()
    _seed(factory, count=3)
    base = f"/api/v1/studio/prompt-board/{CHAPTER}"
    try:
        with _client(factory) as client:
            # 空集：整集都是"未开始"
            empty = client.get(f"{base}/drafts").json()["data"]
            assert [item["status"] for item in empty["shots"]] == ["pending"] * 3
            assert empty["summary"] == {"total": 3, "ok": 0, "failed": 0, "running": 0, "pending": 3}

            # 保存一镜 ok + 一镜 failed
            ok = client.post(
                f"{base}/drafts",
                json={
                    "shot_id": _shot_id(1),
                    "status": "ok",
                    "prompt": "第 1 镜草稿",
                    "model": "deepseek-chat",
                    "meta": {"latency_ms": 1234},
                },
            ).json()["data"]
            assert ok["created"] is True
            assert ok["draft"]["code"] == "S001"
            assert ok["draft"]["meta"] == {"latency_ms": 1234}
            assert ok["draft"]["status"] == "ok"
            failed = client.post(
                f"{base}/drafts",
                json={"shot_id": _shot_id(2), "status": "failed", "error": "上游 502"},
            ).json()["data"]
            assert failed["draft"]["status"] == "failed"

            # 非法参数：状态只接受 ok / failed；ok 必须带正文；来源要合法
            bad_status = client.post(
                f"{base}/drafts", json={"shot_id": _shot_id(3), "status": "running"}
            )
            assert bad_status.status_code == 422  # pydantic 直接拦住
            no_prompt = client.post(
                f"{base}/drafts", json={"shot_id": _shot_id(3), "status": "ok", "prompt": ""}
            ).json()["data"]
            assert no_prompt["draft"] is None and "非空" in no_prompt["error"]
            bad_source = client.post(
                f"{base}/drafts",
                json={"shot_id": _shot_id(3), "status": "ok", "prompt": "x", "source": "whatever"},
            ).json()["data"]
            assert bad_source["draft"] is None and "来源" in bad_source["error"]
            unknown_shot = client.post(
                f"{base}/drafts", json={"shot_id": "not-in-this-chapter", "status": "ok", "prompt": "x"}
            ).json()["data"]
            assert unknown_shot["draft"] is None and "不属于本集" in unknown_shot["error"]

            # 抢占 / 释放
            claim = client.post(f"{base}/drafts/claim", json={"shot_id": _shot_id(3)}).json()["data"]
            assert claim["claimed"] is True and claim["code"] == "S003"
            assert claim["draft"]["status"] == "running"
            blocked = client.post(f"{base}/drafts/claim", json={"shot_id": _shot_id(3)}).json()["data"]
            assert blocked["claimed"] is False and "正在生成中" in blocked["reason"]
            release = client.post(
                f"{base}/drafts/release",
                json={"shot_id": _shot_id(3), "claim_token": claim["claim_token"]},
            ).json()["data"]
            assert release["released"] is True

            # 只清被指定的镜头
            scoped = client.delete(f"{base}/drafts?shot_ids={_shot_id(1)}").json()["data"]
            assert scoped["cleared"] == 1
            left = client.get(f"{base}/drafts").json()["data"]
            statuses = {item["shot_id"]: item["status"] for item in left["shots"]}
            assert statuses[_shot_id(1)] == "pending"
            assert statuses[_shot_id(2)] == "failed"   # 没被指定 → 保留

            # 整集清空（shot2 的失败草稿 + shot3 被抢占时落下的那一行）
            cleared_all = client.delete(f"{base}/drafts").json()["data"]["cleared"]
            assert cleared_all == 2
            final = client.get(f"{base}/drafts").json()["data"]
            assert final["summary"] == {"total": 3, "ok": 0, "failed": 0, "running": 0, "pending": 3}
        prompt, _source = asyncio.run(_official_prompt(factory, _shot_id(1)))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert prompt == ""  # 整条链路（含 claim/release/delete）都没碰正式列


def test_draft_state_recovers_ok_failed_pending_after_refresh():
    """刷新后页面要能直接看出 已完成 / 失败 / 未开始（恢复逐镜队列的依据）。"""
    factory, engine = _build()
    _seed(factory, count=3)
    base = f"/api/v1/studio/prompt-board/{CHAPTER}"
    try:
        with _client(factory) as client:
            client.post(f"{base}/drafts", json={"shot_id": _shot_id(1), "status": "ok", "prompt": "甲"})
            client.post(f"{base}/drafts", json={"shot_id": _shot_id(2), "status": "failed", "error": "失败原因"})
            state = client.get(f"{base}/drafts").json()["data"]
        statuses = {item["shot_id"]: item["status"] for item in state["shots"]}
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert statuses == {_shot_id(1): "ok", _shot_id(2): "failed", _shot_id(3): "pending"}
    assert state["summary"] == {"total": 3, "ok": 1, "failed": 1, "running": 0, "pending": 1}
    # 顺序与集内镜头顺序一致（页面直接按这个顺序渲染）
    assert [item["code"] for item in state["shots"]] == ["S001", "S002", "S003"]


def test_dry_run_generation_still_writes_nothing(monkeypatch):
    """演练模式仍然**一个字节都不落库**：绝不把占位冒充成大模型产物。"""
    factory, engine = _build()
    _seed(factory, count=1)
    base = f"/api/v1/studio/prompt-board/{CHAPTER}"
    monkeypatch.setenv("JELLYFISH_DRY_RUN", "1")
    monkeypatch.delenv("JELLYFISH_REAL_LLM_CONFIRMED", raising=False)
    try:
        with _client(factory) as client:
            res = client.post(f"{base}/draft", json={"shot_id": _shot_id(1)}).json()["data"]
            assert res["status"] == "dry_run"
            state = client.get(f"{base}/drafts").json()["data"]
        prompt, _source = asyncio.run(_official_prompt(factory, _shot_id(1)))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert state["summary"]["pending"] == 1     # 草稿表里依然没有这一镜
    assert prompt == ""


@pytest.mark.asyncio
async def test_drafts_are_scoped_by_chapter():
    """键是 (chapter_id, shot_id)：另一集读不到、也清不掉本集的草稿。"""
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=1)
        db.add(Chapter(id="proj-1::EP02", project_id="proj-1", index=2, title="EP02", raw_text="x", condensed_text="x"))
        await db.flush()
        db.add(Shot(id="ep2-shot-1", chapter_id="proj-1::EP02", index=1, title="EP02镜头1", script_excerpt=""))
        await db.flush()
        await board.save_shot_draft(db, chapter_id=CHAPTER, shot_id=_shot_id(1), status="ok", prompt="EP01 的草稿")
        other = await board.load_draft_state(db, chapter_id="proj-1::EP02")
        cleared = await board.clear_chapter_drafts(db, chapter_id="proj-1::EP02")
        still_there = await drafts.get_row(db, chapter_id=CHAPTER, shot_id=_shot_id(1))
        cross_chapter_write = await board.save_shot_draft(
            db, chapter_id="proj-1::EP02", shot_id=_shot_id(1), status="ok", prompt="想跨集写"
        )
    finally:
        await engine.dispose()

    assert [item["status"] for item in other["shots"]] == ["pending"]
    assert cleared["cleared"] == 0
    assert still_there is not None and still_there.prompt == "EP01 的草稿"
    assert cross_chapter_write["draft"] is None  # 该镜头不属于 EP02 → 拒绝
