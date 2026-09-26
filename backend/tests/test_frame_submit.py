"""关键帧出图的同进程内联路径（``image_pipeline/frame_submit.py``）。

覆盖用户实际反馈的三个点：
1. 生图**读的是镜头已保存的帧提示词**（不是模板、不是空串）；
2. 参考图真的进了这次请求（公网地址透传、坏图降级为 warning）；
3. 结果**落库**（shot_frame_images.file_id），刷新后仍在——DRY_RUN 下则一个字节都不写。

全部不联网：DRY_RUN 分支断言"没建任务、没写库"；真实分支注入 stub 执行函数。
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models.studio import ShotDetail, ShotFrameImage
from app.models.types import FileType
from app.schemas.studio.image_pipeline import (
    FrameSubmitPlanRequest,
    FrameSubmitRequest,
)
from app.services.studio.image_pipeline import frame_submit
from app.services.studio.image_pipeline.frame_submit import (
    build_frame_submit_plan,
    resolve_target_ratio,
    saved_frame_prompt,
    submit_frame,
)
from app.services.studio.llm_orchestration.dry_run import CONFIRM_ENV, DRY_RUN_ENV
from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot

SAVED_PROMPT = "韩虹站在舞台中央，齐肩黑发，米色长裙，暖色聚光灯，中景平视，电影质感"


async def _seed_shot_detail(db, *, key_prompt: str = SAVED_PROMPT, ratio: str | None = None) -> None:
    await seed_project_chapter_shot(db)
    db.add(
        ShotDetail(
            id="shot-1",
            camera_shot="中景",
            angle="平视",
            movement="固定",
            key_frame_prompt=key_prompt,
            first_frame_prompt="首帧提示词",
            last_frame_prompt="尾帧提示词",
            override_video_ratio=ratio,
        )
    )
    await db.flush()


async def _seed_public_image_file(db, file_id: str, *, url: str | None = None) -> None:
    """种一条**公网地址**的图片 FileItem（OSS 资产就是这个形态）。"""
    from app.models.studio import FileItem

    storage_url = url or f"https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/assets/{file_id}.png"
    db.add(
        FileItem(
            id=file_id,
            name=f"{file_id}.png",
            thumbnail=storage_url,
            storage_key=storage_url,
            type=FileType.image,
        )
    )
    await db.flush()


async def _seed_image_model(db) -> None:
    """种一个最小可用的图片模型 + 供应商 + 默认设置（不联网，只解析配置）。"""
    from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider

    db.add(
        Provider(
            id="prov-test-image",
            name="openai",
            base_url="http://127.0.0.1:4321/v1",
            image_base_url="http://127.0.0.1:4321/v1",
            api_key="test-key",
            status="active",
        )
    )
    await db.flush()
    db.add(
        Model(
            id="model-image2",
            name="image2",
            category=ModelCategoryKey.image,
            provider_id="prov-test-image",
        )
    )
    db.add(ModelSettings(id=1, default_image_model_id="model-image2"))
    await db.flush()


@pytest.fixture(autouse=True)
def _dry_run_env(monkeypatch):
    """默认把守卫关掉（但下面的用例可按需打开），保证不依赖开发机环境变量。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")


def test_saved_frame_prompt_reads_the_matching_field():
    detail = ShotDetail(id="s", key_frame_prompt="  关键  ", first_frame_prompt="首", last_frame_prompt="尾")

    assert saved_frame_prompt(detail, "key") == "关键"
    assert saved_frame_prompt(detail, "first") == "首"
    assert saved_frame_prompt(detail, "last") == "尾"
    assert saved_frame_prompt(detail, "unknown") == ""


@pytest.mark.asyncio
async def test_plan_uses_saved_key_frame_prompt_and_marks_source():
    """断点①的同款要求：计划里的提示词必须就是镜头里保存的那条，并标清来源。"""
    db, engine = await build_session()
    try:
        await _seed_shot_detail(db)
        await _seed_image_model(db)
        await _seed_public_image_file(db, "file-a")
        await db.commit()
        plan = await build_frame_submit_plan(
            db,
            body=FrameSubmitPlanRequest(shot_id="shot-1", frame_type="key", images=["file-a"]),
        )
    finally:
        await engine.dispose()

    assert plan.prompt == SAVED_PROMPT
    assert plan.prompt_source == "saved"
    assert plan.reference_file_ids == ["file-a"]
    # 回归：ResolvedProviderConfig 的字段是 provider_key，写错会静默变成"未识别供应商"
    assert plan.provider == "openai"
    assert plan.model_name == "image2"
    assert plan.api_key_configured is True
    assert any("key_frame_prompt" in w for w in plan.warnings)


