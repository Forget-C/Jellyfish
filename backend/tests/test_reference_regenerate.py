"""「使用已有参考图重新生成」（可选返工）端点回归测试。

守的是用户明确要求的三件事：

1. **默认安全**：参考图不是**公网**地址（本机相对路径 / 内网地址）或**匿名不可达**（404）
   → 409 + 结构化中文错误（哪个资产 / 真实状态码 / 怎么修 / ``paid_call_made:false``），
   **不提交、不写库、一次出网都没有**（付费通道的 transport 一律「任何请求即 AssertionError」）；
2. **参考图真的进请求**：公网可达时，用 ``httpx.MockTransport`` 捕获**真实请求体**，
   断言 APIMart 通道的 ``image_urls`` 里就是那张公网参考图（不是本地地址、不是被悄悄丢掉）；
3. **不重复付费**：同一资产同一提示词同一 ``attempt`` 重复提交 → 复用同一个
   ``source_task_id``、只发一次请求；``attempt`` 递增 → 得到新键、才会真的再提交一次。

另外钉住 DRY_RUN 分支：返回占位、零出网。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator, Iterator

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app
from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider, ProviderStatus
from app.models.studio import (
    Character,
    CharacterImage,
    Costume,
    CostumeImage,
    FileItem,
    Project,
    ProjectCostumeLink,
    ProjectPropLink,
    ProjectSceneLink,
    Prop,
    PropImage,
    Scene,
    SceneImage,
)
from app.models.task import GenerationTask
from app.schemas.studio.image_pipeline import ReferenceRegenerateRequest
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.image_pipeline.image_pipeline import (
    ASSET_TYPE_ZH,
    DEFAULT_ASPECT_RATIO,
    build_source_task_id,
)
from app.services.studio.image_pipeline.reference_regenerate import (
    ERROR_PROVIDER_NOT_APIMART,
    ERROR_REFERENCE_UNAVAILABLE,
    clear_regenerate_registry,
    regenerate_with_existing_reference,
)
from tests.llm_orchestration_fixtures import build_session

ROUTE_URL = "/api/v1/studio/image-pipeline/reference-regenerate"
DRY_RUN_ENV = "JELLYFISH_DRY_RUN"
CONFIRM_ENV = "JELLYFISH_REAL_LLM_CONFIRMED"
POLL_INTERVAL_ENV = "JELLYFISH_APIMART_IMAGE_POLL_INTERVAL"

#: 参考图的**公网**地址（storage_key 本身就是完整 URL —— 解析器直接用它，不碰对象存储）
REF_URL = "https://oss.example.com/refs/char-1-front.png"
SAVED_PROMPT = "林晓，黑色西装，正面定妆参考图，干净背景"


@pytest.fixture(autouse=True)
def _no_real_storage_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    """测试期一个字节都不出网：`with TestClient(app)` 会跑 lifespan，把对象存储初始化换掉。"""
    import app.main as main_module

    monkeypatch.setattr(main_module, "init_storage", lambda: None)


@pytest.fixture(autouse=True)
def _reset_registry() -> Iterator[None]:
    """进程内幂等登记是模块级状态：每个用例前后清空，避免用例之间互相影响。"""
    clear_regenerate_registry()
    yield
    clear_regenerate_registry()


# ---------------------------------------------------------------------------
# 桩：两个「零真实出网」的 transport
# ---------------------------------------------------------------------------


def _forbidden_transport(*, hits: list[str] | None = None) -> httpx.MockTransport:
    """任何请求都直接 AssertionError —— 用来证明「这条通道一个字节都没出网」。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if hits is not None:
            hits.append(f"{request.method} {request.url}")
        raise AssertionError(f"不允许出网：{request.method} {request.url}")

    return httpx.MockTransport(handler)


