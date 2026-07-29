"""既有 API 端点的 v1.1 摄入测试（Step 4.6）。

验证既有请求路径同时接受 schema_version 1.0 与 1.1，且：
- v1 行为与之前完全一致；
- 缺失版本仍产生 missing 错误（422）；
- 未知版本显式 422；
- v1.1-only 字段不会被当作 v1 静默接受；
- 与版本无关的既有请求行为不变。

使用最小 FastAPI app 挂载既有 CAS 路由并覆盖 get_db（内存 SQLite），不新增任何路由。
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.db import Base
from app.crypto_animal_studio.api import router as cas_router
from app.crypto_animal_studio.schemas.episode_package import EpisodePackage, EpisodePackageV11
from app.crypto_animal_studio.schemas.import_request import ImportEpisodeRequest
from app.crypto_animal_studio.schemas.production import (
    CreateProductionJobRequest,
    RetryProductionJobRequest,
)
from app.dependencies import get_db

_REPO_ROOT = Path(__file__).resolve().parents[2]
_V1_SAMPLE = _REPO_ROOT / "samples" / "cas" / "demo_episode.json"
_V11_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "cas" / "ep001_shaped_v11.json"
_PROD_URL = "/api/v1/crypto-animal-studio/production/jobs"


def _v1() -> dict:
    return json.loads(_V1_SAMPLE.read_text(encoding="utf-8"))


def _v11() -> dict:
    return json.loads(_V11_FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """挂载既有 CAS 路由的最小 app；存储根指向 tmp_path。

    生命周期纪律：建表与 engine.dispose() 都放在 app lifespan 内，并以上下文管理器方式
    使用 TestClient，因此 **所有** aiosqlite 连接都在 TestClient 的事件循环里创建与释放。
    若改为在 fixture 里用独立的 ``asyncio.run()`` 建表，连接所属的 worker 线程会绑定到
    一个随后被关闭的事件循环，在 teardown 时抛出 PytestUnhandledThreadExceptionWarning。
    """
    engine = create_async_engine(
        "sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    import app.crypto_animal_studio.production.models  # noqa: F401

    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _get_db() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    @asynccontextmanager
    async def _lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        yield
        await engine.dispose()

    monkeypatch.setenv("CAS_STORAGE_ROOT", str(tmp_path))
    app = FastAPI(lifespan=_lifespan)
    app.include_router(cas_router, prefix="/api/v1/crypto-animal-studio")
    app.dependency_overrides[get_db] = _get_db
    with TestClient(app) as test_client:
        yield test_client


# --------------------------------------------------------------------- #
# 请求模型层：版本分派
# --------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "model,extra",
    [
        (CreateProductionJobRequest, {"project_id": "p"}),
        (RetryProductionJobRequest, {}),
        (ImportEpisodeRequest, {"project_id": "p", "idempotency_key": "k1"}),
    ],
)
def test_request_models_accept_both_versions(model, extra: dict) -> None:
    """三个既有请求模型都接受 1.0 与 1.1，并绑定到正确的模型类。"""
    v1_req = model(episode_package=_v1(), **extra)
    assert type(v1_req.episode_package) is EpisodePackage
    assert v1_req.episode_package.schema_version == "1.0"

    v11_req = model(episode_package=_v11(), **extra)
    assert type(v11_req.episode_package) is EpisodePackageV11
    assert v11_req.episode_package.schema_version == "1.1"
    assert v11_req.episode_package.output is not None  # v1.1 字段未被静默丢弃


def test_v1_payload_not_upgraded_or_mutated() -> None:
    """v1 payload 不被升级也不被修改。"""
    data = _v1()
    original = json.loads(json.dumps(data))
    request = CreateProductionJobRequest(project_id="p", episode_package=data)
    assert data == original
    dumped = request.episode_package.model_dump(mode="json")
    assert dumped["schema_version"] == "1.0"
    for key in ("output", "localization", "fact_card", "market_data", "references", "post_production"):
        assert key not in dumped


# --------------------------------------------------------------------- #
# HTTP 层：既有端点
# --------------------------------------------------------------------- #
def test_existing_endpoint_accepts_v1_exactly_as_before(client: TestClient) -> None:
    """既有端点对 v1 payload 的行为不变（完成一次 mock 生产）。"""
    resp = client.post(_PROD_URL, json={"project_id": "demo", "episode_package": _v1(), "mode": "mock"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "completed"
    assert len(data["shots"]) == len(_v1()["shots"])


def test_existing_endpoint_accepts_full_v11(client: TestClient) -> None:
    """同一端点接受完整 v1.1 payload。"""
    resp = client.post(_PROD_URL, json={"project_id": "demo", "episode_package": _v11(), "mode": "mock"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "completed"
    assert len(data["shots"]) == 4


def test_missing_schema_version_fails_with_missing_error(client: TestClient) -> None:
    """缺失 schema_version → 422，且错误类型仍为 missing。"""
    payload = _v1()
    payload.pop("schema_version")
    resp = client.post(_PROD_URL, json={"project_id": "demo", "episode_package": payload, "mode": "mock"})
    assert resp.status_code == 422
    # 本最小测试 app 未注册 app.main 的异常处理器，因此这里是 FastAPI 默认的
    # {"detail": [...]} 形状；生产环境由 app.main 统一包装为 ApiResponse。
    body = json.dumps(resp.json(), ensure_ascii=False)
    assert "schema_version" in body and "missing" in body


def test_unknown_schema_version_fails_422(client: TestClient) -> None:
    """未知版本 → 显式 422（不被强制升级为 1.1）。"""
    payload = _v1()
    payload["schema_version"] = "2.0"
    resp = client.post(_PROD_URL, json={"project_id": "demo", "episode_package": payload, "mode": "mock"})
    assert resp.status_code == 422
    body = json.dumps(resp.json(), ensure_ascii=False)
    assert "schema_version" in body


def test_v11_only_fields_not_silently_accepted_as_v1(client: TestClient) -> None:
    """带 v1.1-only 字段但声明 1.0 → 422（不会被当作 v1 静默接受）。"""
    payload = _v1()
    payload["output"] = {"aspect_ratio": "9:16", "fps": 30}
    resp = client.post(_PROD_URL, json={"project_id": "demo", "episode_package": payload, "mode": "mock"})
    assert resp.status_code == 422


def test_unrelated_request_behaviour_unchanged(client: TestClient) -> None:
    """与版本无关的既有行为不变：未知请求体字段仍 422；未知 job 仍 404。"""
    resp = client.post(
        _PROD_URL, json={"project_id": "demo", "episode_package": _v1(), "mode": "mock", "surprise": 1}
    )
    assert resp.status_code == 422
    assert client.get(f"{_PROD_URL}/does-not-exist").status_code == 404


def test_async_import_endpoint_registers_task(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """POST /import/async 受理 v1.1 文档、登记任务并走既有 Celery 入队通道。"""
    import app.tasks.execute_task as execute_task

    enqueued: list[str] = []
    monkeypatch.setattr(
        execute_task, "enqueue_task_execution", lambda task_id: enqueued.append(task_id)
    )

    resp = client.post(
        "/api/v1/crypto-animal-studio/import/async",
        json={"project_id": "demo", "episode_package": _v11(), "idempotency_key": "k-async"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["task_kind"] == "cas_import_episode_package"
    assert data["relation_type"] == "cas_episode_import"
    assert data["reused"] is False
    assert data["task_id"]
    assert len(data["relation_entity_id"]) == 64
    # 使用既有入队机制，而不是进程内直接执行。
    assert enqueued == [data["task_id"]]


def test_async_import_endpoint_rejects_unknown_version(client: TestClient) -> None:
    """异步端点与同步端点共用请求模型，因此未知版本同样 422。"""
    payload = _v1()
    payload["schema_version"] = "2.0"
    resp = client.post(
        "/api/v1/crypto-animal-studio/import/async",
        json={"project_id": "demo", "episode_package": payload, "idempotency_key": "k-bad"},
    )
    assert resp.status_code == 422


def test_openapi_exposes_both_package_schemas(client: TestClient) -> None:
    """OpenAPI 仍有清晰表示：请求体为两个 EpisodePackage schema 的 anyOf。"""
    spec = client.get("/openapi.json").json()
    body = spec["paths"]["/api/v1/crypto-animal-studio/production/jobs"]["post"]["requestBody"]
    ref = body["content"]["application/json"]["schema"]["$ref"].split("/")[-1]
    field = spec["components"]["schemas"][ref]["properties"]["episode_package"]
    refs = {item["$ref"].split("/")[-1] for item in field["anyOf"]}
    assert refs == {"EpisodePackage", "EpisodePackageV11"}
