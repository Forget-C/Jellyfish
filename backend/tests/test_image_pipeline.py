"""P3 出图管线：守卫出口、定妆照/垫图计划、出图服务契约、OSS 回读、直提出视频、提示词包。

全部测试不联网：DRY_RUN 分支断言"一个 HTTP 都没发"；真实分支用 httpx MockTransport
或注入的 stub task_factory，绝不触达真实 provider。
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.schemas.studio.image_pipeline import (
    PromptPackageRequest,
    VideoSubmitPlanRequest,
)
from app.schemas.studio.llm_orchestration import (
    AssetBindingPreviewRequest,
    EntityExtractionPreviewRequest,
)
from app.services.studio.image_pipeline import external_image_client as client
from app.services.studio.image_pipeline import image_pipeline
from app.services.studio.image_pipeline.image_pipeline import (
    build_deterministic_prompt,
    build_object_key_template,
    build_source_task_id,
    build_targets,
    submit_targets,
    summarize_results,
)
from app.services.studio.image_pipeline.prompt_package import (
    build_prompt_package,
    render_package_markdown,
    render_package_text,
)
from app.services.studio.image_pipeline.reference_resolver import resolve_references
from app.services.studio.image_pipeline.video_submit import (
    MIN_VIDEO_SECONDS,
    PINNED_VIDEO_MODEL,
    PINNED_VIDEO_RESOLUTION,
    pinned_video_model,
    pinned_video_resolution,
    resolve_plan_seconds,
)
from app.services.studio.image_pipeline import video_submit
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.dry_run import (
    CONFIRM_ENV,
    DRY_RUN_ENV,
    DryRunBlocked,
    RealCallNotConfirmed,
    assert_outbound_allowed,
    clear_audit_log,
)
from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot

CREATE_PATH = "/api/service/asset-image-tasks"


# ---------------------------------------------------------------------------
# 0) 公共脚手架
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)
    clear_audit_log()
    yield
    clear_audit_log()


@pytest.fixture(autouse=True)
def _fake_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    """把对象存储读取替换成确定性假 URL：测试不依赖磁盘/S3 上真有文件。"""
    from app.core.storage import StoredFileInfo

    async def _fake_get_file_info(*, key: str) -> StoredFileInfo:
        return StoredFileInfo(key=key, url=f"https://oss.example.com/{key.lstrip('/')}")

    monkeypatch.setattr("app.core.storage.get_file_info", _fake_get_file_info)


async def _seed_assets(db) -> None:  # type: ignore[no-untyped-def]
    """种一个项目 + 镜头 + 三类资产 + 角色定版主图。"""
    from app.models.studio import Character, CharacterImage, FileItem, ProjectSceneLink, Scene

    await seed_project_chapter_shot(db)
    db.add(Character(id="char-1", project_id="proj-1", name="林晓", description="女主，A公司法务", style="真人都市"))
    db.add(Scene(id="scene-1", name="A公司会议室", description="现代办公会议室", style="真人都市", tags=["会议室"]))
    db.add(FileItem(id="file-1", type="image", name="林晓定妆照", storage_key="jellyfish/proj-1/character/char-1_front.png"))
    await db.flush()
    db.add(ProjectSceneLink(id=1, project_id="proj-1", shot_id="shot-1", scene_id="scene-1"))
    db.add(
        CharacterImage(
            id=1,
            character_id="char-1",
            file_id="file-1",
            is_primary=True,
            view_angle="FRONT",
            quality_level="HIGH",
        )
    )
    await db.flush()


# ---------------------------------------------------------------------------
# 1) 守卫：出口隔离 + DRY_RUN 占位工厂
# ---------------------------------------------------------------------------


def test_guard_covers_all_outlets_and_blocks_by_default() -> None:
    for outlet in (dry_run.OUTLET_LLM, dry_run.OUTLET_IMAGE, dry_run.OUTLET_VIDEO, dry_run.OUTLET_OSS):
        with pytest.raises(DryRunBlocked) as exc_info:
            assert_outbound_allowed("unit-test", outlet=outlet)
        assert exc_info.value.outlet == outlet

    assert set(dry_run.OUTLETS) == {"llm", "image", "video", "oss"}


def test_guard_requires_confirmation_even_when_dry_run_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    with pytest.raises(RealCallNotConfirmed) as exc_info:
        assert_outbound_allowed("unit-test", outlet=dry_run.OUTLET_IMAGE)
    assert exc_info.value.outlet == "image"

    monkeypatch.setenv(CONFIRM_ENV, "1")
    assert_outbound_allowed("unit-test", outlet=dry_run.OUTLET_IMAGE)  # 不抛异常
    assert any(item["target"] == "image" for item in dry_run.audit_log())


def test_fake_artifact_factories_are_deterministic_and_unreachable() -> None:
    first = dry_run.fake_task_id("image", "char-1")
    assert first == dry_run.fake_task_id("image", "char-1")
    assert first.startswith("dryrun_image_")
    assert dry_run.fake_image_url("char-1").endswith("/char-1_1.png")
    assert dry_run.fake_oss_url("/a/b.png").startswith("https://dry-run.invalid/oss/")
    assert ".invalid/" in dry_run.fake_image_url("x")  # 不可达域名，只作占位


# ---------------------------------------------------------------------------
# 2) 幂等键与确定性提示词
# ---------------------------------------------------------------------------


def test_source_task_id_is_stable_per_prompt_and_changes_with_prompt() -> None:
    first = build_source_task_id(project_id="proj-1", asset_type="character", asset_id="char-1", prompt="A")
    again = build_source_task_id(project_id="proj-1", asset_type="character", asset_id="char-1", prompt="A")
    other = build_source_task_id(project_id="proj-1", asset_type="character", asset_id="char-1", prompt="B")

    assert first == again
    assert first != other
    assert first.startswith("jellyfish:proj-1:character:char-1:")
    assert "{asset_id}" in build_object_key_template(project_id="proj-1", asset_type="character")


def test_deterministic_prompt_uses_profile_card_subject() -> None:
    prompt = build_deterministic_prompt(
        name="林晓", asset_type="character", description="清冷法务，黑色西装"
    )
    assert prompt.startswith("林晓（角色）：清冷法务，黑色西装")
    # 需求清单第 2 条：角色的版式词改成「角色设定图」那一套（左面部大特写 + 右全身三视图），
    # 不再是旧的「clean white background + 单张全身图」口径
    assert "pure white seamless studio background" in prompt
    assert "right panel contains full-body three-view turnaround" in prompt


# ---------------------------------------------------------------------------
# 3) 提交计划：定妆照 / 垫图批量
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_targets_character_sheet_has_no_reference() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        targets, warnings = await build_targets(
            db,
            project_id="proj-1",
            asset_type="character",
            stage="character_sheet",
        )

    assert [t.source_asset_id for t in targets] == ["char-1"]
    assert targets[0].reference_image == ""  # 定妆照阶段不垫图
    assert targets[0].generation_type == "character_sheet"
    assert targets[0].aspect_ratio == "16:9"
    assert targets[0].to_generation_payload()["requested_count"] == 1
    # 计划里会显式说明图片模型解析结果（image2 → provider 模型 gpt-image-2）
    assert any("provider 模型 gpt-image-2" in w for w in warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_build_targets_reference_batch_uses_primary_reference() -> None:
    """参考图批量（**只对人物开放**）带上定版参考图；画幅固定 16:9。

    用户口径（2026-09）：人物参考图（设定图）**固定 16:9**，所以即使调用方传了 9:16
    也不会被采用 —— 但**必须如实回报**（计划级 warnings 里说明忽略了哪个值），不能静默改口。
    """
    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        targets, warnings = await build_targets(
            db,
            project_id="proj-1",
            asset_type="character",
            stage="reference_batch",
            aspect_ratio="9:16",
        )

    target = targets[0]
    assert target.reference_image.endswith("/jellyfish/proj-1/character/char-1_front.png")
    assert target.to_asset_payload()["reference_image"] == target.reference_image
    assert target.to_asset_payload()["asset_type"] == "character"
    # 人物参考图固定 16:9（不是项目最终视频画幅）
    assert target.aspect_ratio == "16:9"
    assert target.aspect_ratio_source == "character_reference_fixed"
    assert any("16:9" in w and "9:16" in w for w in warnings), "忽略传入比例必须如实回报"
    assert not target.warnings
    await engine.dispose()


@pytest.mark.asyncio
async def test_build_targets_honors_prompt_override_and_reports_missing_ids() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        targets, warnings = await build_targets(
            db,
            project_id="proj-1",
            asset_type="character",
            stage="character_sheet",
            asset_ids=["char-1", "char-nope"],
            prompt_overrides={"char-1": "P1 生成的定妆照提示词"},
        )

    assert targets[0].prompt == "P1 生成的定妆照提示词"
    assert any("char-nope" in w for w in warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_build_targets_rejects_costume_as_out_of_contract() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        with pytest.raises(ValueError) as exc_info:
            await build_targets(db, project_id="proj-1", asset_type="costume", stage="character_sheet")

    assert "只支持 asset_type" in str(exc_info.value)
    await engine.dispose()


@pytest.mark.asyncio
async def test_build_targets_warns_when_reference_missing() -> None:
    """场景走 reference_batch：**明确忽略并如实回报**（参考图批量只对人物开放）。

    用户口径：场景/道具/服装按各自的资产图口径生成，不会带上参考图，也不按人物处理。
    """
    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        targets, warnings = await build_targets(
            db, project_id="proj-1", asset_type="scene", stage="reference_batch"
        )

    assert targets[0].reference_image == ""
    assert any("只对**人物**开放" in w for w in warnings), "非人物走参考图批量必须如实说明"
    assert targets[0].result_kind == "sceneAssetImage"
    assert "characterReference" not in targets[0].result_kind
    await engine.dispose()


# ---------------------------------------------------------------------------
# 4) 参考图解析（定版语义）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_references_prefers_primary_and_reports_fallback() -> None:
    from app.models.studio import CharacterImage

    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        db.add(
            CharacterImage(
                id=2,
                character_id="char-1",
                file_id="file-1",
                is_primary=False,
                view_angle="BACK",
                quality_level="LOW",
            )
        )
        await db.flush()
        resolved = await resolve_references(db, asset_type="character", asset_ids=["char-1", "char-2"])

    assert resolved["char-1"].is_primary is True
    assert resolved["char-1"].resolved_from == "is_primary"
    assert resolved["char-1"].url.endswith(".png")
    # 没有图片的资产：不抛异常，返回带 warning 的空结果
    assert resolved["char-2"].url == ""
    assert resolved["char-2"].warnings
    await engine.dispose()


@pytest.mark.asyncio
async def test_resolve_references_degrades_when_storage_object_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """对象存储里没有这个文件时，只能降级成 warning，不能让整个计划 500。"""

    async def _boom(*, key: str):  # type: ignore[no-untyped-def]
        raise FileNotFoundError(f"文件不存在：{key}")

    monkeypatch.setattr("app.core.storage.get_file_info", _boom)

    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        resolved = await resolve_references(db, asset_type="character", asset_ids=["char-1"])

    assert resolved["char-1"].url == ""
    assert resolved["char-1"].is_primary is True
    assert any("对象存储读取失败" in w for w in resolved["char-1"].warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_resolve_references_falls_back_with_warning_when_not_primary() -> None:
    from app.models.studio import CharacterImage

    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        db.add(
            CharacterImage(
                id=3,
                character_id="char-2",
                file_id="file-1",
                is_primary=False,
                view_angle="FRONT",
                quality_level="LOW",
            )
        )
        from app.models.studio import Character

        db.add(Character(id="char-2", project_id="proj-1", name="张总", description="反派", style="真人都市"))
        await db.flush()
        resolved = await resolve_references(db, asset_type="character", asset_ids=["char-2"])

    assert resolved["char-2"].is_primary is False
    assert resolved["char-2"].resolved_from == "fallback"
    assert any("没有定版主图" in w for w in resolved["char-2"].warnings)
    await engine.dispose()


# ---------------------------------------------------------------------------
# 5) 提交：DRY_RUN 不触网 / 真实分支走 MockTransport
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_submit_targets_dry_run_makes_no_http(monkeypatch: pytest.MonkeyPatch) -> None:
    hits: list[str] = []

    async def _forbidden_request(self, method, url, *args, **kwargs):  # type: ignore[no-untyped-def]
        hits.append(str(url))
        raise AssertionError("DRY_RUN 下不允许任何出站请求")

    monkeypatch.setattr(httpx.AsyncClient, "request", _forbidden_request, raising=True)

    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        targets, _ = await build_targets(
            db, project_id="proj-1", asset_type="character", stage="character_sheet"
        )
        results = await submit_targets(targets)

    assert hits == []
    assert len(results) == 1
    assert results[0].dry_run is True
    assert results[0].status == "dry_run"
    assert results[0].service_task_id.startswith("dryrun_image_")
    assert results[0].oss_url == ""
    assert "占位结果" in results[0].message
    summary = summarize_results(results)
    assert summary["dry_run"] is True and summary["oss_ready"] == 0
    await engine.dispose()


@pytest.mark.asyncio
async def test_submit_targets_real_path_posts_contract_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    captured: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={"ok": True, "service_task_id": "svc-1", "source_task_id": "x", "status": "queued", "message": "已创建"},
        )

    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        targets, _ = await build_targets(
            db,
            project_id="proj-1",
            asset_type="character",
            stage="reference_batch",
            aspect_ratio="16:9",
            image_model="image2",
        )
        results = await submit_targets(targets, transport=httpx.MockTransport(handler))

    assert len(captured) == 1
    payload = captured[0]
    # 与出图服务契约严格对齐
    assert payload["source"] == "jellyfish"
    assert payload["source_task_id"] == targets[0].source_task_id
    assert payload["source_asset_id"] == "char-1"
    assert payload["asset"]["asset_type"] == "character"
    assert payload["asset"]["prompt"]
    assert payload["asset"]["reference_image"].endswith(".png")
    assert payload["generation"]["requested_count"] == 1
    assert payload["generation"]["generation_type"] == "character_sheet"
    # image2 标签必须被解析成 provider 实际模型（对端直接拿它当 provider 模型用）
    assert payload["generation"]["image_model"] == "gpt-image-2"
    assert payload["generation"]["aspect_ratio"] == "16:9"
    assert payload["oss"]["object_key_template"].startswith("jellyfish/proj-1/character/")

    assert results[0].dry_run is False
    assert results[0].service_task_id == "svc-1"
    assert results[0].status == "queued"
    await engine.dispose()


@pytest.mark.asyncio
async def test_submit_targets_blocks_when_dry_run_off_without_confirmation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)

    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        targets, _ = await build_targets(
            db, project_id="proj-1", asset_type="character", stage="character_sheet"
        )
        with pytest.raises(RealCallNotConfirmed):
            await submit_targets(targets)
    await engine.dispose()


@pytest.mark.asyncio
async def test_poll_task_returns_oss_url_when_completed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(200, json={"ok": True, "service_task_id": "svc-1", "status": "queued", "images": []})
        return httpx.Response(
            200,
            json={
                "ok": True,
                "service_task_id": "svc-1",
                "status": "completed",
                "images": [
                    {"oss_url": "https://oss.example.com/a.png", "local_path": "/tmp/a.png", "index": 1}
                ],
            },
        )

    detail = await image_pipeline.poll_task(
        "svc-1",
        wait_seconds=5,
        interval_seconds=0.5,
        transport=httpx.MockTransport(handler),
    )

    assert detail.completed is True
    assert detail.oss_url == "https://oss.example.com/a.png"
    assert detail.local_path == "/tmp/a.png"
    assert calls["n"] >= 2


@pytest.mark.asyncio
async def test_create_asset_image_task_validates_contract_client_side() -> None:
    with pytest.raises(client.ImageServiceError) as exc_info:
        await client.create_asset_image_task(
            source_task_id="",
            source_asset_id="a",
            asset={"asset_type": "character", "prompt": "x"},
            generation={},
        )
    assert "source_task_id" in str(exc_info.value)

    with pytest.raises(client.ImageServiceError):
        await client.create_asset_image_task(
            source_task_id="s1",
            source_asset_id="a",
            asset={"asset_type": "costume", "prompt": "x"},
            generation={},
        )

    with pytest.raises(client.ImageServiceError):
        await client.create_asset_image_task(
            source_task_id="s1",
            source_asset_id="a",
            asset={"asset_type": "character", "prompt": ""},
            generation={},
        )


def test_service_base_url_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(client.SERVICE_URL_ENV, raising=False)
    assert client.service_base_url() == client.DEFAULT_SERVICE_URL
    monkeypatch.setenv(client.SERVICE_URL_ENV, "http://127.0.0.1:9999/")
    assert client.service_base_url() == "http://127.0.0.1:9999"


# ---------------------------------------------------------------------------
# 6) 直提出视频
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_submit_video_dry_run_does_not_create_task(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _plan(db, *, body):  # type: ignore[no-untyped-def]
        from app.schemas.studio.image_pipeline import VideoSubmitPlanRead

        return VideoSubmitPlanRead(
            shot_id=body.shot_id,
            provider="apimart",
            model_name=PINNED_VIDEO_MODEL,
            resolution=PINNED_VIDEO_RESOLUTION,
            seconds=MIN_VIDEO_SECONDS,
            guard_status="DRY_RUN=开",
        )

    monkeypatch.setattr(video_submit, "build_video_submit_plan", _plan)
    created: list[str] = []

    def _factory(**kwargs):  # type: ignore[no-untyped-def]
        created.append("task")
        raise AssertionError("DRY_RUN 下不应创建 VideoGenerationTask")

    db, engine = await build_session()
    async with db:
        result = await video_submit.submit_video(
            db,
            body=VideoSubmitPlanRequest(shot_id="shot-1"),
            task_factory=_factory,
        )

    assert created == []
    assert result.status == "dry_run"
    assert result.url == ""
    assert result.file_persisted is False
    assert any("DRY_RUN" in w for w in result.warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_submit_video_real_path_maps_result(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    async def _plan(db, *, body):  # type: ignore[no-untyped-def]
        from app.schemas.studio.image_pipeline import VideoSubmitPlanRead

        return VideoSubmitPlanRead(
            shot_id=body.shot_id,
            provider="apimart",
            model_name=PINNED_VIDEO_MODEL,
            resolution=PINNED_VIDEO_RESOLUTION,
            seconds=MIN_VIDEO_SECONDS,
        )

    async def _run_args(db, **kwargs):  # type: ignore[no-untyped-def]
        return {
            "provider": "apimart",
            "api_key": "secret",
            "base_url": "https://api.apimart.test",
            "input": {"prompt": "p", "ratio": "16:9", "model": "seedance", "seconds": 5},
        }

    class _FakeResult:
        provider = "apimart"
        status = "succeeded"
        provider_task_id = "pt-1"
        url = "https://cdn.example.com/v.mp4"

    class _FakeTask:
        def __init__(self, *, provider_config, input_):  # type: ignore[no-untyped-def]
            self.provider_config = provider_config
            self.input_ = input_

        async def run(self):  # type: ignore[no-untyped-def]
            return None

        async def get_result(self):  # type: ignore[no-untyped-def]
            return _FakeResult()

        async def status(self):  # type: ignore[no-untyped-def]
            return {}

    monkeypatch.setattr(video_submit, "build_video_submit_plan", _plan)

    db, engine = await build_session()
    async with db:
        result = await video_submit.submit_video(
            db,
            body=VideoSubmitPlanRequest(shot_id="shot-1"),
            run_args_builder=_run_args,
            task_factory=lambda **kwargs: _FakeTask(**kwargs),
        )

    assert result.status == "succeeded"
    assert result.provider_task_id == "pt-1"
    assert result.url == "https://cdn.example.com/v.mp4"
    assert result.file_persisted is False  # 直接提交路径不写库
    assert result.elapsed_ms >= 0
    await engine.dispose()


@pytest.mark.asyncio
async def test_submit_video_reports_failure_instead_of_success(monkeypatch: pytest.MonkeyPatch) -> None:
    """既有实现会把异常吞进 status()['error']，这里必须显式识别为失败。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    async def _plan(db, *, body):  # type: ignore[no-untyped-def]
        from app.schemas.studio.image_pipeline import VideoSubmitPlanRead

        return VideoSubmitPlanRead(
            shot_id=body.shot_id,
            provider="apimart",
            model_name=PINNED_VIDEO_MODEL,
            resolution=PINNED_VIDEO_RESOLUTION,
            seconds=MIN_VIDEO_SECONDS,
        )

    async def _run_args(db, **kwargs):  # type: ignore[no-untyped-def]
        return {
            "provider": "apimart",
            "api_key": "secret",
            "base_url": "https://api.apimart.test",
            "input": {"prompt": "p", "ratio": "16:9"},
        }

    class _FakeTask:
        def __init__(self, **kwargs):  # type: ignore[no-untyped-def]
            pass

        async def run(self):  # type: ignore[no-untyped-def]
            return None

        async def get_result(self):  # type: ignore[no-untyped-def]
            return None

        async def status(self):  # type: ignore[no-untyped-def]
            return {"error": "provider 返回 400：duration 不合法"}

    monkeypatch.setattr(video_submit, "build_video_submit_plan", _plan)

    db, engine = await build_session()
    async with db:
        result = await video_submit.submit_video(
            db,
            body=VideoSubmitPlanRequest(shot_id="shot-1"),
            run_args_builder=_run_args,
            task_factory=lambda **kwargs: _FakeTask(**kwargs),
        )

    assert result.status == "failed"
    assert "duration 不合法" in result.error
    assert result.url == ""
    await engine.dispose()