@pytest.mark.asyncio
async def test_plan_only_promises_resolvable_reference_images():
    """计划不能按"绑定的资产数"报参考图：坏图要当场剔除并说明。"""
    db, engine = await build_session()
    try:
        await _seed_shot_detail(db)
        await _seed_image_model(db)
        await _seed_public_image_file(db, "file-a")
        await db.commit()
        plan = await build_frame_submit_plan(
            db,
            body=FrameSubmitPlanRequest(shot_id="shot-1", frame_type="key", images=["file-a", "file-missing"]),
        )
    finally:
        await engine.dispose()

    assert plan.reference_file_ids == ["file-a"]
    assert len(plan.reference_file_ids) == 1
    assert any("file-missing" in w for w in plan.warnings)
    assert any("实际只有 1 张可用" in w for w in plan.warnings)


@pytest.mark.asyncio
async def test_plan_marks_empty_prompt_so_submit_refuses():
    db, engine = await build_session()
    try:
        await _seed_shot_detail(db, key_prompt="")
        await _seed_image_model(db)
        plan = await build_frame_submit_plan(db, body=FrameSubmitPlanRequest(shot_id="shot-1"))
        assert plan.prompt_source == "empty"
        assert plan.prompt == ""

        with pytest.raises(HTTPException) as exc:
            await submit_frame(
                db,
                body=FrameSubmitRequest(shot_id="shot-1", prompt=""),
                create_task=_fail_if_called,
                build_run_args=_fail_if_called,
                run_task=_fail_if_called,
                read_result=_fail_if_called,
            )
    finally:
        await engine.dispose()

    assert exc.value.status_code == 400
    assert "key_frame_prompt" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_plan_ratio_falls_back_shot_then_project_then_default():
    db, engine = await build_session()
    try:
        await _seed_shot_detail(db, ratio="9:16")
        await _seed_image_model(db)
        detail = await db.get(ShotDetail, "shot-1")
        warnings: list[str] = []
        ratio, source = await resolve_target_ratio(db, shot_detail=detail, requested="", warnings=warnings)
        assert (ratio, source) == ("9:16", "shot")
        assert warnings == []

        # 项目也没有默认比例 → 兜底 16:9 并说明
        detail.override_video_ratio = None
        ratio, source = await resolve_target_ratio(db, shot_detail=detail, requested="", warnings=warnings)
        assert (ratio, source) == (frame_submit.DEFAULT_TARGET_RATIO, "default")
        assert warnings and "默认" in warnings[0]

        # 显式请求值优先
        ratio, source = await resolve_target_ratio(db, shot_detail=detail, requested="4:3", warnings=[])
        assert (ratio, source) == ("4:3", "request")
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_dry_run_returns_plan_and_writes_nothing(monkeypatch):
    """DRY_RUN：不建任务、不写 shot_frame_images —— 演练占位不能进正式产物字段。"""
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)

    from sqlalchemy import select

    db, engine = await build_session()
    try:
        await _seed_shot_detail(db)
        await _seed_image_model(db)
        result = await submit_frame(
            db,
            body=FrameSubmitRequest(shot_id="shot-1", images=["file-a"]),
            create_task=_fail_if_called,
            build_run_args=_fail_if_called,
            run_task=_fail_if_called,
            read_result=_fail_if_called,
        )
        rows = (await db.execute(select(ShotFrameImage))).scalars().all()
    finally:
        await engine.dispose()

    assert result.status == "dry_run"
    assert result.dry_run is True
    assert result.prompt == SAVED_PROMPT
    assert result.prompt_source == "saved"
    assert result.file_id == ""
    assert result.task_id == ""
    assert rows == []
    assert any("DRY_RUN" in w for w in result.warnings)


@pytest.mark.asyncio
async def test_submit_runs_inline_with_saved_prompt_and_persists(monkeypatch):
    """真实路径（stub 执行）：建任务 → 同进程执行 → 回读落库结果。"""
    captured: dict = {}

    async def _stub_create(**kwargs):
        captured["create"] = kwargs
        return "task-123"

    async def _stub_build_args(**kwargs):
        captured["build_args"] = kwargs
        return {"input": {"prompt": kwargs["prompt"], "images": kwargs.get("images")}}, object()

    async def _stub_run(task_id, run_args):
        captured["run"] = (task_id, run_args)

    async def _stub_read(db, *, task_id, slot_id):
        captured["read"] = (task_id, slot_id)
        return {
            "status": "succeeded",
            "file_id": "file-generated",
            "image_url": "https://example.com/frame.png",
            "provider": "openai",
            "provider_task_id": "svc-1",
            "provider_notes": ["/images/edits 的参考图未能透传：本次为纯文生图。"],
        }

    oss_url = "https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/assets/ref.png"
    db, engine = await build_session()
    try:
        await _seed_shot_detail(db, ratio="16:9")
        await _seed_image_model(db)
        # 绑定资产的定版图本来就在 OSS 上：参考图必须是**透传的公网地址**，不能是本地路径
        await _seed_public_image_file(db, "file-oss-public", url=oss_url)
        await db.commit()
        result = await submit_frame(
            db,
            body=FrameSubmitRequest(shot_id="shot-1", images=["file-oss-public"]),
            create_task=_stub_create,
            build_run_args=_stub_build_args,
            run_task=_stub_run,
            read_result=_stub_read,
        )
        slots = (await db.execute(__import__("sqlalchemy").select(ShotFrameImage))).scalars().all()
    finally:
        await engine.dispose()

    # 提示词 = 镜头保存的那条（断点①）
    assert captured["create"]["prompt"] == SAVED_PROMPT
    assert captured["create"]["images"] == [{"image_url": oss_url}]
    assert captured["build_args"]["prompt"] == SAVED_PROMPT
    assert captured["create"]["relation_type"] == "shot_frame_image"
    assert captured["run"][0] == "task-123"
    assert captured["read"][0] == "task-123"

    assert result.status == "succeeded"
    assert result.task_id == "task-123"
    assert result.file_id == "file-generated"
    assert result.image_url == "https://example.com/frame.png"
    assert result.prompt_source == "saved"
    assert result.provider_notes and "参考图未能透传" in result.provider_notes[0]
    # 落库目标行被创建（任务体负责写 file_id）
    assert len(slots) == 1
    assert slots[0].frame_type == "key"
    assert result.image_slot_id == slots[0].id


