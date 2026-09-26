"""``/prompt-board/{chapter_id}/save`` 的**巨日禄脚本组范围**校验（页面真实保存路径）。

背景（用户点名的口径，2026-09-20）：
    页面最终保存走的就是 ``POST /api/v1/studio/prompt-board/{chapter_id}/save``，
    而该接口**曾经静默忽略**前端传入的 ``script_ids`` —— 于是"恰好一个 scriptId"的
    服务端校验只存在于 ``/jurilu-import/{pid}/apply``（页面保存根本不会调用它），
    真实保存路径上**没有任何**跨脚本组混写的后端保证。

现在 ``/save`` 正式接收**单数** ``script_id``，``origin=jurilu_import`` 时强制：
    1. 缺 ``script_id`` → 400；
    2. 多个 / 格式不合法（像多个）→ 400；
    3. 本批**每一条**的 ``script_id`` 必须与请求级一致 → 否则 400；
    4. 校验发生在**任何数据库写入之前**（本文件用 monkeypatch 证明 ``svc.save_entries``
       一次都没被调用，并对比调用前后 ``shot_details`` 的值证明 0 条写入）；
    5. 复数 ``script_ids`` **明确拒绝**（不是静默忽略），所有 origin 都拒。

全程不触网、不调用任何付费接口：只走 HTTP + 内存 SQLite。
"""

from __future__ import annotations

import asyncio
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app
from app.models.studio import Chapter, Project, Shot, ShotDetail
from app.services.studio import prompt_board as board

CHAPTER = "proj-1::EP01"
SCRIPT_A = "2933350"
SCRIPT_B = "2933351"
BASE = f"/api/v1/studio/prompt-board/{CHAPTER}/save"


# ---------------------------------------------------------------------------
# 脚手架：内存库 / 种子 / HTTP 客户端（与 test_prompt_board_drafts.py 同一套）
# ---------------------------------------------------------------------------


def _shot_id(index: int) -> str:
    return f"proj-1_EP01_SHOT_{index:03d}"


async def _create_all(engine) -> None:
    from app.core.db import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _build() -> tuple[async_sessionmaker[AsyncSession], object]:
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
    """TestClient + ``get_db`` 覆盖。

    **刻意不进 ``with``**：``TestClient(app)`` 作为上下文管理器会跑应用 lifespan，
    而 lifespan 里的 ``init_storage()`` 会对配置好的 S3/OSS 端点发一次 HeadBucket 探测
    ——那是**真实网络请求**。本文件只验证 `/save` 的校验与落库口径，一步都不需要它，
    所以这里不触发 lifespan（请求照发，行为与进上下文一致）。
    """
    app.dependency_overrides[get_db] = _override(factory)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


async def _seed_episode(db: AsyncSession, *, count: int = 3) -> None:
    db.add(Project(id="proj-1", name="测试项目", description="", style="真人都市", visual_style="现实"))
    await db.flush()
    db.add(
        Chapter(id=CHAPTER, project_id="proj-1", index=1, title="EP01", raw_text="文本", condensed_text="文本")
    )
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
        db.add(ShotDetail(id=shot_id, camera_shot="中景", angle="平视", movement="固定", video_prompt=""))
    # 必须提交：HTTP 用例里每个请求是一个新会话
    await db.commit()


def _seed(factory: async_sessionmaker[AsyncSession], *, count: int = 3) -> None:
    async def run() -> None:
        async with factory() as db:
            await _seed_episode(db, count=count)

    asyncio.run(run())


async def _official_columns(factory: async_sessionmaker[AsyncSession]) -> dict[str, tuple[str, str]]:
    """正式列快照：``{shot_id: (video_prompt, video_prompt_source)}``。"""
    async with factory() as db:
        rows = (await db.execute(select(ShotDetail))).scalars().all()
        return {str(row.id): (str(row.video_prompt or ""), str(row.video_prompt_source or "")) for row in rows}


def _entry(index: int, *, script_id: str | None, prompt: str | None = None) -> dict[str, str]:
    entry: dict[str, str] = {"shot_id": _shot_id(index), "prompt": prompt or f"第{index}镜提示词"}
    if script_id is not None:
        entry["script_id"] = script_id
    return entry


