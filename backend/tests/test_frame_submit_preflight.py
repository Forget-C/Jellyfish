"""关键帧（含「AI 首帧」）出图端点里的**提交前可达性复核**。

真实故障 A：参考图地址只在本机可读（匿名 404），上游取不到图 → 任务 failed
（原文「无法获取输入媒体 URL（404/410）」）。这条路径过去只判「有没有 file_id」，
不判「上游取不取得到」。

本文件锁住：

1. 不可达 → **在写库 / 建任务之前**就拒绝（``shot_frame_images`` 一行都不写、不花钱）；
2. 可达 → 行为完全不变（参考图照旧透传）；
3. 报错文案带**可读名**（哪个资产的哪张图），不带 ``file_id``。

全部不联网：探活注入 stub（MockTransport），执行函数全部注入假实现。
"""

from __future__ import annotations

import httpx
import pytest

from app.models.studio import FileItem, ShotDetail
from app.models.types import FileType
from app.schemas.studio.image_pipeline import FrameSubmitRequest
from app.services.studio.image_pipeline import frame_submit as frame_submit_module
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.image_pipeline.frame_submit import submit_frame
from app.services.studio.llm_orchestration.dry_run import CONFIRM_ENV, DRY_RUN_ENV
from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot

SAVED_PROMPT = "韩虹站在舞台中央，中景平视，电影质感"
OSS_URL = "https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/files/test_scene.png"

_REAL_PROBE = reference_preflight.probe_reference_url


def _probe_with(status: int):  # type: ignore[no-untyped-def]
    async def _probe(url, *, label="", role="", **_kwargs):  # type: ignore[no-untyped-def]
        return await _REAL_PROBE(url, label=label, role=role, transport=httpx.MockTransport(lambda _r: httpx.Response(status)))

    return _probe


async def _seed(db) -> None:  # type: ignore[no-untyped-def]
    """种一个镜头 + 图片模型 + 一张**公网地址**的参考图。"""
    from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider

    await seed_project_chapter_shot(db)
    db.add(
        ShotDetail(
            id="shot-1",
            camera_shot="中景",
            angle="平视",
            movement="固定",
            key_frame_prompt=SAVED_PROMPT,
            first_frame_prompt=SAVED_PROMPT,
        )
    )
    db.add(
        Provider(
            id="prov-apimart",
            name="apimart",
            base_url="http://127.0.0.1:4321/v1",
            image_base_url="http://127.0.0.1:4321/v1",
            api_key="test-key",
            status="active",
        )
    )
    await db.flush()
    db.add(Model(id="model-image2", name="gpt-image-2", category=ModelCategoryKey.image, provider_id="prov-apimart"))
    db.add(ModelSettings(id=1, default_image_model_id="model-image2"))
    db.add(FileItem(id="file-a", name="场景定版图.png", type=FileType.image, storage_key=OSS_URL, thumbnail=OSS_URL))
    await db.flush()


@pytest.fixture(autouse=True)
def _real_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")


async def _fail_if_called(*_args, **_kwargs):  # pragma: no cover - 触发即失败
    raise AssertionError("这一步不应该被调用")