@pytest.mark.asyncio
async def test_submit_reuses_existing_slot_row(monkeypatch):
    """已有 slot 时不再新建（每镜头每类型至多一条）。"""
    from sqlalchemy import select

    async def _stub_create(**kwargs):
        return "task-9"

    async def _stub_build_args(**kwargs):
        return {}, object()

    async def _stub_run(task_id, run_args):
        return None

    async def _stub_read(db, *, task_id, slot_id):
        return {"status": "succeeded", "file_id": "f"}

    db, engine = await build_session()
    try:
        await _seed_shot_detail(db)
        await _seed_image_model(db)
        db.add(ShotFrameImage(shot_detail_id="shot-1", frame_type="key", file_id=None, format="png"))
        await db.commit()

        result = await submit_frame(
            db,
            body=FrameSubmitRequest(shot_id="shot-1", images=["ref-1"]),
            create_task=_stub_create,
            build_run_args=_stub_build_args,
            run_task=_stub_run,
            read_result=_stub_read,
        )
        slots = (await db.execute(select(ShotFrameImage))).scalars().all()
    finally:
        await engine.dispose()

    assert len(slots) == 1
    assert result.image_slot_id == slots[0].id


@pytest.mark.asyncio
async def test_submit_reports_timeout_without_lying_about_success(monkeypatch):
    """超时要如实说"我放弃等待了，不代表上游失败"，并把任务号带出来。"""

    async def _stub_create(**kwargs):
        return "task-slow"

    async def _stub_build_args(**kwargs):
        return {}, object()

    async def _stub_run(task_id, run_args):
        import asyncio

        await asyncio.sleep(30)

    db, engine = await build_session()
    try:
        await _seed_shot_detail(db)
        await _seed_image_model(db)
        result = await submit_frame(
            db,
            body=FrameSubmitRequest(shot_id="shot-1", images=["r"], timeout_seconds=1.0),
            create_task=_stub_create,
            build_run_args=_stub_build_args,
            run_task=_stub_run,
            read_result=_fail_if_called,
        )
    finally:
        await engine.dispose()

    assert result.status == "timeout"
    assert result.task_id == "task-slow"
    assert "超时" in result.error or "等待超过" in result.error
    assert result.file_id == ""


def test_unknown_frame_type_rejected_at_schema_level():
    """frame_type 是 Literal：非法值在请求解析阶段就被拒（不会走到服务层）。"""
    from pydantic import ValidationError

    with pytest.raises(ValidationError) as exc:
        FrameSubmitPlanRequest(shot_id="shot-1", frame_type="mid")
    assert "frame_type" in str(exc.value)


@pytest.mark.asyncio
async def test_unknown_frame_type_rejected_in_service_layer(monkeypatch):
    """服务层再兜一次（直接调用时 frame_type 可能是字符串）。"""
    db, engine = await build_session()
    try:
        await _seed_shot_detail(db)
        await _seed_image_model(db)
        body = FrameSubmitPlanRequest.model_construct(shot_id="shot-1", frame_type="mid")
        with pytest.raises(HTTPException) as exc:
            await build_frame_submit_plan(db, body=body)
    finally:
        await engine.dispose()
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_missing_shot_returns_404():
    db, engine = await build_session()
    try:
        with pytest.raises(HTTPException) as exc:
            await build_frame_submit_plan(db, body=FrameSubmitPlanRequest(shot_id="nope"))
    finally:
        await engine.dispose()
    assert exc.value.status_code == 404


async def _fail_if_called(*_args, **_kwargs):  # pragma: no cover - 只在被误调用时才触发
    raise AssertionError("这一步不应该被调用")
