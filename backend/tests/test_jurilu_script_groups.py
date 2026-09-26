"""巨日禄「一次抓到的多个 scriptId = 多个脚本组」契约测试（单数选择版）。

用户口径（2026-09-20 / 2026-09-21，真实验收）：
    巨日禄「获取整集提示词」一次抓到的三个 scriptId 是**三个不同的脚本**
    （或同一脚本的不同版本），第二步共返回 109 条分镜（41 / 37 / 31）。
    **不要因为接口共返回 109 条，就把 109 条当成同一集的连续镜头。**
    没有可靠时间证据时不要标记「最新版本」，只能陈述客观信息。

本文件钉住九件事：
1. 三个 scriptId → **三个脚本组**，条数 / 序号范围只用**该组已解析出来的分镜**算；
2. **默认不跨 scriptId 合并**：``script_ids`` 空 → ``rows=[]``、``entry_count=0``、
   ``requires_script_selection=true``、空计划、``plan_summary=""``，但仍返回 ``script_groups``；
3. **恰好一个**才允许匹配：传 2 个及以上 → 400；apply 没有选组 → 400；
   被拒绝时**连上游都不碰**、库里一条都不写；
4. **整组导入不截断**：一组超过一页时必须翻页取全，并给出 ``pages_fetched`` 证据；
5. 统一预览每行带：脚本组 / 巨日禄序号 / 镜头编号 / 镜头内容 / 待写入提示词 / 匹配状态与原因；
6. 匹配**编号优先**（seq == 镜头 index），**顺序兜底**；
7. 复用既有 ``create_missing`` 能力，镜头不足时给出 ``missing_shot_count``；
8. 版本判断：**只有真实可比时间戳**才允许 ``likely_newest=true``；无时间戳只陈述客观事实；
9. 凭证与正文不进 ``raw_keys`` / 诊断，整条链路不碰 LLM / 出图 / 视频出口。

全程零真实网络：``urllib.request.urlopen`` 一律 monkeypatch 成桩。
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
import struct
from contextlib import contextmanager
from typing import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.pool import NullPool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.studio import Chapter, Project, Shot, ShotDetail
from app.models.task import GenerationTask
from app.services import paid_outlet_guard as guard
from app.services.external import jurilu_agent_import as jurilu
from app.services.external import jurilu_import_plan as planner
from app.services.external import jurilu_import_service as svc
from app.services.studio.llm_orchestration import dry_run

COOKIE = "Authorization=abc.def.ghi; ph_phc_demo=1"
URL = (
    "https://video.jurilu.com/project_management/project_page/snippets/material_list"
    "?projectId=163260&clipId=3277394"
)
PROJECT = "proj-jurilu"
CHAPTER = "proj-jurilu::EP01"

# 真实形状：三个 scriptId，第二步 41 / 37 / 31 条（6083 与 3351 是同一脚本的两个版本）
SID_NEW = "2936083"
SID_OLD = "2933351"
SID_OTHER = "2933350"
STANDARD_COUNTS = {SID_NEW: 41, SID_OLD: 37, SID_OTHER: 31}

SHARED_TAG = "【同一脚本共用正文】"
OTHER_TAG = "【另一集正文】"
# 放在正文 60 字之后的标记：用来证明「整段正文没有被打进响应」
TAIL_MARK = "【正文尾部标记：不该出现在脚本组里】"

_PAGE_RE = re.compile(r"getStoryboardPage/(\d+)/(\d+)")


# ---------------------------------------------------------------------------
# 最小 msgpack 编码器（环境没有 msgpack）+ 假上游（支持翻页）
# ---------------------------------------------------------------------------


def _enc(obj) -> bytes:  # noqa: ANN001, C901
    if obj is None:
        return b"\xc0"
    if isinstance(obj, bool):
        return b"\xc3" if obj else b"\xc2"
    if isinstance(obj, int):
        if 0 <= obj <= 0x7F:
            return bytes([obj])
        if 0 <= obj <= 0xFFFF:
            return b"\xcd" + obj.to_bytes(2, "big")
        return b"\xce" + obj.to_bytes(4, "big")
    if isinstance(obj, str):
        raw = obj.encode("utf-8")
        if len(raw) <= 31:
            return bytes([0xA0 | len(raw)]) + raw
        if len(raw) <= 0xFF:
            return b"\xd9" + bytes([len(raw)]) + raw
        return b"\xda" + len(raw).to_bytes(2, "big") + raw
    if isinstance(obj, list):
        if len(obj) <= 15:
            return bytes([0x90 | len(obj)]) + b"".join(_enc(v) for v in obj)
        return b"\xdc" + len(obj).to_bytes(2, "big") + b"".join(_enc(v) for v in obj)
    if isinstance(obj, dict):
        head = bytes([0x80 | len(obj)]) if len(obj) <= 15 else b"\xde" + len(obj).to_bytes(2, "big")
        return head + b"".join(_enc(k) + _enc(v) for k, v in obj.items())
    raise TypeError(f"编码器不支持 {type(obj)}")


def _envelope(payload) -> str:  # noqa: ANN001
    encoded = base64.b64encode(_enc(payload)).decode()
    return json.dumps(
        {"code": 0, "message": "success", "data": {"enc": "msgpack", "payload": encoded}},
        ensure_ascii=False,
    )


def _shot(sid: str, seq: int, tag: str) -> dict:
    """一条真实形状的分镜记录（字段名用上游真实的 prompt / description / sbid / seqNum）。"""
    body = f"{tag}第{seq}镜：" + "提示词正文" * 20 + TAIL_MARK
    return {
        "id": 113315300 + seq,
        "scriptId": sid,
        "sbid": f"S{seq}",
        "seqNum": seq,
        "description": f"{tag}第{seq}个分镜的摘要描述",
        "prompt": body,
        "modelName": "seedance-2.0-mini",
        "duration": 5,
        "aspectRatio": "16:9",
        "cookie": "凭证不该出现在任何诊断里",
    }


def _records_for(sid: str, counts: dict) -> list[dict]:
    tag = OTHER_TAG if sid == SID_OTHER else SHARED_TAG
    return [_shot(sid, n, tag) for n in range(1, counts[sid] + 1)]


def _scripts_page() -> str:
    """第一步 getScriptPage：字段名故意各不相同，验证多候选兜底 + 命中字段名回报。"""
    return json.dumps({"code": 0, "data": {"records": [
        {
            "id": 2936083,
            "title": "第1集",
            "createdAt": "2026-09-19 10:00:00",
            "updateTime": "2026-09-19 10:20:00",
            "projectId": 163260,
            "Authorization": "凭证字段名也不该进 raw_keys",
        },
        {
            "scriptId": "2933351",
            "scriptName": "第 1 集",
            "createTime": "2026-09-18 09:00:00",
            "cookie": "凭证不该出现在 raw_keys",
        },
        {"id": "2933350", "name": "第2集"},
    ]}}, ensure_ascii=False)


class _Resp:
    status = 200

    def __init__(self, body: str) -> None:
        self._body = body.encode("utf-8")
        self.headers = type(
            "H", (), {"get": staticmethod(lambda *a, **k: "application/json")}
        )()

    def read(self) -> bytes:
        return self._body

    def __enter__(self):  # noqa: ANN204
        return self

    def __exit__(self, *args):  # noqa: ANN002, ANN204
        return False


def _install_upstream(
    monkeypatch,  # noqa: ANN001
    counts: dict | None = None,
    *,
    with_total: bool = True,
    ignore_paging: bool = False,
) -> list[dict]:
    """把两步接口都换成桩：**一次真实请求都不发**。

    Args:
        counts: 每个 scriptId 有多少条分镜（默认 41/37/31）。
        with_total: 响应里是否自报 ``total``。
        ignore_paging: 故意无视 page 参数（每次都返回同一页），用来验证不会死循环。
    """
    counts = counts or STANDARD_COUNTS
    seen: list[dict] = []

    def fake_urlopen(request, timeout=None):  # noqa: ANN001, ANN202
        url = request.full_url
        if "getScriptPage" in url:
            seen.append({"url": url, "method": request.get_method(), "script_id": ""})
            return _Resp(_scripts_page())
        match = _PAGE_RE.search(url)
        page, size = (int(match.group(1)), int(match.group(2))) if match else (1, 100)
        script_id = str(json.loads(request.data.decode("utf-8"))["scriptId"])
        seen.append({"url": url, "method": request.get_method(), "script_id": script_id,
                     "page": page, "size": size})
        if script_id not in counts:
            return _Resp(_envelope({"records": []}))
        records = _records_for(script_id, counts)
        if ignore_paging:
            page = 1
        chunk = records[(page - 1) * size: page * size]
        payload: dict = {"records": chunk}
        if with_total:
            payload["total"] = len(records)
        return _Resp(_envelope(payload))

    monkeypatch.setattr(jurilu.urllib.request, "urlopen", fake_urlopen)
    return seen


def _install_forbidden_network(monkeypatch) -> None:  # noqa: ANN001
    """任何出网尝试都直接失败 —— 用来证明「被拒绝的请求连上游都不碰」。"""

    def boom(request, timeout=None):  # noqa: ANN001, ANN202
        raise AssertionError(f"不该发起任何请求：{request.full_url}")

    monkeypatch.setattr(jurilu.urllib.request, "urlopen", boom)


# ---------------------------------------------------------------------------
# 内存库 + TestClient（每个请求一个新会话）
# ---------------------------------------------------------------------------


async def _create_all(engine) -> None:  # noqa: ANN001
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _build_factory(tmp_path) -> tuple[async_sessionmaker[AsyncSession], object]:  # noqa: ANN001
    """一个用例一个**文件**库 + ``NullPool``。

    为什么不用 ``:memory:``：内存库会被 SQLAlchemy 固定成 StaticPool（一个连接被所有
    事件循环共用），TestClient 的循环和历史 ``asyncio.run`` 的循环会互相踩，
    跑完留下一堆 "Event loop is closed" 的线程告警。文件库 + NullPool 每个会话
    各自开关连接，干净且互不干扰。
    """
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path}/jurilu_groups.db", future=True, poolclass=NullPool,
    )
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    asyncio.run(_create_all(engine))
    return factory, engine


@pytest.fixture
def db_factory(tmp_path):  # noqa: ANN001, ANN201
    """测试库工厂：用完把引擎关掉（不给线程留尾巴）。"""
    factory, engine = _build_factory(tmp_path)
    try:
        yield factory
    finally:
        asyncio.run(engine.dispose())


async def _seed(db: AsyncSession, *, shot_count: int = 0, shot_indexes: list[int] | None = None) -> None:
    db.add(Project(id=PROJECT, name="巨日禄测试项目", description="", style="真人都市",
                   visual_style="现实"))
    await db.flush()
    db.add(Chapter(id=CHAPTER, project_id=PROJECT, index=1, title="第1集",
                   summary="", raw_text="", condensed_text=""))
    await db.flush()
    indexes = shot_indexes if shot_indexes is not None else list(range(1, shot_count + 1))
    for index in indexes:
        shot_id = f"{CHAPTER}_SHOT_{index:03d}"
        db.add(Shot(id=shot_id, chapter_id=CHAPTER, index=index, title=f"镜头{index}"))
        db.add(ShotDetail(id=shot_id, camera_shot="中景", angle="平视", movement="固定",
                          video_prompt=""))
    await db.commit()


def _seed_sync(
    factory: async_sessionmaker[AsyncSession],
    *,
    shot_count: int = 0,
    shot_indexes: list[int] | None = None,
) -> None:
    async def run() -> None:
        async with factory() as db:
            await _seed(db, shot_count=shot_count, shot_indexes=shot_indexes)

    asyncio.run(run())


@contextmanager
def _client(factory: async_sessionmaker[AsyncSession]) -> Iterator[TestClient]:
    """TestClient + ``get_db`` 覆盖（每个请求一个新会话）。

    **刻意不用 ``with TestClient(...)``**：那会触发 lifespan 里的存储初始化，
    进程会真的去打一次对象存储的 HeadBucket —— 本文件要求零真实网络请求。
    """

    async def override_db():  # noqa: ANN202
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def _payload(**overrides) -> dict:  # noqa: ANN003
    body = {
        "chapter_id": CHAPTER,
        "url": URL,
        "cookie": COOKIE,
        "auth_mode": "none",
        "script_ids": [],
    }
    body.update(overrides)
    return body


def _fetch(script_ids: list[str]) -> dict:
    return svc.fetch_entries(url=URL, cookie=COOKIE, auth_mode="none", script_ids=script_ids)


def _preview(factory, **kwargs) -> dict:  # noqa: ANN001, ANN003
    """在内存库上跑一次 build_preview（一个事件循环里完成）。"""

    async def run() -> dict:
        async with factory() as db:
            return await svc.build_preview(
                db, chapter_id=CHAPTER, url=URL, cookie=COOKIE, auth_mode="none", **kwargs,
            )

    return asyncio.run(run())


async def _fetch_prompts(factory) -> list[tuple[str, str]]:  # noqa: ANN001
    async with factory() as db:
        rows = await db.execute(
            select(ShotDetail.video_prompt, ShotDetail.video_prompt_source)
            .join(Shot, Shot.id == ShotDetail.id)
            .where(Shot.chapter_id == CHAPTER)
        )
        return [(row[0] or "", row[1] or "") for row in rows.all()]


async def _count_rows(factory, model) -> int:  # noqa: ANN001
    async with factory() as db:
        rows = await db.execute(select(func.count()).select_from(model))
        return int(rows.scalar_one())


# ---------------------------------------------------------------------------
# 1. 分组 + 整组取全（不截断）
# ---------------------------------------------------------------------------


def test_three_script_ids_become_three_groups(monkeypatch) -> None:
    """三个 scriptId → 三组；条数与序号范围来自**该组已解析出来的分镜**。"""
    _install_upstream(monkeypatch)
    fetched = _fetch([])
    groups = fetched["script_groups"]
    assert [g["script_id"] for g in groups] == [SID_NEW, SID_OLD, SID_OTHER]

    by_id = {g["script_id"]: g for g in groups}
    assert (by_id[SID_NEW]["record_count"],
            by_id[SID_OLD]["record_count"],
            by_id[SID_OTHER]["record_count"]) == (41, 37, 31)
    assert (by_id[SID_NEW]["seq_min"], by_id[SID_NEW]["seq_max"]) == ("1", "41")
    assert (by_id[SID_OLD]["seq_min"], by_id[SID_OLD]["seq_max"]) == ("1", "37")
    assert (by_id[SID_OTHER]["seq_min"], by_id[SID_OTHER]["seq_max"]) == ("1", "31")
    assert all(g["seq_field"] == "seqNum" for g in groups)
    # 109 条是**三组之和**，不是同一集的连续镜头
    assert sum(g["record_count"] for g in groups) == 109
    assert len(fetched["entries"]) == 0, "没选组：一条都不该进匹配"
    # 每组都自报翻了 1 页（真实三组一页就取全），这是「没截断」的证据
    assert [g["pages_fetched"] for g in groups] == [1, 1, 1]


def test_group_metadata_reports_hit_field_names(monkeypatch) -> None:
    """标题 / 时间字段名未知 → 多候选兜底，并把**实际命中的字段名**报出来。"""
    _install_upstream(monkeypatch)
    by_id = {g["script_id"]: g for g in _fetch([])["script_groups"]}
    assert (by_id[SID_NEW]["title"], by_id[SID_NEW]["title_source"]) == ("第1集", "title")
    assert (by_id[SID_OLD]["title"], by_id[SID_OLD]["title_source"]) == ("第 1 集", "scriptName")
    assert (by_id[SID_OTHER]["title"], by_id[SID_OTHER]["title_source"]) == ("第2集", "name")
    assert by_id[SID_NEW]["created_at"] == "2026-09-19 10:00:00"
    assert by_id[SID_NEW]["updated_at"] == "2026-09-19 10:20:00"
    # 取不到就留空，绝不编造时间
    assert by_id[SID_OTHER]["created_at"] == ""
    assert by_id[SID_OTHER]["updated_at"] == ""


def test_sample_records_are_capped_but_records_are_not(monkeypatch) -> None:
    """采样最多 3 条（只是给人看的），但 ``record_count`` 仍是**全量** 41 条。"""
    _install_upstream(monkeypatch)
    group = _fetch([])["script_groups"][0]
    assert len(group["sample_records"]) == 3
    assert group["record_count"] == 41, "采样截断不能变成数据截断"
    first = group["sample_records"][0]
    assert first["seq"] == "1" and first["sbid"] == "S1"
    assert len(first["prompt_head"]) == 60
    assert first["prompt_length"] > 60


def test_group_without_first_step_record_is_still_listed() -> None:
    """第一步没列出来、但第二步有分镜的 scriptId 也要成组（不丢数据）。"""
    groups = jurilu.build_script_groups(
        [{"id": "1", "title": "第1集"}],
        [
            {"source_script_id": "1", "seqNum": "1", "sbid": "S1", "prompt_text": "甲"},
            {"source_script_id": "9", "seqNum": "2", "sbid": "S2", "prompt_text": "乙",
             "source_script_title": "第9集"},
        ],
    )
    assert [g["script_id"] for g in groups] == ["1", "9"]
    assert groups[1]["record_count"] == 1
    assert groups[1]["title"] == "第9集"
    assert groups[1]["title_source"] == "", "标题来自兜底就不能谎报命中字段"


def test_large_group_is_fetched_page_by_page(monkeypatch) -> None:
    """一组 250 条（> 一页 100）必须翻 3 页取全，**一条不丢**。"""
    counts = {SID_NEW: 250, SID_OLD: 37, SID_OTHER: 31}
    seen = _install_upstream(monkeypatch, counts)
    fetched = _fetch([SID_NEW])

    by_id = {g["script_id"]: g for g in fetched["script_groups"]}
    assert by_id[SID_NEW]["record_count"] == 250
    assert by_id[SID_NEW]["seq_min"] == "1" and by_id[SID_NEW]["seq_max"] == "250"
    assert by_id[SID_NEW]["pages_fetched"] == 3, "250 条 / 每页 100 → 3 页"
    assert by_id[SID_OLD]["pages_fetched"] == 1, "37 条一页就取全"
    assert len(fetched["entries"]) == 250, "整组进匹配，不做任何截断"
    pages = [item["page"] for item in seen if item["script_id"] == SID_NEW]
    assert pages == [1, 2, 3], "必须逐页取全，不能只取第一页"
    assert fetched["diagnostics"]["storyboard_pages_by_script"][SID_NEW] == 3
    assert fetched["diagnostics"]["storyboard_totals_by_script"][SID_NEW] == 250


def test_paging_stops_on_short_page_without_total(monkeypatch) -> None:
    """接口不自报 total 时，靠「短页 = 最后一页」收尾（5 条 / 每页 2 → 3 页）。"""
    def fake_urlopen(request, timeout=None):  # noqa: ANN001, ANN202
        if "getScriptPage" in request.full_url:
            return _Resp(json.dumps({"code": 0, "data": {"records": [{"id": 111}]}}))
        match = _PAGE_RE.search(request.full_url)
        page, size = int(match.group(1)), int(match.group(2))
        records = [{"id": n, "scriptId": "111", "sbid": f"S{n}", "seqNum": n,
                    "prompt": f"提示词{n}"} for n in range(1, 6)]
        return _Resp(_envelope({"records": records[(page - 1) * size: page * size]}))

    monkeypatch.setattr(jurilu.urllib.request, "urlopen", fake_urlopen)
    result = jurilu.fetch_all_storyboards(
        source_url=URL, cookie_text=COOKIE, authorization="", referer="", storyboard_size=2,
    )
    assert [record["seqNum"] for record in result["storyboards"]] == ["1", "2", "3", "4", "5"]
    assert result["storyboard_pages"] == {"111": 3}
    assert result["storyboards"][0]["agent_name"] == "EP01｜分镜 S1"


def test_paging_does_not_loop_when_server_ignores_page(monkeypatch) -> None:
    """接口无视 page 参数时不能死循环：检测到「本页没有新记录」就停下并告警。"""
    _install_upstream(monkeypatch, ignore_paging=True)
    result = jurilu.fetch_all_storyboards(
        source_url=URL, cookie_text=COOKIE, authorization="", referer="", storyboard_size=5,
    )
    counts = result["diagnostics"]["parsed_prompts_count_by_script"]
    assert counts[SID_NEW] == 5, "重复页不能被重复计数"
    assert result["storyboard_pages"][SID_NEW] == 2, "第 2 页发现全是重复就停"
    assert any("没有新增记录" in warning for warning in result["warnings"])


def test_non_numeric_script_id_does_not_crash_the_chain(monkeypatch) -> None:
    """scriptId 不是数字时只是取不到分镜 + 留一条告警，不能把整条链路炸成 500。"""
    def fake_urlopen(request, timeout=None):  # noqa: ANN001, ANN202
        if "getScriptPage" in request.full_url:
            return _Resp(json.dumps({"code": 0, "data": {"records": [{"id": "SC-1"}]}}))
        raise AssertionError("不该发分镜请求：scriptId 拼不出 URL")

    monkeypatch.setattr(jurilu.urllib.request, "urlopen", fake_urlopen)
    result = jurilu.fetch_all_storyboards(
        source_url=URL, cookie_text=COOKIE, authorization="", referer="",
    )
    assert result["ok"] is False
    assert any("无法构造分镜请求" in warning for warning in result["warnings"])


def test_plan_rows_cover_the_whole_group(monkeypatch, db_factory) -> None:
    """整组 31 条 → 计划 31 行（不漏、不截断），每行都能落到一个镜头。"""
    factory = db_factory
    _seed_sync(factory)
    _install_upstream(monkeypatch)
    preview = _preview(factory, script_ids=[SID_OTHER])
    assert preview["entry_count"] == 31
    assert len(preview["plan"]["rows"]) == 31
    assert preview["plan"]["counts"] == {planner.ACTION_CREATE: 31}
    assert [row["seq"] for row in preview["plan"]["rows"]] == list(range(1, 32))
    assert all(row["matched_by"] == planner.MATCHED_BY_CREATED for row in preview["plan"]["rows"])


# ---------------------------------------------------------------------------
# 2. 单数语义：未选 / 恰好一个 / 多个
# ---------------------------------------------------------------------------


def test_no_selection_returns_groups_only(monkeypatch, db_factory) -> None:
    """``script_ids`` 空 → 空计划 + requires_script_selection，但仍返回三组。"""
    factory = db_factory
    _seed_sync(factory)
    _install_upstream(monkeypatch)
    preview = _preview(factory, script_ids=[])
    assert preview["requires_script_selection"] is True
    assert preview["plan"]["rows"] == []
    assert preview["plan"]["counts"] == {}
    assert preview["entry_count"] == 0
    assert preview["plan_summary"] == ""
    assert preview["missing_shot_count"] == 0
    assert preview["selected_script_ids"] == []
    assert preview["selected_script_id"] == ""
    assert len(preview["script_groups"]) == 3
    assert preview["note"] == svc.NO_MERGE_NOTE


def test_exactly_one_selection_is_allowed(monkeypatch, db_factory) -> None:
    """恰好一个 → 允许进入匹配，并给出单数字段方便前端直接用。"""
    factory = db_factory
    _seed_sync(factory, shot_count=50)
    _install_upstream(monkeypatch)
    preview = _preview(factory, script_ids=[SID_NEW], overwrite=True)
    assert preview["requires_script_selection"] is False
    assert preview["selected_script_ids"] == [SID_NEW]
    assert preview["selected_script_id"] == SID_NEW
    assert preview["entry_count"] == 41
    assert len(preview["plan"]["rows"]) == 41
    assert all(row["source"] == "jurilu" for row in preview["plan"]["rows"])
    assert all(row["script_id"] == SID_NEW for row in preview["plan"]["rows"])
    assert "一次只能导入一个脚本组" in preview["note"]
    assert "不截断" in preview["note"]
    assert "未选中的脚本组不参与" in preview["note"]


def test_duplicate_same_id_is_not_treated_as_two_groups(monkeypatch, db_factory) -> None:
    """同一个 scriptId 传两遍不算「选了多组」（去重后仍是恰好一个）。"""
    factory = db_factory
    _seed_sync(factory, shot_count=50)
    _install_upstream(monkeypatch)
    preview = _preview(factory, script_ids=[SID_NEW, SID_NEW])
    assert preview["selected_script_ids"] == [SID_NEW]
    assert preview["entry_count"] == 41


def test_multiple_selections_rejected_by_service(monkeypatch) -> None:
    """服务层也拦「一次选多组」（脚本/任务直接调用 build_preview 时同样不能跨组合并）。"""
    _install_forbidden_network(monkeypatch)
    with pytest.raises(svc.JuriluSelectionError) as excinfo:
        _fetch([SID_NEW, SID_OTHER])
    exc = excinfo.value
    assert exc.status_code == 400
    assert "一次只能导入一个脚本组" in str(exc)
    assert SID_NEW in str(exc) and SID_OTHER in str(exc)


def test_multiple_selections_rejected_by_route(monkeypatch, db_factory) -> None:
    """HTTP 层：一次传 2 个 scriptId → 400，且**不发任何上游请求**。"""
    factory = db_factory
    _seed_sync(factory)
    _install_forbidden_network(monkeypatch)
    with _client(factory) as client:
        resp = client.post(
            f"/api/v1/studio/jurilu-import/{PROJECT}/preview",
            json=_payload(script_ids=[SID_NEW, SID_OTHER]),
        )
    assert resp.status_code == 400, resp.text
    body = resp.json()
    assert body["code"] == 400 and body["data"] is None
    assert "一次只能导入一个脚本组" in body["message"]
    assert SID_NEW in body["message"] and SID_OTHER in body["message"]


def test_apply_without_script_ids_is_rejected_before_any_request(monkeypatch, db_factory) -> None:
    """没选组就写库 → 400，并且**连上游都不碰**（防止三组合并写库）。"""
    factory = db_factory
    _seed_sync(factory)
    _install_forbidden_network(monkeypatch)
    with _client(factory) as client:
        resp = client.post(f"/api/v1/studio/jurilu-import/{PROJECT}/apply", json=_payload())
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == 400 and body["data"] is None
    assert "script_ids" in body["message"]
    assert "默认不跨 scriptId 合并" in body["message"]
    assert asyncio.run(_count_rows(factory, Shot)) == 0, "被拒绝的 apply 不能写库"


def test_apply_with_two_selections_rejected_and_db_untouched(monkeypatch, db_factory) -> None:
    """跨组写库在 HTTP 层做不到：400 + 库里一条都没有 + 零出网。"""
    factory = db_factory
    _seed_sync(factory)
    _install_forbidden_network(monkeypatch)
    with _client(factory) as client:
        resp = client.post(
            f"/api/v1/studio/jurilu-import/{PROJECT}/apply",
            json=_payload(script_ids=[SID_NEW, SID_OTHER]),
        )
    assert resp.status_code == 400
    assert "一次只能导入一个脚本组" in resp.json()["message"]
    assert asyncio.run(_count_rows(factory, Shot)) == 0
    assert asyncio.run(_count_rows(factory, ShotDetail)) == 0


def test_unknown_script_id_is_a_400_selection_error(monkeypatch) -> None:
    _install_upstream(monkeypatch)
    with pytest.raises(svc.JuriluSelectionError) as excinfo:
        _fetch(["999"])
    exc = excinfo.value
    assert exc.status_code == 400
    assert isinstance(exc, svc.JuriluImportError)
    assert exc.available_script_ids == [SID_NEW, SID_OLD, SID_OTHER]
    message = str(exc)
    assert "999" in message
    for sid in (SID_NEW, SID_OLD, SID_OTHER):
        assert sid in message, "错误文案要把可选的组列出来"


def test_preview_route_returns_400_with_available_groups(monkeypatch, db_factory) -> None:
    factory = db_factory
    _seed_sync(factory)
    _install_upstream(monkeypatch)
    with _client(factory) as client:
        resp = client.post(
            f"/api/v1/studio/jurilu-import/{PROJECT}/preview",
            json=_payload(script_ids=["999"]),
        )
    assert resp.status_code == 400
    body = resp.json()
    assert body["meta"]["available_script_ids"] == [SID_NEW, SID_OLD, SID_OTHER]
    assert [g["script_id"] for g in body["meta"]["script_groups"]] == [
        SID_NEW, SID_OLD, SID_OTHER,
    ]


def test_preview_route_returns_groups_without_merging(monkeypatch, db_factory) -> None:
    factory = db_factory
    _seed_sync(factory)
    _install_upstream(monkeypatch)
    with _client(factory) as client:
        resp = client.post(
            f"/api/v1/studio/jurilu-import/{PROJECT}/preview", json=_payload(),
        )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["requires_script_selection"] is True
    assert data["rows"] == []
    assert data["entry_count"] == 0
    assert data["plan_summary"] == ""
    assert data["note"] == "默认不跨 scriptId 合并：请先选择一个脚本组"
    assert [g["record_count"] for g in data["script_groups"]] == [41, 37, 31]
    assert [g["pages_fetched"] for g in data["script_groups"]] == [1, 1, 1]
    assert all(g["facts"] for g in data["script_groups"]), "客观事实任何情况下都要给"
    # 只暴露采样头，整段正文与凭证不进响应
    assert TAIL_MARK not in resp.text
    assert COOKIE not in resp.text and "abc.def.ghi" not in resp.text


def test_legacy_fetch_shape_still_cannot_merge(monkeypatch, db_factory) -> None:
    """抓取层被换成旧形状（不带分组字段）时，也绝不允许「没选组却有行」。"""
    factory = db_factory
    _seed_sync(factory, shot_count=5)
    monkeypatch.setattr(svc, "fetch_entries", lambda **kwargs: {  # noqa: ARG005
        "entries": [{"shot_label": "S1", "description": "d", "final_prompt": "正文"}],
        "diagnostics": {}, "warnings": [], "scripts": [],
        "project_id": "P", "clip_id": "C",
    })
    preview = _preview(factory, script_ids=[])
    assert preview["entry_count"] == 0
    assert preview["plan"]["rows"] == []
    assert preview["requires_script_selection"] is True
    assert preview["script_groups"] == []


def test_empty_plan_helper_is_really_empty() -> None:
    plan = planner.empty_plan()
    assert plan["rows"] == [] and plan["counts"] == {}
    assert planner.writable_rows(plan["rows"]) == []


# ---------------------------------------------------------------------------
# 3. 统一预览行字段 + 匹配口径（编号优先 / 顺序兜底 / 补建镜头）
# ---------------------------------------------------------------------------


def test_preview_rows_carry_group_seq_index_prompt_and_status(monkeypatch, db_factory) -> None:
    """统一预览每行要有：脚本组 / 序号 / 镜头编号 / 镜头内容 / 待写入提示词 / 状态与原因。"""
    factory = db_factory
    _seed_sync(factory, shot_indexes=[1, 2, 3])
    _install_upstream(monkeypatch)
    preview = _preview(factory, script_ids=[SID_OTHER])
    rows = preview["plan"]["rows"]
    assert len(rows) == 31
    for row in rows[:3]:
        assert row["script_id"] == SID_OTHER
        assert row["seq"] in (1, 2, 3)
        assert row["index"] in (1, 2, 3)
        assert row["title"].startswith("镜头")
        assert row["summary"].startswith(OTHER_TAG)
        assert row["prompt"].startswith(OTHER_TAG)
        assert row["action"] == planner.ACTION_UPDATE
        assert row["reason"] == "写入目标镜头"
        assert row["matched_by"] == planner.MATCHED_BY_SEQ
    # 镜头不够的部分要新建，并如实给出缺多少
    assert rows[3]["action"] == planner.ACTION_CREATE
    assert preview["missing_shot_count"] == 28


def test_plan_matches_by_seq_when_index_lines_up() -> None:
    """编号优先：分镜序号能对上镜头 index → 按编号配（不是按出现顺序）。"""
    entries = [
        {"final_prompt": "第二条", "shot_label": "S2", "description": "d2", "seq": "2"},
        {"final_prompt": "第一条", "shot_label": "S1", "description": "d1", "seq": "1"},
        {"final_prompt": "第三条", "shot_label": "S3", "description": "d3", "seq": "3"},
    ]
    shots = [
        {"id": "shot-1", "index": 1, "title": "镜头1", "video_prompt": ""},
        {"id": "shot-2", "index": 2, "title": "镜头2", "video_prompt": ""},
        {"id": "shot-3", "index": 3, "title": "镜头3", "video_prompt": ""},
    ]
    plan = planner.build_import_plan(entries, shots)
    matched = {row["seq"]: (row["shot_id"], row["index"], row["matched_by"]) for row in plan["rows"]}
    assert matched[2] == ("shot-2", 2, planner.MATCHED_BY_SEQ)
    assert matched[1] == ("shot-1", 1, planner.MATCHED_BY_SEQ)
    assert matched[3] == ("shot-3", 3, planner.MATCHED_BY_SEQ)
    assert plan["counts"] == {planner.ACTION_UPDATE: 3}


def test_plan_falls_back_to_order_when_seq_does_not_line_up() -> None:
    """序号对不上（镜头 index 里没有这个号）→ 退回顺序匹配。"""
    entries = [
        {"final_prompt": "甲", "shot_label": "A", "description": "d", "seq": "91"},
        {"final_prompt": "乙", "shot_label": "B", "description": "d", "seq": "92"},
    ]
    shots = [
        {"id": "shot-1", "index": 1, "title": "镜头1", "video_prompt": ""},
        {"id": "shot-2", "index": 2, "title": "镜头2", "video_prompt": ""},
    ]
    plan = planner.build_import_plan(entries, shots)
    assert [(row["index"], row["matched_by"]) for row in plan["rows"]] == [
        (1, planner.MATCHED_BY_ORDER),
        (2, planner.MATCHED_BY_ORDER),
    ]


def test_plan_without_seq_is_still_sequential() -> None:
    """没有 seq 的老口径保持不变：第 i 条 → 第 i 个镜头。"""
    entries = [{"final_prompt": f"提示词{i}", "shot_label": f"S{i}"} for i in range(1, 4)]
    shots = [{"id": f"shot-{i}", "index": i, "title": f"镜头{i}", "video_prompt": ""}
             for i in range(1, 4)]
    plan = planner.build_import_plan(entries, shots)
    assert [(row["index"], row["prompt"]) for row in plan["rows"]] == [
        (1, "提示词1"), (2, "提示词2"), (3, "提示词3"),
    ]


def test_plan_creates_missing_shots_and_reports_next_index() -> None:
    """复用既有 create_missing 能力：镜头不够就补建，next_index 继续往后排。"""
    entries = [{"final_prompt": f"提示词{i}", "shot_label": f"S{i}", "seq": str(i)}
               for i in range(1, 6)]
    shots = [{"id": "shot-1", "index": 1, "title": "镜头1", "video_prompt": ""}]
    plan = planner.build_import_plan(entries, shots, create_missing=True)
    assert plan["counts"] == {planner.ACTION_UPDATE: 1, planner.ACTION_CREATE: 4}
    assert plan["next_index"] == 5
    assert [row["index"] for row in plan["rows"]] == [1, 2, 3, 4, 5]
    assert all(row["matched_by"] == planner.MATCHED_BY_CREATED for row in plan["rows"][1:])

    strict = planner.build_import_plan(entries, shots, create_missing=False)
    assert strict["counts"] == {planner.ACTION_UPDATE: 1, planner.ACTION_SKIP_NO_SHOT: 4}
    assert len(planner.writable_rows(strict["rows"])) == 1


def test_plan_never_writes_two_entries_to_one_shot() -> None:
    """重复序号不能把两条分镜写到同一个镜头上。"""
    entries = [
        {"final_prompt": "甲", "shot_label": "A", "seq": "1"},
        {"final_prompt": "乙", "shot_label": "B", "seq": "1"},
    ]
    shots = [
        {"id": "shot-1", "index": 1, "title": "镜头1", "video_prompt": ""},
        {"id": "shot-2", "index": 2, "title": "镜头2", "video_prompt": ""},
    ]
    plan = planner.build_import_plan(entries, shots)
    assert plan["rows"][0]["shot_id"] == "shot-1"
    assert plan["rows"][1]["shot_id"] == "shot-2"
    assert plan["rows"][1]["matched_by"] == planner.MATCHED_BY_ORDER


# ---------------------------------------------------------------------------
# 4. 版本判断：客观事实 vs 判断
# ---------------------------------------------------------------------------


def _group(**overrides) -> dict:  # noqa: ANN003
    base = {
        "script_id": "1", "title": "", "title_source": "title", "created_at": "",
        "created_source": "", "updated_at": "", "updated_source": "", "record_count": 1,
        "seq_min": "1", "seq_max": "1", "seq_field": "seqNum", "pages_fetched": 1,
        "sample_records": [], "raw_keys": [], "facts": [], "likely_newest": False,
        "version_reasons": [], "version_hint": "",
    }
    base.update(overrides)
    return base


def _storyboards(specs: list[tuple[str, str]]) -> list[dict]:
    return [{"source_script_id": sid, "prompt_text": text} for sid, text in specs]


def test_same_script_with_comparable_timestamps_marks_newest() -> None:
    """三个成员都有可比时间戳 + 标题/重合度证据 → 只标一个最新，写明字段与值。"""
    groups = [
        _group(script_id="2936083", title="第1集", updated_at="2026-09-19 10:20:00",
               updated_source="updateTime", record_count=41, seq_max="41"),
        _group(script_id="2933351", title="第 1 集", created_at="2026-09-18 09:00:00",
               created_source="createTime", record_count=37, seq_max="37"),
        _group(script_id="2933350", title="第2集", record_count=31, seq_max="31"),
    ]
    storyboards = _storyboards(
        [(SID_NEW, f"正文{n}") for n in range(1, 42)]
        + [(SID_OLD, f"正文{n}") for n in range(1, 38)]
        + [(SID_OTHER, f"别的集{n}") for n in range(1, 32)]
    )
    jurilu.annotate_script_versions(groups, storyboards)
    by_id = {g["script_id"]: g for g in groups}

    assert [g["likely_newest"] for g in groups].count(True) == 1
    assert by_id["2936083"]["likely_newest"] is True
    reasons = by_id["2936083"]["version_reasons"]
    assert any("标题归一化后相同" in r for r in reasons)
    assert any("分镜正文重合度 90%" in r for r in reasons), reasons
    assert any("updateTime=2026-09-19 10:20:00" in r and "最晚" in r for r in reasons)
    assert "仍需用户确认" in by_id["2936083"]["version_hint"]
    assert "2933351" in by_id["2936083"]["version_hint"]
    # 没证据的那一组：三件套全空，但仍然有客观 facts
    assert by_id["2933350"]["likely_newest"] is False
    assert by_id["2933350"]["version_reasons"] == []
    assert by_id["2933350"]["version_hint"] == ""
    assert by_id["2933350"]["facts"]


def test_three_members_all_need_comparable_timestamps() -> None:
    """只有部分组有时间戳 → 没有可比性，谁都不标最新（只陈述客观事实）。"""
    groups = [
        _group(script_id="2936083", title="第1集", updated_at="2026-09-19 10:20:00",
               updated_source="updateTime"),
        _group(script_id="2933351", title="第1集"),
    ]
    jurilu.annotate_script_versions(
        groups, _storyboards([("2936083", "甲"), ("2933351", "甲")]),
    )
    assert [g["likely_newest"] for g in groups] == [False, False]
    for group in groups:
        assert "最新版" not in group["version_hint"]
        assert "无法判断先后" in group["version_hint"]
        assert "请你确认" in group["version_hint"]
    # 有时间的组要把时间当事实写出来
    assert any("updateTime=2026-09-19 10:20:00" in fact for fact in groups[0]["facts"])
    assert any("未取到创建 / 更新时间字段" in fact for fact in groups[1]["facts"])


def test_no_timestamp_never_claims_newest() -> None:
    """用户原话：没有可靠时间证据时不要标记「最新版本」，只能陈述客观信息。"""
    groups = [
        _group(script_id="2936083", title="第1集", record_count=41, seq_max="41"),
        _group(script_id="2933351", title="第 1 集", record_count=37, seq_max="37"),
    ]
    jurilu.annotate_script_versions(
        groups,
        _storyboards([(sid, f"正文{n}") for sid in ("2936083", "2933351") for n in range(1, 38)]),
    )
    assert [g["likely_newest"] for g in groups] == [False, False]
    blob = json.dumps(groups, ensure_ascii=False)
    for forbidden in ("最可能是最新版", "scriptId 最大", "id 大不代表更新", "推测"):
        assert forbidden not in blob, f"无时间戳时不许出现「{forbidden}」这类推测"
    hint = groups[0]["version_hint"]
    assert "标题相同" in hint and "内容重合度" in hint
    assert "无时间戳" in hint and "无法判断先后" in hint and "请你确认" in hint
    # 客观事实仍在（记录数 / 序号范围 / 重合度）
    facts = " ".join(groups[0]["facts"])
    assert "记录数 41" in facts and "序号范围 1–41" in facts
    assert "分镜正文重合度" in facts
    # 顺序不能变：id 更大的那一组不能因为 id 大就被标成最新
    assert groups[0]["likely_newest"] is False


def test_tied_latest_timestamps_do_not_claim_newest() -> None:
    """最新时间戳并列 → 分不出先后，也不标最新。"""
    groups = [
        _group(script_id="100", title="第1集", updated_at="2026-09-19 10:00:00",
               updated_source="updateTime"),
        _group(script_id="200", title="第1集", updated_at="2026-09-19 10:00:00",
               updated_source="updateTime"),
    ]
    jurilu.annotate_script_versions(
        groups, _storyboards([("100", "甲"), ("200", "甲")]),
    )
    assert [g["likely_newest"] for g in groups] == [False, False]
    assert "各组时间戳完全相同" in groups[0]["version_hint"]


def test_no_evidence_means_no_hint_at_all() -> None:
    """标题不同 + 正文不重合 → 全部 false、依据与提示全空（facts 仍给客观信息）。"""
    groups = [
        _group(script_id="100", title="第1集", record_count=2),
        _group(script_id="200", title="第2集", record_count=1),
        _group(script_id="300", title="第3集", record_count=1),
    ]
    storyboards = _storyboards([("100", "甲"), ("100", "乙"), ("200", "丙"), ("300", "丁")])
    jurilu.annotate_script_versions(groups, storyboards)
    for group in groups:
        assert group["likely_newest"] is False
        assert group["version_reasons"] == []
        assert group["version_hint"] == ""
        assert group["facts"], "facts 是客观信息，任何时候都给"


def test_single_group_gets_no_version_hint() -> None:
    groups = [_group(script_id="1", title="第1集", record_count=3, seq_max="3")]
    jurilu.annotate_script_versions(groups, _storyboards([("1", "甲")]))
    assert groups[0]["likely_newest"] is False
    assert groups[0]["version_reasons"] == [] and groups[0]["version_hint"] == ""
    assert any("记录数 3" in fact for fact in groups[0]["facts"])


def test_garbage_timestamps_are_not_treated_as_evidence() -> None:
    """时间字段值不是可解析的时间（例如「刚刚」）→ 等于没有时间戳，不许标最新。"""
    groups = [
        _group(script_id="100", title="第1集", updated_at="刚刚", updated_source="updateTime"),
        _group(script_id="200", title="第1集", updated_at="刚刚", updated_source="updateTime"),
    ]
    jurilu.annotate_script_versions(groups, _storyboards([("100", "甲"), ("200", "甲")]))
    assert [g["likely_newest"] for g in groups] == [False, False]
    blob = json.dumps(groups, ensure_ascii=False)
    for forbidden in ("最可能是最新版", "scriptId 最大", "推测"):
        assert forbidden not in blob
    assert "无法判断先后" in groups[0]["version_hint"]
    # 不可解析的值仍原样如实展示（不编造、也不丢掉）
    assert any("刚刚" in fact for fact in groups[0]["facts"])


def test_likely_newest_never_true_without_comparable_timestamps() -> None:
    """穷举几种「没有可比较时间戳」的形状：``likely_newest`` 必须恒为 false。"""
    shapes = [
        ({}, {}),                                                    # 两边都没有
        ({"updated_at": "2026-09-19 10:00:00"}, {}),                  # 只有一边有
        ({"updated_at": "2026-09-19 10:00:00"},
         {"created_at": "2026-09-19 10:00:00"}),                      # 值相同（并列）
        ({"updated_at": "刚刚"}, {"updated_at": "稍后"}),              # 都不可解析
    ]
    for left, right in shapes:
        groups = [
            _group(script_id="100", title="第1集", **left),
            _group(script_id="200", title="第1集", **right),
        ]
        jurilu.annotate_script_versions(groups, _storyboards([("100", "甲"), ("200", "甲")]))
        assert [g["likely_newest"] for g in groups] == [False, False], (left, right)
        for group in groups:
            assert "最新版" not in group["version_hint"], (left, right, group["version_hint"])
            assert "请你确认" in group["version_hint"], (left, right, group["version_hint"])


def test_timestamp_claim_always_names_the_field_and_value() -> None:
    """真有时间戳时可以标最新，但依据里必须写出**命中字段名与值**。"""
    groups = [
        _group(script_id="100", title="第1集", updated_at="2026-09-19 10:00:00",
               updated_source="gmtModified"),
        _group(script_id="200", title="第1集", updated_at="2026-09-20 08:30:00",
               updated_source="updateTime"),
    ]
    jurilu.annotate_script_versions(groups, _storyboards([("100", "甲"), ("200", "甲")]))
    winner = [g for g in groups if g["likely_newest"]]
    assert len(winner) == 1 and winner[0]["script_id"] == "200"
    assert any("updateTime=2026-09-20 08:30:00" in r for r in winner[0]["version_reasons"])
    assert "updateTime=2026-09-20 08:30:00" in winner[0]["version_hint"]
    assert "仍需用户确认" in winner[0]["version_hint"]


# ---------------------------------------------------------------------------
# 5. 字段名回报（title_source / created_source / updated_source）只放字段名
# ---------------------------------------------------------------------------


def test_field_sources_are_names_only_and_empty_when_missing() -> None:
    """三个 ``*_source`` 只放**命中的字段名**：取不到就空串，永远不会是取值本身。"""
    scripts = [
        {"id": "1", "title": "第1集", "createdAt": "2026-09-19 10:00:00"},
        {"id": "2", "name": "第2集", "someTimeField": "2026-09-18 09:00:00"},
        {"id": "3"},
    ]
    by_id = {g["script_id"]: g for g in jurilu.build_script_groups(scripts, [])}

    hit = by_id["1"]
    assert hit["title_source"] == "title"
    assert hit["created_source"] == "createdAt"
    assert hit["updated_source"] == "" and hit["updated_at"] == ""
    assert hit["title_source"] in hit["raw_keys"]
    assert hit["created_source"] in hit["raw_keys"]

    unknown = by_id["2"]
    assert unknown["created_at"] == "" and unknown["updated_at"] == ""
    assert unknown["created_source"] == "" and unknown["updated_source"] == ""
    assert unknown["title_source"] == "name"

    empty = by_id["3"]
    assert (empty["title"], empty["title_source"]) == ("", "")
    assert (empty["created_at"], empty["created_source"]) == ("", "")
    assert (empty["updated_at"], empty["updated_source"]) == ("", "")

    # 任何情况下 source 都不许带上取值的内容（时间数字 / 标题文字）
    for group in by_id.values():
        for source_key in ("title_source", "created_source", "updated_source"):
            source = group[source_key]
            assert "2026" not in source and "第" not in source, (source_key, source)
        for value_key, source_key in (("created_at", "created_source"),
                                      ("updated_at", "updated_source")):
            assert (group[source_key] == "") is (group[value_key] == ""), (
                source_key, group[source_key], value_key, group[value_key],
            )


# ---------------------------------------------------------------------------
# 5. 凭证 / 正文不进 raw_keys 与诊断
# ---------------------------------------------------------------------------


def test_raw_keys_are_names_only_and_credentials_are_dropped(monkeypatch) -> None:
    _install_upstream(monkeypatch)
    groups = _fetch([])["script_groups"]
    by_id = {g["script_id"]: g for g in groups}
    assert by_id[SID_NEW]["raw_keys"] == [
        "id", "title", "createdAt", "updateTime", "projectId",
    ]
    assert by_id[SID_OLD]["raw_keys"] == ["scriptId", "scriptName", "createTime"]
    blob = json.dumps(groups, ensure_ascii=False)
    assert "Authorization" not in blob, "凭证字段名也不该进 raw_keys"
    assert "cookie" not in blob
    assert "凭证不该出现在" not in blob


def test_diagnostics_and_groups_carry_no_prompt_body_or_credential(monkeypatch) -> None:
    _install_upstream(monkeypatch)
    fetched = _fetch([SID_NEW])
    diagnostics = json.dumps(fetched["diagnostics"], ensure_ascii=False)
    groups = json.dumps(fetched["script_groups"], ensure_ascii=False)
    for blob in (diagnostics, groups):
        assert TAIL_MARK not in blob, "整段正文不该出现在脚本组 / 诊断里"
        assert "abc.def.ghi" not in blob
        assert "ph_phc_demo" not in blob
        assert "凭证不该" not in blob
    summary = fetched["diagnostics"]["script_groups"]
    assert [item["script_id"] for item in summary] == [SID_NEW, SID_OLD, SID_OTHER]
    assert fetched["diagnostics"]["storyboard_pages_by_script"][SID_NEW] == 1


def test_selection_error_diagnostics_are_redacted(monkeypatch) -> None:
    _install_upstream(monkeypatch)
    with pytest.raises(svc.JuriluSelectionError) as excinfo:
        _fetch(["404"])
    blob = json.dumps(excinfo.value.diagnostics, ensure_ascii=False)
    assert TAIL_MARK not in blob
    assert "abc.def.ghi" not in blob and "ph_phc_demo" not in blob
    assert excinfo.value.diagnostics["all_script_ids"] == [SID_NEW, SID_OLD, SID_OTHER]


def test_storyboard_without_script_id_is_never_merged_in(monkeypatch) -> None:
    """分镜记录没带 ``source_script_id`` 时**宁可为空也不并入**所选组（fail-closed）。"""
    monkeypatch.setattr(jurilu, "fetch_all_storyboards", lambda **kwargs: {  # noqa: ARG005
        "ok": True,
        "scripts": [{"script_id": "SC1", "script_title": "第一集"}],
        "storyboards": [
            {"agent_name": "分镜 S001", "prompt_text": "提示词甲", "shot_summary": "摘要",
             "seqNum": "1", "sbid": "S001"},
        ],
        "warnings": [],
        "diagnostics": {},
    })
    without_selection = _fetch([])
    assert without_selection["requires_script_selection"] is True
    assert without_selection["script_groups"][0]["record_count"] == 0

    selected = _fetch(["SC1"])
    assert selected["selected_script_ids"] == ["SC1"]
    assert selected["entries"] == [], "归属不明的分镜不能并进所选组"


# ---------------------------------------------------------------------------
# 6. 整组保存：来源标记 / 不混组 / 往返一致 / 不碰付费出口
# ---------------------------------------------------------------------------


def test_apply_writes_only_the_selected_group(monkeypatch, db_factory) -> None:
    """选 2933350（31 条）→ 只写这 31 条，来源标记仍是 jurilu，不含别组正文。"""
    factory = db_factory
    _seed_sync(factory)
    _install_upstream(monkeypatch)
    with _client(factory) as client:
        resp = client.post(
            f"/api/v1/studio/jurilu-import/{PROJECT}/apply",
            json=_payload(script_ids=[SID_OTHER]),
        )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["created"] == 31 and data["written"] == 31

    written = asyncio.run(_fetch_prompts(factory))
    assert len(written) == 31
    assert {source for _prompt, source in written} == {"jurilu"}
    assert all(OTHER_TAG in prompt for prompt, _source in written)
    assert not any(SHARED_TAG in prompt for prompt, _source in written)


def test_whole_group_round_trip_preview_apply_preview(monkeypatch, db_factory) -> None:
    """整组往返：预览 31 → 写库 31 → 再预览全是 unchanged（幂等、不重复建镜头）。"""
    factory = db_factory
    _seed_sync(factory)
    _install_upstream(monkeypatch)
    with _client(factory) as client:
        first = client.post(
            f"/api/v1/studio/jurilu-import/{PROJECT}/preview",
            json=_payload(script_ids=[SID_OTHER]),
        )
        assert first.status_code == 200
        first_data = first.json()["data"]
        assert first_data["entry_count"] == 31
        assert first_data["missing_shot_count"] == 31
        assert first_data["selected_script_id"] == SID_OTHER

        applied = client.post(
            f"/api/v1/studio/jurilu-import/{PROJECT}/apply",
            json=_payload(script_ids=[SID_OTHER]),
        )
        assert applied.status_code == 200, applied.text
        assert applied.json()["data"]["written"] == 31

        second = client.post(
            f"/api/v1/studio/jurilu-import/{PROJECT}/preview",
            json=_payload(script_ids=[SID_OTHER]),
        )
        second_data = second.json()["data"]

    assert second_data["counts"] == {planner.ACTION_UNCHANGED: 31}
    assert second_data["missing_shot_count"] == 0
    assert asyncio.run(_count_rows(factory, Shot)) == 31
    sources = {source for _prompt, source in asyncio.run(_fetch_prompts(factory))}
    assert sources == {"jurilu"}


def test_chain_never_touches_paid_outlets(monkeypatch, db_factory) -> None:
    """整条链路不触发 LLM / 出图 / 视频出口（守卫默认演练），也不产生任务行。"""
    calls: list[str] = []

    def forbidden_guard(detail: str = "", *, outlet: str = "llm") -> None:  # noqa: ARG001
        calls.append(outlet)
        raise AssertionError(f"不该触碰付费出口：{outlet}")

    def forbidden_task_gate(task_kind: str, detail: str = "") -> str | None:  # noqa: ARG001
        calls.append(f"task:{task_kind}")
        raise AssertionError(f"不该提交付费任务：{task_kind}")

    monkeypatch.setattr(guard, "require_outlet", forbidden_guard)
    monkeypatch.setattr(guard, "task_kind_block_reason", forbidden_task_gate)
    assert dry_run.dry_run_enabled() is True, "后端默认必须是演练模式"
    assert dry_run.is_real_mode() is False

    factory = db_factory
    _seed_sync(factory)
    _install_upstream(monkeypatch)
    with _client(factory) as client:
        assert client.post(
            f"/api/v1/studio/jurilu-import/{PROJECT}/preview",
            json=_payload(script_ids=[SID_OTHER]),
        ).status_code == 200
        assert client.post(
            f"/api/v1/studio/jurilu-import/{PROJECT}/apply",
            json=_payload(script_ids=[SID_OTHER]),
        ).status_code == 200

    assert calls == [], "整条链路不该调用任何付费出口守卫"
    assert asyncio.run(_count_rows(factory, GenerationTask)) == 0