def _status_transport(status: int, *, hits: list[str] | None = None) -> httpx.MockTransport:
    """探活桩：固定状态码（http 层是 stub，不产生真实流量）。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if hits is not None:
            hits.append(f"{request.method} {request.url}")
        return httpx.Response(status)

    return httpx.MockTransport(handler)


def _apimart_transport(
    *,
    bodies: list[dict],
    urls: list[str],
    image_url: str = "https://cdn.example.com/regenerated.png",
) -> httpx.MockTransport:
    """APIMart 通道桩：捕获**真实请求体**，并按协议返回 task_id / 完成结果。"""

    def handler(request: httpx.Request) -> httpx.Response:
        urls.append(str(request.url))
        if request.method == "POST":
            bodies.append(json.loads(request.content or b"{}"))
            return httpx.Response(
                200, json={"code": 200, "data": {"task_id": "task_ref_1", "status": "submitted"}}
            )
        return httpx.Response(
            200, json={"code": 200, "data": {"status": "completed", "images": [{"url": image_url}]}}
        )

    return httpx.MockTransport(handler)


def _preflight_with(transport: httpx.MockTransport):
    """把真实预检实现接上测试 transport（生产接的是 ``preflight_guard``）。"""

    async def _preflight(candidates, *, hint=""):  # type: ignore[no-untyped-def]
        return await reference_preflight.preflight_or_raise(candidates, hint=hint, transport=transport)

    return _preflight


# ---------------------------------------------------------------------------
# 种子数据
# ---------------------------------------------------------------------------


async def _seed_asset(
    db: AsyncSession,
    *,
    storage_key: str = REF_URL,
    with_file: bool = True,
    saved_prompt: str = SAVED_PROMPT,
) -> None:
    db.add(Project(id="proj-1", name="测试项目", description="", style="真人古装", visual_style="现实"))
    db.add(
        Character(
            id="char-1",
            project_id="proj-1",
            name="林晓",
            description="女主",
            style="真人都市",
            image_prompts={"character_image_front": saved_prompt} if saved_prompt else {},
        )
    )
    if with_file:
        db.add(
            FileItem(
                id="file-ref",
                type="image",
                name="林晓定版.png",
                thumbnail=storage_key,
                storage_key=storage_key,
            )
        )
        await db.flush()
    db.add(
        CharacterImage(
            id=1,
            character_id="char-1",
            file_id="file-ref" if with_file else None,
            is_primary=with_file,
            view_angle="FRONT",
            quality_level="HIGH",
        )
    )
    await db.flush()


async def _seed_llm(db: AsyncSession, *, provider_name: str = "apimart") -> None:
    """把「默认图片模型」配到指定供应商（生产库里由 DB 配置决定）。"""
    db.add(
        Provider(
            id="prov-1",
            name=provider_name,
            base_url="https://api.apimart.ai/v1",
            api_key="test-key-not-real",
            description="测试种子",
            status=ProviderStatus.active,
            created_by="test",
        )
    )
    await db.flush()
    db.add(
        Model(
            id="model-1",
            name="gpt-image-2",
            category=ModelCategoryKey.image,
            provider_id="prov-1",
            params={},
            description="测试种子",
            created_by="test",
        )
    )
    await db.flush()
    db.add(ModelSettings(id=1, default_image_model_id="model-1"))
    await db.flush()


def _body(**overrides: object) -> ReferenceRegenerateRequest:
    payload: dict[str, object] = {
        "project_id": "proj-1",
        "asset_type": "character",
        "asset_id": "char-1",
        "prompt": "林晓，黑色西装，正面定妆参考图",
        "reference_url": REF_URL,
    }
    payload.update(overrides)
    return ReferenceRegenerateRequest.model_validate(payload)


async def _count(db: AsyncSession, model: type) -> int:
    return len((await db.execute(select(model))).scalars().all())


async def _db_counts(db: AsyncSession) -> tuple[int, int, int]:
    return (
        await _count(db, FileItem),
        await _count(db, CharacterImage),
        await _count(db, GenerationTask),
    )


# ---------------------------------------------------------------------------
# 1) 参考图不可用 → 409 + 结构化 + 零出网 + 零写库
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_relative_path_reference_is_rejected_without_any_outbound() -> None:
    """本机相对路径：出网前就判死（409），付费通道与探活通道都没有被碰过、库里一行没改。"""
    db, engine = await build_session()
    paid_hits: list[str] = []
    probe_hits: list[str] = []
    async with db:
        await _seed_asset(db)
        await _seed_llm(db)
        before = await _db_counts(db)

        with pytest.raises(HTTPException) as exc_info:
            await regenerate_with_existing_reference(
                db,
                body=_body(reference_url="jellyfish/acceptance/files/char-1-front.png"),
                transport=_forbidden_transport(hits=paid_hits),
                preflight=_preflight_with(_status_transport(200, hits=probe_hits)),
            )

        exc = exc_info.value
        assert exc.status_code == 409
        detail = exc.detail
        assert detail["code"] == ERROR_REFERENCE_UNAVAILABLE
        assert "公网" in detail["message"] and "没有产生任何付费调用" in detail["message"]
        assert detail["paid_call_made"] is False
        assert detail["how_to_fix"]
        assert detail["reference_source"] == "explicit_url"
        assert paid_hits == [] and probe_hits == []
        assert await _db_counts(db) == before
    await engine.dispose()


@pytest.mark.asyncio
async def test_loopback_reference_is_rejected_by_preflight(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """内网地址：由既有匿名预检拦下（409），一次真实出网都没有。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    db, engine = await build_session()
    paid_hits: list[str] = []
    probe_hits: list[str] = []
    async with db:
        await _seed_asset(db)
        await _seed_llm(db)
        before = await _db_counts(db)

        with pytest.raises(reference_preflight.ReferencePreflightBlocked) as exc_info:
            await regenerate_with_existing_reference(
                db,
                body=_body(reference_url="http://127.0.0.1:8000/files/char-1-front.png"),
                transport=_forbidden_transport(hits=paid_hits),
                preflight=_preflight_with(_status_transport(200, hits=probe_hits)),
            )

        detail = exc_info.value.detail
        assert detail["code"] == reference_preflight.UNREACHABLE_ERROR_CODE
        assert detail["paid_call_made"] is False
        assert detail["unreachable"][0]["result"] == "unreachable"
        assert "林晓" in detail["unreachable"][0]["asset"]
        # 形态不对的地址**不发请求**直接判死
        assert paid_hits == [] and probe_hits == []
        assert await _db_counts(db) == before
    await engine.dispose()