def _error_of(res) -> dict:
    assert res.status_code == 400, f"期望 400，实际 {res.status_code}：{res.text}"
    body = res.json()
    assert body["code"] == 400
    assert body["data"] is None
    error = body["meta"]["error"]
    assert error["code"] and error["message"]
    # 响应里**不得出现任何凭证**（这里只可能回显调用方自己传的脚本组 ID）
    text = res.text.lower()
    for forbidden in ("api_key", "apikey", "secret", "password", "bearer", "authorization", "cookie"):
        assert forbidden not in text, f"400 响应里出现了疑似凭证字段：{forbidden}"
    return error


# ---------------------------------------------------------------------------
# 1) 缺 script_id → 400 + 0 条写入
# ---------------------------------------------------------------------------


def test_jurilu_save_without_script_id_is_rejected_and_writes_nothing():
    factory, engine = _build()
    _seed(factory, count=2)
    before = asyncio.run(_official_columns(factory))
    try:
        with _client(factory) as client:
            res = client.post(
                BASE,
                json={
                    "entries": [_entry(1, script_id=None), _entry(2, script_id=None)],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "allow_partial": True,
                },
            )
            error = _error_of(res)
            after = asyncio.run(_official_columns(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert error["code"] == "missing_script_id"
    assert "script_id" in error["message"]
    assert "未写入任何数据" in error["message"]
    assert after == before                       # 0 条写入（正文与来源都没变）
    assert all(prompt == "" and source == "" for prompt, source in after.values())


def test_jurilu_save_with_empty_entries_still_validates_script_id():
    """空批不写库，但**照样**要校验 script_id 的存在（否则"空请求"成了绕过口）。"""
    factory, engine = _build()
    _seed(factory, count=1)
    try:
        with _client(factory) as client:
            missing = client.post(
                BASE,
                json={"entries": [], "mode": "fill_empty", "origin": "jurilu_import"},
            )
            error = _error_of(missing)
            # 同一形态下给了合法 script_id → 放行（空批：applied_count=0，但确实是 200）
            ok = client.post(
                BASE,
                json={
                    "entries": [],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "script_id": SCRIPT_A,
                },
            )
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert error["code"] == "missing_script_id"
    assert ok.status_code == 200, ok.text
    assert ok.json()["data"]["applied_count"] == 0
    assert ok.json()["data"]["script_id"] == SCRIPT_A


# ---------------------------------------------------------------------------
# 2) 复数 script_ids → **明确拒绝**（不是静默忽略）+ 0 条写入
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({"script_ids": [SCRIPT_A]}, id="单个复数写法"),
        pytest.param({"script_ids": [SCRIPT_A, SCRIPT_B]}, id="两个复数写法"),
        pytest.param({"script_ids": []}, id="空数组复数写法"),
        pytest.param({"script_ids": [SCRIPT_A], "script_id": SCRIPT_A}, id="复数与单数同时传"),
    ],
)
def test_deprecated_plural_script_ids_is_rejected_explicitly(payload):
    """复数写法一律 400（含"同时传单数"），绝不静默忽略。"""
    factory, engine = _build()
    _seed(factory, count=1)
    before = asyncio.run(_official_columns(factory))
    try:
        with _client(factory) as client:
            res = client.post(
                BASE,
                json={
                    "entries": [_entry(1, script_id=None)],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "allow_partial": True,
                    **payload,
                },
            )
            error = _error_of(res)
            after = asyncio.run(_official_columns(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert error["code"] == "script_ids_deprecated"
    assert "script_id" in error["message"]
    assert "未写入任何数据" in error["message"]
    assert after == before and all(prompt == "" for prompt, _source in after.values())


def test_plural_script_ids_is_rejected_for_every_origin():
    """所有 origin 都拒绝复数写法：避免前端以为"后端已经按恰好一组校验过了"。"""
    factory, engine = _build()
    _seed(factory, count=1)
    try:
        with _client(factory) as client:
            for origin in ("llm_draft", "jurilu_import", "external_import", "manual"):
                res = client.post(
                    BASE,
                    json={
                        "entries": [_entry(1, script_id=None)],
                        "mode": "fill_empty",
                        "origin": origin,
                        "allow_partial": True,
                        "script_ids": [SCRIPT_A],
                    },
                )
                assert _error_of(res)["code"] == "script_ids_deprecated", origin
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


# ---------------------------------------------------------------------------
# 3) 格式不合法 / 像多个 → 400 + 0 条写入
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_script_id",
    [
        f"{SCRIPT_A},{SCRIPT_B}",          # 逗号拼多个
        f"{SCRIPT_A} {SCRIPT_B}",          # 空格拼多个
        f"{SCRIPT_A};{SCRIPT_B}",          # 分号拼多个
        f'["{SCRIPT_A}"]',                 # JSON 数组字符串
        f"'{SCRIPT_A}'",                   # 引号包裹
        f"[{SCRIPT_A}]",                   # 方括号包裹
        "x" * 65,                          # 超长（>64）
        "组A",                             # 非 [A-Za-z0-9_-] 字符
        "2933350\n2933351",                # 换行拼接
    ],
)
def test_invalid_or_multi_script_id_is_rejected(bad_script_id):
    factory, engine = _build()
    _seed(factory, count=1)
    before = asyncio.run(_official_columns(factory))
    try:
        with _client(factory) as client:
            res = client.post(
                BASE,
                json={
                    # 条目也带上同一个非法值：证明**请求级**校验先拦下（而不是靠条目比对）
                    "entries": [_entry(1, script_id=bad_script_id)],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "allow_partial": True,
                    "script_id": bad_script_id,
                },
            )
            error = _error_of(res)
            after = asyncio.run(_official_columns(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert error["code"] == "invalid_script_id"
    assert "[A-Za-z0-9_-]" in error["message"]
    assert "未写入任何数据" in error["message"]
    assert after == before and all(prompt == "" for prompt, _source in after.values())


def test_script_id_length_boundaries_are_accepted():
    """边界：1 与 64 字符合法，65 字符非法（口径写死，不含"差不多就行"）。"""
    factory, engine = _build()
    _seed(factory, count=3)
    try:
        with _client(factory) as client:
            for index, good in enumerate(("a", "A" * 64, "2933350-1_2"), start=1):
                res = client.post(
                    BASE,
                    json={
                        "entries": [_entry(index, script_id=good)],
                        "mode": "fill_empty",
                        "origin": "jurilu_import",
                        "allow_partial": True,
                        "script_id": good,
                    },
                )
                assert res.status_code == 200, res.text
                assert res.json()["data"]["applied_count"] == 1
                assert res.json()["data"]["script_id"] == good
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


# ---------------------------------------------------------------------------
# 4) 条目与请求级 script_id 不一致 / 条目缺 script_id → 400 + 0 条写入
# ---------------------------------------------------------------------------


def test_entry_script_mismatch_is_rejected_with_position_and_ids():
    factory, engine = _build()
    _seed(factory, count=3)
    before = asyncio.run(_official_columns(factory))
    try:
        with _client(factory) as client:
            res = client.post(
                BASE,
                json={
                    "entries": [
                        _entry(1, script_id=SCRIPT_A),
                        _entry(2, script_id=SCRIPT_B),   # ← 第 2 条属于另一组
                        _entry(3, script_id=SCRIPT_A),
                    ],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "script_id": SCRIPT_A,
                },
            )
            error = _error_of(res)
            after = asyncio.run(_official_columns(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert error["code"] == "entry_script_mismatch"
    assert error["position"] == 2
    assert error["entry_script_id"] == SCRIPT_B
    assert error["script_id"] == SCRIPT_A
    assert "第 2 条" in error["message"]       # 1 基下标，用户能直接定位
    assert SCRIPT_B in error["message"] and SCRIPT_A in error["message"]
    assert after == before and all(prompt == "" for prompt, _source in after.values())


def test_entry_missing_script_id_is_rejected():
    factory, engine = _build()
    _seed(factory, count=2)
    before = asyncio.run(_official_columns(factory))
    try:
        with _client(factory) as client:
            res = client.post(
                BASE,
                json={
                    "entries": [_entry(1, script_id=SCRIPT_A), _entry(2, script_id=None)],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "script_id": SCRIPT_A,
                },
            )
            error = _error_of(res)
            after = asyncio.run(_official_columns(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert error["code"] == "entry_missing_script_id"
    assert error["position"] == 2
    assert "第 2 条" in error["message"] and "未写入任何数据" in error["message"]
    assert after == before and all(prompt == "" for prompt, _source in after.values())


def test_entry_with_only_whitespace_script_id_is_treated_as_missing():
    """只有空白字符不算"带了 script_id"。"""
    factory, engine = _build()
    _seed(factory, count=1)
    try:
        with _client(factory) as client:
            res = client.post(
                BASE,
                json={
                    "entries": [_entry(1, script_id="   ")],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "script_id": SCRIPT_A,
                },
            )
            error = _error_of(res)
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert error["code"] == "entry_missing_script_id"


# ---------------------------------------------------------------------------
# 5) 单一合法 script_id + 每条一致 → 正常保存
# ---------------------------------------------------------------------------


def test_single_valid_script_id_saves_all_entries_with_jurilu_source():
    factory, engine = _build()
    _seed(factory, count=3)
    try:
        with _client(factory) as client:
            res = client.post(
                BASE,
                json={
                    "entries": [_entry(index, script_id=SCRIPT_A) for index in (1, 2, 3)],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "script_id": SCRIPT_A,
                },
            )
            assert res.status_code == 200, res.text
            data = res.json()["data"]
            columns = asyncio.run(_official_columns(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert data["applied_count"] == 3
    assert data["skipped_count"] == 0
    assert data["source"] == "jurilu"
    assert data["script_id"] == SCRIPT_A          # 审计回显（单数）
    assert len(data["results"]) == 3
    assert "cleared_draft_count" in data and "results" in data and "applied_count" in data
    assert all(row["applied"] for row in data["results"])
    for index in (1, 2, 3):
        assert columns[_shot_id(index)] == (f"第{index}镜提示词", "jurilu")


def test_script_id_whitespace_is_normalized_on_success():
    """请求级去掉首尾空白后再比对与回显（``" 2933350 "`` 与条目 ``"2933350"`` 一致）。"""
    factory, engine = _build()
    _seed(factory, count=1)
    try:
        with _client(factory) as client:
            res = client.post(
                BASE,
                json={
                    "entries": [_entry(1, script_id=SCRIPT_A)],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "script_id": f"  {SCRIPT_A}  ",
                },
            )
            assert res.status_code == 200, res.text
            data = res.json()["data"]
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert data["applied_count"] == 1
    assert data["script_id"] == SCRIPT_A


# ---------------------------------------------------------------------------
# 6) 校验失败时事务无部分写入；且 **svc.save_entries 一次都没被调用**
# ---------------------------------------------------------------------------


def test_validation_runs_before_any_write_and_never_reaches_service(monkeypatch):
    """「校验在任何写入之前」的证明：第 2 条不一致的两条批次 → 库 0 条写入 + 服务层未被调用。"""
    calls: list[dict] = []

    async def _spy(db, **kwargs):  # noqa: ANN001, ARG001 - 对齐真实签名，只为记录调用
        calls.append(kwargs)
        return {"chapter_id": CHAPTER, "applied_count": 999, "skipped_count": 0, "results": []}

    monkeypatch.setattr(board, "save_entries", _spy)

    factory, engine = _build()
    _seed(factory, count=2)
    before = asyncio.run(_official_columns(factory))
    try:
        with _client(factory) as client:
            res = client.post(
                BASE,
                json={
                    "entries": [_entry(1, script_id=SCRIPT_A), _entry(2, script_id=SCRIPT_B)],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "script_id": SCRIPT_A,
                },
            )
            assert res.status_code == 400
            assert res.json()["meta"]["error"]["code"] == "entry_script_mismatch"
            # 通过服务层的入口也被堵住：即使整批合法，校验过后才会走到它
            after = asyncio.run(_official_columns(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert calls == []                       # ← 关键：服务层一次都没被调用 = 没有任何写入路径被打开
    assert after == before                   # 库里 0 条被写（没有"先写第 1 条再报错"）
    assert all(prompt == "" and source == "" for prompt, source in after.values())


def test_accepted_request_does_reach_service_and_commits(monkeypatch):
    """对照组：校验通过时服务层**确实**被调用（否则上面的"没被调用"可能只是整体短路）。"""
    calls: list[dict] = []
    original = board.save_entries

    async def _spy(db, **kwargs):  # noqa: ANN001
        calls.append(kwargs)
        return await original(db, **kwargs)

    monkeypatch.setattr(board, "save_entries", _spy)

    factory, engine = _build()
    _seed(factory, count=1)
    try:
        with _client(factory) as client:
            res = client.post(
                BASE,
                json={
                    "entries": [_entry(1, script_id=SCRIPT_A)],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "script_id": SCRIPT_A,
                },
            )
            assert res.status_code == 200, res.text
            columns = asyncio.run(_official_columns(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert len(calls) == 1
    assert calls[0]["origin"] == "jurilu_import"
    assert columns[_shot_id(1)][1] == "jurilu"


# ---------------------------------------------------------------------------
# 7) 其它来源不受影响（不带 script_id 照常保存）
# ---------------------------------------------------------------------------


def test_manual_and_external_origins_are_unaffected_without_script_id():
    factory, engine = _build()
    _seed(factory, count=2)
    try:
        with _client(factory) as client:
            manual = client.post(
                BASE,
                json={
                    "entries": [_entry(1, script_id=None, prompt="人工写的第1条")],
                    "mode": "fill_empty",
                    "origin": "manual",
                    "allow_partial": True,
                },
            )
            assert manual.status_code == 200, manual.text
            external = client.post(
                BASE,
                json={
                    "entries": [_entry(2, script_id=None, prompt="外部平台第2条")],
                    "mode": "fill_empty",
                    "origin": "external_import",
                    "allow_partial": True,
                },
            )
            assert external.status_code == 200, external.text
            columns = asyncio.run(_official_columns(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert manual.json()["data"]["applied_count"] == 1
    assert manual.json()["data"]["script_id"] == ""      # 非巨日禄：回显空串
    assert external.json()["data"]["applied_count"] == 1
    assert columns[_shot_id(1)] == ("人工写的第1条", "manual")
    assert columns[_shot_id(2)] == ("外部平台第2条", "external_import")


def test_llm_draft_origin_still_works_with_backend_token():
    """``llm_draft`` 不带 script_id 照常保存（令牌仍是唯一的自证口径）。"""
    factory, engine = _build()
    _seed(factory, count=1)
    prompt = "模型生成的正文"
    token = board.draft_token(shot_id=_shot_id(1), prompt=prompt)
    try:
        with _client(factory) as client:
            res = client.post(
                BASE,
                json={
                    "entries": [
                        {"shot_id": _shot_id(1), "prompt": prompt, "draft_token": token},
                    ],
                    "mode": "fill_empty",
                    "origin": "llm_draft",
                    "allow_partial": True,
                },
            )
            assert res.status_code == 200, res.text
            data = res.json()["data"]
            columns = asyncio.run(_official_columns(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert data["applied_count"] == 1
    assert data["source"] == "llm"
    assert columns[_shot_id(1)] == (prompt, "llm")


def test_jurilu_import_with_script_id_still_keeps_count_mismatch_gate():
    """既有口径不得被破坏：数量不一致默认仍拒绝整体保存（script_id 不参与这条判定）。"""
    factory, engine = _build()
    _seed(factory, count=3)
    try:
        with _client(factory) as client:
            blocked = client.post(
                BASE,
                json={
                    "entries": [_entry(1, script_id=SCRIPT_A)],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "script_id": SCRIPT_A,
                },
            )
            assert blocked.status_code == 200, blocked.text
            data = blocked.json()["data"]
            allowed = client.post(
                BASE,
                json={
                    "entries": [_entry(1, script_id=SCRIPT_A)],
                    "mode": "fill_empty",
                    "origin": "jurilu_import",
                    "script_id": SCRIPT_A,
                    "allow_partial": True,
                },
            )
            assert allowed.status_code == 200, allowed.text
            allowed_data = allowed.json()["data"]
            columns = asyncio.run(_official_columns(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert data["applied_count"] == 0 and "数量不一致" in data["error"]
    assert data["script_id"] == SCRIPT_A             # 被拒时也回显本次声明的脚本组
    assert allowed_data["applied_count"] == 1
    assert columns[_shot_id(1)][1] == "jurilu"