@pytest.mark.asyncio
async def test_unreachable_reference_blocks_before_any_write(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(reference_preflight, "probe_reference_url", _probe_with(404))

    db, engine = await build_session()
    try:
        await _seed(db)
        with pytest.raises(reference_preflight.ReferencePreflightBlocked) as exc_info:
            await submit_frame(
                db,
                body=FrameSubmitRequest(shot_id="shot-1", frame_type="first", images=["file-a"]),
                create_task=_fail_if_called,
                build_run_args=_fail_if_called,
                run_task=_fail_if_called,
                read_result=_fail_if_called,
                preflight=reference_preflight.preflight_or_raise,
            )

        from sqlalchemy import select

        from app.models.studio import ShotFrameImage

        rows = (await db.execute(select(ShotFrameImage))).scalars().all()
    finally:
        await engine.dispose()

    assert rows == []  # 一行都没写
    detail = exc_info.value.detail
    assert detail["code"] == reference_preflight.UNREACHABLE_ERROR_CODE
    assert detail["paid_call_made"] is False
    assert detail["unreachable"][0]["http_status"] == 404
    assert detail["unreachable"][0]["asset"] == "显式指定的参考图 1"  # 可读名，不是 file_id
    assert "file_id" not in str(detail)
    assert "/Users/" not in str(detail)


@pytest.mark.asyncio
async def test_data_url_reference_is_blocked_without_any_request(monkeypatch: pytest.MonkeyPatch) -> None:
    """APIMart 只吃 http(s)://：本地文件解析出的 data URL 必须在提交前拦下（连请求都不发）。"""

    def _boom(*_args, **_kwargs):  # pragma: no cover - 触发即失败
        raise AssertionError("形态不对的地址不该发探活请求")

    monkeypatch.setattr(httpx.AsyncClient, "request", _boom)

    async def _fake_resolve(_db, *, file_ids):  # type: ignore[no-untyped-def]
        return [{"image_url": "data:image/png;base64,AAAA"}], list(file_ids), []

    monkeypatch.setattr(frame_submit_module, "resolve_reference_refs_reporting", _fake_resolve)

    db, engine = await build_session()
    try:
        await _seed(db)
        with pytest.raises(reference_preflight.ReferencePreflightBlocked) as exc_info:
            await submit_frame(
                db,
                body=FrameSubmitRequest(shot_id="shot-1", frame_type="first", images=["file-a"]),
                create_task=_fail_if_called,
                build_run_args=_fail_if_called,
                run_task=_fail_if_called,
                read_result=_fail_if_called,
                preflight=reference_preflight.preflight_or_raise,
            )
    finally:
        await engine.dispose()

    assert exc_info.value.detail["unreachable"][0]["kind"] == reference_preflight.KIND_DATA_URL


def test_frame_reference_candidates_use_readable_labels() -> None:
    """候选里只带可读名（页面文案规范），并按供应商能力决定 data URL 是否算不可达。"""
    from app.services.studio.image_pipeline.frame_submit import (
        FrameSubmitPlan,
        frame_reference_candidates,
    )

    plan = FrameSubmitPlan(
        shot_id="shot-1",
        frame_type="first",
        prompt="p",
        prompt_source="saved",
        provider="openai",
        reference_file_ids=["file-a", "file-b"],
        reference_labels=["角色「林晓」的定版图", ""],
    )
    candidates = frame_reference_candidates(
        plan=plan,
        refs=[{"image_url": "https://cdn.example.com/a.png"}, {"image_url": "data:image/png;base64,AA"}],
        kept_file_ids=["file-a", "file-b"],
    )

    assert [(item.label, item.role) for item in candidates] == [
        ("角色「林晓」的定版图", "frame:first"),
        ("首帧参考图 2", "frame:first"),
    ]
    # openai 自己解码 base64 → 不算不可达
    assert all(item.allow_data_url is True for item in candidates)

    apimart_plan = FrameSubmitPlan(
        shot_id="shot-1",
        frame_type="first",
        prompt="p",
        prompt_source="saved",
        provider="apimart",
    )
    apimart_candidate = frame_reference_candidates(
        plan=apimart_plan, refs=[{"image_url": "data:image/png;base64,AA"}]
    )[0]
    assert apimart_candidate.allow_data_url is False


@pytest.mark.asyncio
async def test_reachable_reference_submits_as_before(monkeypatch: pytest.MonkeyPatch) -> None:
    """可达时行为完全不变：参考图照旧透传给生成任务。"""
    monkeypatch.setattr(reference_preflight, "probe_reference_url", _probe_with(200))
    captured: dict = {}

    async def _stub_create(**kwargs):  # type: ignore[no-untyped-def]
        captured["create"] = kwargs
        return "task-1"

    async def _stub_build_args(**kwargs):  # type: ignore[no-untyped-def]
        return {"input": {"prompt": kwargs["prompt"]}}, object()

    async def _stub_run(_task_id, _run_args):  # type: ignore[no-untyped-def]
        return None

    async def _stub_read(_db, *, task_id, slot_id):  # type: ignore[no-untyped-def]
        return {"status": "succeeded", "file_id": "file-generated"}

    db, engine = await build_session()
    try:
        await _seed(db)
        result = await submit_frame(
            db,
            body=FrameSubmitRequest(shot_id="shot-1", frame_type="first", images=["file-a"]),
            create_task=_stub_create,
            build_run_args=_stub_build_args,
            run_task=_stub_run,
            read_result=_stub_read,
            preflight=reference_preflight.preflight_or_raise,
        )
    finally:
        await engine.dispose()

    assert captured["create"]["images"] == [{"image_url": OSS_URL}]
    assert result.status == "succeeded"
    assert result.task_id == "task-1"