@pytest.mark.asyncio
async def test_gone_object_reference_is_rejected_with_real_status_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """公网地址但对象不存在（404）：409 里带真实状态码与修法，且没有提交、没有写库。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    db, engine = await build_session()
    paid_hits: list[str] = []
    async with db:
        await _seed_asset(db)
        await _seed_llm(db)
        before = await _db_counts(db)

        with pytest.raises(reference_preflight.ReferencePreflightBlocked) as exc_info:
            await regenerate_with_existing_reference(
                db,
                body=_body(reference_url="https://cdn.example.com/gone.png"),
                transport=_forbidden_transport(hits=paid_hits),
                preflight=_preflight_with(_status_transport(404)),
            )

        detail = exc_info.value.detail
        assert detail["paid_call_made"] is False
        assert detail["unreachable"][0]["http_status"] == 404
        assert "404" in detail["unreachable"][0]["reason"]
        assert detail["how_to_fix"]
        assert paid_hits == []  # 付费通道一次都没被碰
        assert await _db_counts(db) == before
    await engine.dispose()


@pytest.mark.asyncio
async def test_asset_without_any_image_returns_structured_409() -> None:
    """该资产压根没有图片（空槽位）：409 + 可操作的修法，零出网。"""
    db, engine = await build_session()
    paid_hits: list[str] = []
    async with db:
        await _seed_asset(db, with_file=False)
        await _seed_llm(db)

        with pytest.raises(HTTPException) as exc_info:
            await regenerate_with_existing_reference(
                db,
                body=_body(reference_url=""),
                transport=_forbidden_transport(hits=paid_hits),
                preflight=_preflight_with(_status_transport(200)),
            )

        detail = exc_info.value.detail
        assert exc_info.value.status_code == 409
        assert detail["code"] == ERROR_REFERENCE_UNAVAILABLE
        assert detail["reference_source"] == "asset_fallback"  # 该资产只有空槽位
        assert "还没有图片" in detail["message"]
        assert detail["paid_call_made"] is False
        assert paid_hits == []
    await engine.dispose()


# ---------------------------------------------------------------------------
# 2) 公网可达 → 参考图真的进 image_urls
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_public_reference_is_actually_sent_as_image_urls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """公网可达：捕获真实请求体，断言 APIMart 的 image_urls 就是那张公网参考图。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    monkeypatch.setenv(POLL_INTERVAL_ENV, "0.05")

    db, engine = await build_session()
    bodies: list[dict] = []
    paid_urls: list[str] = []
    probe_hits: list[str] = []
    async with db:
        await _seed_asset(db)
        await _seed_llm(db)

        data = await regenerate_with_existing_reference(
            db,
            body=_body(),
            transport=_apimart_transport(bodies=bodies, urls=paid_urls),
            preflight=_preflight_with(_status_transport(200, hits=probe_hits)),
        )
    await engine.dispose()

    # 预检确实跑过（真的对那张参考图做过匿名探活）
    assert probe_hits and probe_hits[0].endswith("char-1-front.png")
    # 真实请求体：参考图进的是 APIMart 契约字段 image_urls，且**没有** OpenAI 的 images[]
    assert len(bodies) == 1
    submitted = bodies[0]
    assert paid_urls[0] == "https://api.apimart.ai/v1/images/generations"
    assert submitted["image_urls"] == [REF_URL]
    assert "images" not in submitted
    assert submitted["prompt"] == "林晓，黑色西装，正面定妆参考图"
    assert submitted["model"] == "gpt-image-2"
    assert submitted["size"] == "16:9"

    # 响应与既有出图结果同形
    assert data.paid_call_made is True
    assert data.reference_url == REF_URL
    assert data.reference_source == "explicit_url"
    assert data.deduplicated is False
    result = data.results[0]
    assert result.outcome == "ok" and result.ok is True
    assert result.image_url == "https://cdn.example.com/regenerated.png"
    assert result.oss_url == "" and result.oss_ready is False  # 供应商临时地址不是长期资产地址
    assert result.detail["provider"] == "apimart"
    assert result.detail["reference_image_url"] == REF_URL
    assert result.source_task_id.startswith("jellyfish:proj-1:character:char-1:")
    assert data.summary["total"] == 1 and data.outcome == "ok"