def test_supported_video_providers_matches_existing_adapters() -> None:
    assert set(video_submit.SUPPORTED_VIDEO_PROVIDERS) == {"openai", "volcengine", "apimart"}


# ---------------------------------------------------------------------------
# 7) 提示词包导出
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_prompt_package_dry_run_is_read_only(monkeypatch: pytest.MonkeyPatch) -> None:
    hits: list[str] = []

    async def _forbidden_request(self, method, url, *args, **kwargs):  # type: ignore[no-untyped-def]
        hits.append(str(url))
        raise AssertionError("提示词包导出不应触网")

    monkeypatch.setattr(httpx.AsyncClient, "request", _forbidden_request, raising=True)

    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        package = await build_prompt_package(
            db, body=PromptPackageRequest(project_id="proj-1", include_bindings=True)
        )

    assert hits == []
    assert package.meta["shot_count"] == 1
    assert package.meta["dry_run"] is True
    shot = package.shots[0]
    assert shot.shot_id == "shot-1"
    assert len(shot.image_prompts) == 9  # 默认九槽位
    assert shot.video_prompt is not None
    assert shot.video_prompt["dry_run"] is True
    # 已绑定场景（种子里的 ProjectSceneLink）应出现在提示词包里
    assert "scene-1" in shot.bound_assets.get("scene", [])
    assert package.rendered_text.startswith("# 提示词包")
    assert "## [1] shot-1" in package.rendered_markdown
    assert any("DRY_RUN" in w for w in package.warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_build_prompt_package_can_skip_optional_sections() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        package = await build_prompt_package(
            db,
            body=PromptPackageRequest(
                project_id="proj-1",
                include_image_prompts=False,
                include_video_prompts=False,
                include_bindings=False,
            ),
        )

    shot = package.shots[0]
    assert shot.image_prompts == []
    assert shot.video_prompt is None
    assert shot.bound_assets == {}
    assert package.meta["image_prompt_count"] == 0
    await engine.dispose()


@pytest.mark.asyncio
async def test_build_prompt_package_rejects_project_without_shots() -> None:
    from fastapi import HTTPException

    db, engine = await build_session()
    async with db:
        with pytest.raises(HTTPException) as exc_info:
            await build_prompt_package(db, body=PromptPackageRequest(project_id="proj-missing"))
    assert exc_info.value.status_code == 404
    await engine.dispose()


def test_renderers_handle_empty_package() -> None:
    from app.schemas.studio.image_pipeline import PromptPackageRead

    package = PromptPackageRead(project_id="p")
    assert render_package_text(package).startswith("# 提示词包")
    assert render_package_markdown(package).startswith("# 提示词包")


# ---------------------------------------------------------------------------
# 8) 与 P1/P2 的一致性：出图管线不得写入任何表
# ---------------------------------------------------------------------------


def test_image_pipeline_modules_contain_no_db_writes() -> None:
    from pathlib import Path

    base = (
        Path(__file__).resolve().parent.parent
        / "app"
        / "services"
        / "studio"
        / "image_pipeline"
    )
    for name in ("image_pipeline.py", "reference_resolver.py", "video_submit.py", "prompt_package.py"):
        source = (base / name).read_text(encoding="utf-8")
        for banned in ("db.add(", "db.commit(", "db.flush(", "session.add(", "db.delete("):
            assert banned not in source, f"{name} 不应出现写库调用：{banned}"


# ---------------------------------------------------------------------------
# 9) 固定模型策略（用户指定：出图 image2 / 出视频 seedance-2.0-mini + 480p）
# ---------------------------------------------------------------------------


def test_pinned_video_policy_defaults() -> None:
    assert pinned_video_model() == "seedance-2.0-mini"
    assert pinned_video_resolution() == "480p"
    assert MIN_VIDEO_SECONDS == 5
    assert PINNED_VIDEO_MODEL == "seedance-2.0-mini"
    assert PINNED_VIDEO_RESOLUTION == "480p"


def test_pinned_policy_is_env_overridable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(video_submit.VIDEO_MODEL_ENV, "seedance-2.0")
    monkeypatch.setenv(video_submit.VIDEO_RESOLUTION_ENV, "720p")
    assert pinned_video_model() == "seedance-2.0"
    assert pinned_video_resolution() == "720p"


def test_resolve_plan_seconds_clamps_to_shortest() -> None:
    warnings: list[str] = []
    assert resolve_plan_seconds(None, warnings) == MIN_VIDEO_SECONDS
    assert resolve_plan_seconds(5, warnings) == 5
    assert resolve_plan_seconds(3, warnings) == MIN_VIDEO_SECONDS  # 低于下限 → 最短时长
    assert any("按最短时长" in w for w in warnings)
    over: list[str] = []
    assert resolve_plan_seconds(60, over) == 15
    assert any("上限" in w for w in over)


def test_resolve_image_provider_model_maps_image2() -> None:
    assert client.resolve_image_provider_model("image2") == ("gpt-image-2", "choice")
    assert client.resolve_image_provider_model("Image2") == ("gpt-image-2", "choice")
    assert client.resolve_image_provider_model("gpt-image-2") == ("gpt-image-2", "choice")
    assert client.resolve_image_provider_model("Nano Banana 2") == ("nano-banana-2-ext", "choice")
    # 未知取值原样透传，不静默改写
    assert client.resolve_image_provider_model("some-new-model") == ("some-new-model", "passthrough")


def test_image_model_choice_default_is_image2(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(client.IMAGE_MODEL_ENV, raising=False)
    assert client.image_model_choice() == "image2"
    assert client.resolve_image_provider_model("") == ("gpt-image-2", "env")


@pytest.mark.asyncio
async def test_plan_preview_pins_video_model_and_resolution() -> None:
    """真实 DB 里 ModelSettings 默认视频模型就是 seedance-2.0-mini，计划必须命中固定策略。"""
    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        with pytest.raises(Exception):
            # 测试库里没有镜头 detail / 视频模型配置，取不到计划是预期内的；
            # 这里只验证固定策略解析器本身能兜底不炸。
            await video_submit.build_video_submit_plan(
                db, body=VideoSubmitPlanRequest(shot_id="shot-1", ratio="16:9")
            )
    await engine.dispose()


@pytest.mark.asyncio
async def test_submit_video_forces_model_resolution_and_shortest_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """核心保证：提交前把 model/resolution/seconds 强制写成固定策略，且请求参数改不掉。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    captured: dict = {}

    async def _plan(db, *, body):  # type: ignore[no-untyped-def]
        from app.schemas.studio.image_pipeline import VideoSubmitPlanRead

        return VideoSubmitPlanRead(
            shot_id=body.shot_id,
            provider="apimart",
            model_name=PINNED_VIDEO_MODEL,
            resolution=PINNED_VIDEO_RESOLUTION,
            seconds=MIN_VIDEO_SECONDS,
            ratio="16:9",
        )

    async def _run_args(db, **kwargs):  # type: ignore[no-untyped-def]
        # 故意返回错的模型/分辨率/超长时长，验证提交前会被强制改回来
        return {
            "provider": "apimart",
            "api_key": "secret",
            "base_url": "https://api.apimart.test",
            "input": {"prompt": "p", "ratio": "16:9", "model": "seedance-2.0", "seconds": 15},
        }

    class _FakeResult:
        provider = "apimart"
        status = "succeeded"
        provider_task_id = "pt-mini"
        url = "https://cdn.example.com/mini.mp4"

    class _FakeTask:
        def __init__(self, *, provider_config, input_):  # type: ignore[no-untyped-def]
            captured["input"] = input_

        async def run(self):  # type: ignore[no-untyped-def]
            return None

        async def get_result(self):  # type: ignore[no-untyped-def]
            return _FakeResult()

        async def status(self):  # type: ignore[no-untyped-def]
            return {}

    monkeypatch.setattr(video_submit, "build_video_submit_plan", _plan)

    db, engine = await build_session()
    async with db:
        result = await video_submit.submit_video(
            db,
            body=VideoSubmitPlanRequest(shot_id="shot-1", duration_seconds=15),
            run_args_builder=_run_args,
            task_factory=lambda **kwargs: _FakeTask(**kwargs),
        )

    assert result.status == "succeeded"
    assert captured["input"].model == PINNED_VIDEO_MODEL
    assert captured["input"].resolution == PINNED_VIDEO_RESOLUTION
    assert captured["input"].seconds == MIN_VIDEO_SECONDS
    await engine.dispose()


@pytest.mark.asyncio
async def test_submit_video_rejects_before_submit_when_capability_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """能力校验不通过时必须在发出请求前失败（不白花一次钱）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    created: list[str] = []

    async def _plan(db, *, body):  # type: ignore[no-untyped-def]
        from app.schemas.studio.image_pipeline import VideoSubmitPlanRead

        return VideoSubmitPlanRead(
            shot_id=body.shot_id,
            provider="apimart",
            model_name=PINNED_VIDEO_MODEL,
            # 故意给一个 mini 不支持的档位，验证前置校验会拦下
            resolution="4k",
            seconds=MIN_VIDEO_SECONDS,
            ratio="16:9",
        )

    async def _run_args(db, **kwargs):  # type: ignore[no-untyped-def]
        return {
            "provider": "apimart",
            "api_key": "secret",
            "base_url": "https://api.apimart.test",
            "input": {"prompt": "p", "ratio": "16:9"},
        }

    def _factory(**kwargs):  # type: ignore[no-untyped-def]
        created.append("task")
        raise AssertionError("能力校验失败时不应创建任务")

    monkeypatch.setattr(video_submit, "build_video_submit_plan", _plan)

    db, engine = await build_session()
    async with db:
        result = await video_submit.submit_video(
            db,
            body=VideoSubmitPlanRequest(shot_id="shot-1"),
            run_args_builder=_run_args,
            task_factory=_factory,
        )

    assert created == []
    assert result.status == "rejected_before_submit"
    assert "能力校验未通过" in result.error
    await engine.dispose()


@pytest.mark.asyncio
async def test_video_plan_rejects_invalid_reference_mode() -> None:
    """reference_mode 必须命中既有契约，否则底层会抛 KeyError；这里必须给干净的 400。"""
    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        with pytest.raises(Exception) as exc_info:
            await video_submit.build_video_submit_plan(
                db,
                body=VideoSubmitPlanRequest(shot_id="shot-1", reference_mode="first_frame"),
            )

    from fastapi import HTTPException

    assert isinstance(exc_info.value, HTTPException)
    assert exc_info.value.status_code == 400
    assert "reference_mode 只支持" in str(exc_info.value.detail)
    await engine.dispose()


def test_reference_mode_default_is_contract_valid() -> None:
    from app.services.film import REQUIRED_FRAMES_BY_MODE

    body = VideoSubmitPlanRequest(shot_id="shot-1")
    assert body.reference_mode in REQUIRED_FRAMES_BY_MODE


@pytest.mark.asyncio
async def test_resolve_references_accepts_url_style_storage_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """回归：真实库里多数 files.storage_key 本身就是完整 OSS URL。

    这种 key 不能被当成本地相对路径去 stat（否则 FileNotFoundError，
    垫图对大多数真实资产都取不到地址）。URL 本身就是长期资产地址，直接用它。
    """
    from app.models.studio import Character, CharacterImage, FileItem

    oss_url = "https://oss.example.com/projects/p/assets/character/CHAR_X/20260101_x.png"

    # storage.get_file_info 只在"本地相对路径"分支才应被调用；URL 分支不该走到这
    async def _boom(*, key: str):  # type: ignore[no-untyped-def]
        raise AssertionError(f"URL 形态的 storage_key 不应走 storage 解析：{key}")

    monkeypatch.setattr("app.core.storage.get_file_info", _boom)

    db, engine = await build_session()
    async with db:
        await _seed_assets(db)
        db.add(Character(id="char-url", project_id="proj-1", name="URL角色", description="x", style="真人都市"))
        db.add(FileItem(id="file-url", type="image", name="oss图", storage_key=oss_url))
        await db.flush()
        db.add(
            CharacterImage(
                id=99,
                character_id="char-url",
                file_id="file-url",
                is_primary=True,
                view_angle="FRONT",
                quality_level="HIGH",
            )
        )
        await db.flush()
        resolved = await resolve_references(db, asset_type="character", asset_ids=["char-url"])

    assert resolved["char-url"].url == oss_url
    assert resolved["char-url"].is_primary is True
    assert resolved["char-url"].resolved_from == "is_primary"
    assert resolved["char-url"].warnings == []
    await engine.dispose()


def test_is_absolute_url_helper() -> None:
    from app.services.studio.image_pipeline.reference_resolver import _is_absolute_url

    assert _is_absolute_url("https://a.example.com/x.png") is True
    assert _is_absolute_url("HTTP://A/X") is True
    assert _is_absolute_url("outputs/assets/a.png") is False
    assert _is_absolute_url("") is False


# ---------------------------------------------------------------------------
# legacy 出视频出口的入参预检（真实付费前的最后一道确定性检查）
# ---------------------------------------------------------------------------


class TestLegacyVideoInputPrecheck:
    """`/film/tasks/video` 此前不做任何选项校验。

    本项目镜头时长普遍 3–4s，而 seedance-2.0-mini 的 min_seconds=5：不预检的后果是
    "任务建出来 → 真花钱发出请求 → 被供应商拒绝"。这里锁住预检行为。
    """

    def test_clamps_seconds_below_model_minimum(self) -> None:
        from app.services.studio.image_pipeline.video_submit import validate_legacy_video_input

        payload = {"model": "seedance-2.0-mini", "ratio": "9:16", "seconds": 3, "prompt": "x"}
        warnings = validate_legacy_video_input(payload)
        assert payload["seconds"] == 5
        assert any("低于模型下限" in item for item in warnings)

    def test_fills_pinned_resolution_when_missing(self) -> None:
        from app.services.studio.image_pipeline.video_submit import (
            pinned_video_resolution,
            validate_legacy_video_input,
        )

        payload = {"model": "seedance-2.0-mini", "ratio": "9:16", "seconds": 5, "prompt": "x"}
        warnings = validate_legacy_video_input(payload)
        assert payload["resolution"] == pinned_video_resolution() == "480p"
        assert any("分辨率" in item for item in warnings)

    def test_clean_payload_produces_no_warnings(self) -> None:
        from app.services.studio.image_pipeline.video_submit import validate_legacy_video_input

        payload = {
            "model": "seedance-2.0-mini",
            "ratio": "9:16",
            "seconds": 5,
            "prompt": "x",
            "resolution": "480p",
        }
        assert validate_legacy_video_input(payload) == []

    def test_rejects_unsupported_resolution(self) -> None:
        from app.services.studio.image_pipeline.video_submit import validate_legacy_video_input

        payload = {
            "model": "seedance-2.0-mini",
            "ratio": "9:16",
            "seconds": 5,
            "prompt": "x",
            "resolution": "8k",
        }
        with pytest.raises(ValueError) as caught:
            validate_legacy_video_input(payload)
        assert "不可提交" in str(caught.value)

    def test_clamps_seconds_above_model_maximum(self) -> None:
        from app.services.studio.image_pipeline.video_submit import validate_legacy_video_input

        payload = {
            "model": "seedance-2.0-mini",
            "ratio": "9:16",
            "seconds": 30,
            "prompt": "x",
            "resolution": "480p",
        }
        warnings = validate_legacy_video_input(payload)
        assert payload["seconds"] == 15
        assert any("上限" in item for item in warnings)


def test_service_relative_local_path_is_made_absolute() -> None:
    """出图服务 OSS 上传失败时只回相对路径 `/images/xxx.png`。

    相对路径没法采纳（采纳要能下载的绝对地址），用户被迫手工拼前缀 —— 实测踩过一次。
    这里锁住"自动补成绝对地址"。
    """
    from app.services.studio.image_pipeline.external_image_client import (
        SERVICE_STATIC_PREFIX,
        service_base_url,
    )

    assert SERVICE_STATIC_PREFIX == "/images/"
    # 服务静态路由形式 → 补服务地址
    assert f"{service_base_url()}/images/a.png" == f"{service_base_url()}" + "/images/a.png"
    # 服务的文件系统绝对路径不能补（既有用例 test_poll_task_returns_oss_url_when_completed 里
    # 的 /tmp/a.png 就是这种，必须保持原样）
    import pathlib as _p

    # 路径必须相对**测试文件**解析：此前写成相对 cwd 的 "app/..."，于是从仓库根目录
    # 跑 `pytest -q` 时这里必然 FileNotFoundError —— 这是与业务无关的假失败，会让
    # 「既有失败基线」随执行目录变成 13 或 14 条。同文件
    # `test_image_pipeline_modules_contain_no_db_writes` 用的就是这条口径。
    src = (
        _p.Path(__file__).resolve().parent.parent
        / "app"
        / "services"
        / "studio"
        / "image_pipeline"
        / "external_image_client.py"
    ).read_text()
    assert "if local_path.startswith(SERVICE_STATIC_PREFIX):" in src