@pytest.mark.asyncio
async def test_reference_slot_id_resolves_its_public_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """按槽位 id 指定参考图 → 解析出该槽位绑定的公网地址（并且进请求）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    monkeypatch.setenv(POLL_INTERVAL_ENV, "0.05")

    db, engine = await build_session()
    bodies: list[dict] = []
    async with db:
        await _seed_asset(db)
        await _seed_llm(db)
        data = await regenerate_with_existing_reference(
            db,
            body=_body(reference_url="", reference_image_id=1),
            transport=_apimart_transport(bodies=bodies, urls=[]),
            preflight=_preflight_with(_status_transport(200)),
        )
    await engine.dispose()

    assert data.reference_image_id == 1
    assert data.reference_source == "slot"
    assert data.reference_url == REF_URL
    assert bodies and bodies[0]["image_urls"] == [REF_URL]


# ---------------------------------------------------------------------------
# 3) DRY_RUN → 占位且零出网
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dry_run_returns_placeholder_and_never_touches_network() -> None:
    db, engine = await build_session()
    paid_hits: list[str] = []
    probe_hits: list[str] = []
    async with db:
        await _seed_asset(db)
        await _seed_llm(db)
        before = await _db_counts(db)

        data = await regenerate_with_existing_reference(
            db,
            body=_body(),
            transport=_forbidden_transport(hits=paid_hits),
            preflight=_preflight_with(_status_transport(200, hits=probe_hits)),
        )

        assert paid_hits == [] and probe_hits == []
        assert await _db_counts(db) == before
    await engine.dispose()

    assert data.paid_call_made is False
    result = data.results[0]
    assert result.dry_run is True and result.outcome == "dry_run"
    assert "dry-run.invalid" in result.image_url and "[DRY_RUN]" in result.message
    assert result.oss_url == "" and data.outcome == "dry_run"


# ---------------------------------------------------------------------------
# 4) 同一轮不重复付费；attempt 递增才换新键
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_same_attempt_is_deduplicated_and_next_attempt_resubmits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    monkeypatch.setenv(POLL_INTERVAL_ENV, "0.05")

    db, engine = await build_session()
    bodies: list[dict] = []
    async with db:
        await _seed_asset(db)
        await _seed_llm(db)
        transport = _apimart_transport(bodies=bodies, urls=[])
        preflight = _preflight_with(_status_transport(200))

        first = await regenerate_with_existing_reference(
            db, body=_body(), transport=transport, preflight=preflight
        )
        # 同一 attempt（同一轮）：不重复提交，直接复用上一轮结果
        second = await regenerate_with_existing_reference(
            db, body=_body(), transport=transport, preflight=preflight
        )
        third = await regenerate_with_existing_reference(
            db, body=_body(attempt=1), transport=transport, preflight=preflight
        )
    await engine.dispose()

    assert len(bodies) == 2, "同一 attempt 重复提交必须只发一次请求"
    assert first.source_task_id == second.source_task_id
    assert second.deduplicated is True and second.paid_call_made is False
    assert any("刚刚已经提交过" in w for w in second.warnings)
    # attempt=1 → 新键（与重试键语义一致）→ 真的再提交一次
    assert third.source_task_id != first.source_task_id
    assert third.source_task_id.endswith(":r1")
    assert third.deduplicated is False


@pytest.mark.asyncio
async def test_keys_match_build_source_task_id_with_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """幂等键就是既有的 ``build_source_task_id``（同一份实现，不另起一套）。"""
    db, engine = await build_session()
    async with db:
        await _seed_asset(db)
        await _seed_llm(db)
        data = await regenerate_with_existing_reference(
            db, body=_body(), transport=_forbidden_transport(), preflight=None
        )
    await engine.dispose()

    assert data.source_task_id == build_source_task_id(
        project_id="proj-1",
        asset_type="character",
        asset_id="char-1",
        prompt="林晓，黑色西装，正面定妆参考图",
        attempt=0,
    )


@pytest.mark.asyncio
async def test_prompt_falls_back_to_saved_image_prompt() -> None:
    """不传 prompt → 用该资产已保存的图片提示词（与默认主流程同一口径）。"""
    db, engine = await build_session()
    async with db:
        await _seed_asset(db)
        data = await regenerate_with_existing_reference(
            db,
            body=_body(prompt=""),
            transport=_forbidden_transport(),
            preflight=None,
        )
    await engine.dispose()

    assert data.prompt == SAVED_PROMPT
    assert data.prompt_source == "saved"
    assert any("已保存的图片提示词" in w for w in data.warnings)


@pytest.mark.asyncio
async def test_missing_prompt_is_rejected() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_asset(db, saved_prompt="")
        with pytest.raises(HTTPException) as exc_info:
            await regenerate_with_existing_reference(
                db, body=_body(prompt=""), transport=_forbidden_transport(), preflight=None
            )
        assert exc_info.value.status_code == 400
        assert "没有可用的提示词" in str(exc_info.value.detail)
    await engine.dispose()


@pytest.mark.asyncio
async def test_non_apimart_provider_is_rejected_before_submitting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """本端点只走 APIMart 通道：图片模型供应商不是 apimart 时明确拒绝，不偷偷换通道。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    db, engine = await build_session()
    async with db:
        await _seed_asset(db)
        await _seed_llm(db, provider_name="openai")
        with pytest.raises(HTTPException) as exc_info:
            await regenerate_with_existing_reference(
                db,
                body=_body(),
                transport=_forbidden_transport(),
                preflight=_preflight_with(_status_transport(200)),
            )
        detail = exc_info.value.detail
        assert exc_info.value.status_code == 409
        assert detail["code"] == ERROR_PROVIDER_NOT_APIMART
        assert detail["provider"] == "openai"
        assert detail["paid_call_made"] is False
        assert "submit" in detail["how_to_fix"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_provider_failure_returns_result_shaped_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """供应商失败 → 返回**同形结果**（ok=false + 原文 + 状态码），而不是断掉整条链路。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    monkeypatch.setenv(POLL_INTERVAL_ENV, "0.05")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"code": 200, "data": {"task_id": "task_bad"}})
        return httpx.Response(500, json={"code": 500, "message": "provider exploded"})

    db, engine = await build_session()
    async with db:
        await _seed_asset(db)
        await _seed_llm(db)
        data = await regenerate_with_existing_reference(
            db,
            body=_body(),
            transport=httpx.MockTransport(handler),
            preflight=_preflight_with(_status_transport(200)),
        )
    await engine.dispose()

    result = data.results[0]
    assert result.ok is False and result.outcome == "failed"
    assert "provider exploded" in result.error_message
    assert result.http_status == 500
    assert data.outcome == "failed"
    assert data.paid_call_made is True  # 这一次确实发生了付费调用（失败也要如实说）


# ---------------------------------------------------------------------------
# 5) 路由层：结构化信封 + DRY_RUN 占位
# ---------------------------------------------------------------------------


def _build():
    import app.models  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    asyncio.run(_create_all(engine))
    return factory, engine


async def _create_all(engine) -> None:  # type: ignore[no-untyped-def]
    from app.core.db import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _override(factory: async_sessionmaker[AsyncSession]):
    async def override_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    return override_db


def _seed_route_data(factory: async_sessionmaker[AsyncSession]) -> None:
    async def run() -> None:
        async with factory() as db:
            await _seed_asset(db)
            await _seed_llm(db)
            await db.commit()

    asyncio.run(run())


def test_route_is_registered_and_dry_run_returns_placeholder() -> None:
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        _seed_route_data(factory)
        with TestClient(app) as client:
            paths = {route.path for route in app.routes if hasattr(route, "path")}
            assert ROUTE_URL in paths

            res = client.post(
                ROUTE_URL,
                json={
                    "project_id": "proj-1",
                    "asset_type": "character",
                    "asset_id": "char-1",
                    "reference_url": REF_URL,
                },
            )
            assert res.status_code == 200, res.text
            data = res.json()["data"]
            assert data["paid_call_made"] is False
            assert data["results"][0]["dry_run"] is True
            assert data["results"][0]["source_task_id"].startswith("jellyfish:proj-1:character:char-1:")
            assert data["reference_label"] and "垫图" not in data["note"]
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_route_returns_structured_409_for_non_public_reference() -> None:
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        _seed_route_data(factory)
        with TestClient(app) as client:
            res = client.post(
                ROUTE_URL,
                json={
                    "project_id": "proj-1",
                    "asset_type": "character",
                    "asset_id": "char-1",
                    "prompt": "林晓正面",
                    "reference_url": "/files/char-1-front.png",
                },
            )
            assert res.status_code == 409, res.text
            body = res.json()
            assert body["code"] == 409 and body["data"] is None
            assert body["meta"]["error"]["code"] == ERROR_REFERENCE_UNAVAILABLE
            assert body["meta"]["error"]["paid_call_made"] is False
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_route_returns_404_for_asset_outside_project() -> None:
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        _seed_route_data(factory)
        with TestClient(app) as client:
            res = client.post(
                ROUTE_URL,
                json={
                    "project_id": "proj-1",
                    "asset_type": "character",
                    "asset_id": "char-not-there",
                    "prompt": "x",
                },
            )
            assert res.status_code == 404, res.text
            assert res.json()["code"] == 404
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


# ---------------------------------------------------------------------------
# 6) 类型分流：人物 = 16:9 人物参考图（且**不是**项目的 default_video_ratio）；
#    场景 / 道具 / 服装 一律按自己的类型出图，绝不挂人物内部类型标签 characterReference
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "project_video_ratio",
    ["9:16", "1:1", "3:4"],
    ids=["project-9-16", "project-1-1", "project-3-4"],
)
@pytest.mark.asyncio
async def test_character_reference_sheet_is_16_9_and_not_the_project_video_ratio(
    monkeypatch: pytest.MonkeyPatch,
    project_video_ratio: str,
) -> None:
    """人物参考图固定 16:9（人物设定图口径），**不能**跟着项目 ``default_video_ratio`` 走。

    项目级默认画幅是**视频**口径（分镜用），人物参考图是**图片**口径，两者不能混。
    这里把项目的 ``default_video_ratio`` 依次设成 9:16 / 1:1 / 3:4，其中 **1:1 与 3:4
    恰好也是 APIMart 支持的图片比例** —— 那才是真正危险的泄漏路径（一个只看「比例是否被
    供应商支持」的实现会把它们直接用掉）。真实请求体里必须始终是 16:9，且那个项目比例
    一个字节都不许出现在请求里。
    """
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    monkeypatch.setenv(POLL_INTERVAL_ENV, "0.05")

    db, engine = await build_session()
    bodies: list[dict] = []
    async with db:
        await _seed_asset(db)
        await _seed_llm(db)
        project = await db.get(Project, "proj-1")
        assert project is not None
        project.default_video_ratio = project_video_ratio
        await db.flush()

        assert str(project.default_video_ratio) != DEFAULT_ASPECT_RATIO, (
            "用例前提：项目 default_video_ratio 必须与人物参考图的 16:9 不同，否则断言没有区分力"
        )

        data = await regenerate_with_existing_reference(
            db,
            body=_body(),
            transport=_apimart_transport(bodies=bodies, urls=[]),
            preflight=_preflight_with(_status_transport(200)),
        )
    await engine.dispose()

    assert data.asset_type == "character"
    assert data.results[0].outcome == "ok"
    assert len(bodies) == 1
    assert bodies[0]["size"] == DEFAULT_ASPECT_RATIO == "16:9", (
        "人物参考图必须是 16:9（人物设定图），不能跟随项目 default_video_ratio"
    )
    assert json.dumps(bodies[0], ensure_ascii=False).count(project_video_ratio) == 0, (
        f"项目级视频画幅 {project_video_ratio} 不得泄漏进人物参考图的出图请求"
    )
    # 正向：一旦响应契约暴露了结果类型标签，人物必须是人物专用那一个
    kind = str(data.results[0].model_dump().get("result_kind", "") or "")
    if kind:
        assert kind == EXPECTED_RESULT_KIND["character"]

    # 中文标签说的是「人物参考图 / 设定图」，不是场景/道具/服装
    assert data.results[0].asset_type == "character"
    assert "人物参考图" in (data.results[0].model_dump().get("result_label") or "人物参考图")


#: 用户口径的结果类型标签（**机器可读**）：``characterReference`` 是人物专用的那一个。
#:
#: 这里直接写死期望值（而不是 import 实现里的常量），是为了让用例钉住的**是用户口径**，
#: 而不是"实现里刚好写了什么"：实现改了名字就该红。
EXPECTED_RESULT_KIND = {
    "character": "characterReference",
    "scene": "sceneAssetImage",
    "prop": "propAssetImage",
    "costume": "costumeDesignImage",
}


#: 场景 / 道具 / 服装 的种子：(asset_type, asset_id, 名称, 提示词槽位, 公网参考图)
NON_CHARACTER_CASES = [
    ("scene", "scene-1", "破庙夜景", "scene_image_front"),
    ("prop", "prop-1", "青铜剑", "prop_image_front"),
    ("costume", "costume-1", "玄色长袍", "costume_image_front"),
]


async def _seed_non_character_asset(
    db: AsyncSession,
    *,
    asset_type: str,
    asset_id: str,
    name: str,
    slot: str,
    storage_key: str,
) -> None:
    """种一个场景/道具/服装资产：项目 + 资产 + 定版参考图 + 项目关联。"""
    spec = {
        "scene": (Scene, SceneImage, ProjectSceneLink, "scene_id"),
        "prop": (Prop, PropImage, ProjectPropLink, "prop_id"),
        "costume": (Costume, CostumeImage, ProjectCostumeLink, "costume_id"),
    }[asset_type]
    asset_model, image_model, link_model, field = spec

    db.add(
        asset_model(
            id=asset_id,
            name=name,
            description="",
            style="真人古装",
            view_count=1,
            tags=[],
            image_prompts={slot: f"{name}，资产参考图，干净背景"},
        )
    )
    file_id = f"file-{asset_id}"
    db.add(
        FileItem(id=file_id, type="image", name=f"{name}.png", thumbnail=storage_key, storage_key=storage_key)
    )
    await db.flush()
    db.add(
        image_model(
            **{
                field: asset_id,
                "file_id": file_id,
                "is_primary": True,
                "view_angle": "FRONT",
                "quality_level": "HIGH",
            }
        )
    )
    db.add(link_model(project_id="proj-1", **{field: asset_id}))
    await db.flush()


@pytest.mark.parametrize(
    ("asset_type", "asset_id", "name", "slot"),
    NON_CHARACTER_CASES,
    ids=[case[0] for case in NON_CHARACTER_CASES],
)
@pytest.mark.asyncio
async def test_non_character_types_are_labelled_by_their_own_type(
    monkeypatch: pytest.MonkeyPatch,
    asset_type: str,
    asset_id: str,
    name: str,
    slot: str,
) -> None:
    """场景/道具/服装按**自己的类型**出图，结果里绝不出现人物内部类型标签 ``characterReference``。

    这三个类型走的是同一个 APIMart 图片通道，但类型口径必须各归各：结果标签说的是
    「场景 / 道具 / 服装」，参考图用的是该资产自己的那张公网图。
    """
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    monkeypatch.setenv(POLL_INTERVAL_ENV, "0.05")

    ref_url = f"https://oss.example.com/refs/{asset_id}-front.png"
    db, engine = await build_session()
    bodies: list[dict] = []
    async with db:
        # 只建项目壳，资产用自己的种法（这三个类型不在 characters 表里）
        db.add(
            Project(
                id="proj-1",
                name="测试项目",
                description="",
                style="真人古装",
                visual_style="现实",
                default_video_ratio="9:16",
            )
        )
        await db.flush()
        await _seed_non_character_asset(
            db,
            asset_type=asset_type,
            asset_id=asset_id,
            name=name,
            slot=slot,
            storage_key=ref_url,
        )
        await _seed_llm(db)

        data = await regenerate_with_existing_reference(
            db,
            body=ReferenceRegenerateRequest.model_validate(
                {"project_id": "proj-1", "asset_type": asset_type, "asset_id": asset_id}
            ),
            transport=_apimart_transport(bodies=bodies, urls=[]),
            preflight=_preflight_with(_status_transport(200)),
        )
    await engine.dispose()

    assert data.asset_type == asset_type
    assert data.asset_id == asset_id
    assert data.prompt_source == "saved" and data.prompt, "缺省提示词必须取该资产已保存的图片提示词"

    result = data.results[0]
    assert result.outcome == "ok"
    assert result.asset_type == asset_type
    # 结果类型标签：自己的类型，且不是人物专属的 stage / 内部 kind
    assert result.stage == "reference_regenerate"
    assert result.stage not in {"character_sheet", "characterReference", "characterVariant"}

    payload = json.dumps(data.model_dump(), ensure_ascii=False)
    assert "characterReference" not in payload, f"{asset_type} 的结果不得挂人物内部类型标签 characterReference"
    assert "characterVariant" not in payload
    assert "character_sheet" not in payload

    # 正向：一旦响应契约暴露了结果类型标签，它必须**是该类型自己的那一个**（不是人物的）
    kind = str(result.model_dump().get("result_kind", "") or "")
    if kind:
        assert kind == EXPECTED_RESULT_KIND[asset_type], (
            f"{asset_type} 的结果类型标签必须是 {EXPECTED_RESULT_KIND[asset_type]}，不能是 {kind}"
        )
        assert kind != EXPECTED_RESULT_KIND["character"]
    label = str(result.model_dump().get("result_label", "") or "")
    if label:
        assert "角色" not in label and "人物" not in label

    # 中文标签说的是自己的类型（不是「角色」）
    assert ASSET_TYPE_ZH[asset_type] in data.reference_label
    assert "角色" not in data.reference_label

    # 该资产自己的那张公网参考图真的进了请求
    assert len(bodies) == 1
    assert bodies[0]["image_urls"] == [ref_url]
    assert bodies[0]["size"] in {"1:1", "3:4", "16:9"}
