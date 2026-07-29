"""CAS 生产 API 与 CLI 测试（离线、确定性）。

API 使用最小 FastAPI app 挂载 CAS 路由并覆盖 get_db（内存 SQLite），避免拉起完整应用。
CLI 直接调用 ``main()``，用 --storage-root/--create-tables 指向临时目录与 SQLite 文件。
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

import app.crypto_animal_studio.api.production as production_route
from app.core.db import Base
from app.crypto_animal_studio.api import router as cas_router
from app.crypto_animal_studio.production.providers.mock import build_mock_bundle
from app.dependencies import get_db

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SAMPLE = _REPO_ROOT / "samples" / "cas" / "demo_episode.json"


def _package_dict() -> dict:
    return json.loads(_SAMPLE.read_text(encoding="utf-8"))


@pytest.fixture()
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, Path]]:
    """构造挂载 CAS 路由的最小 app，并把存储根指向 tmp_path。

    生命周期纪律：建表与 engine.dispose() 都在 app lifespan 内完成，并以上下文管理器方式
    使用 TestClient，确保所有 aiosqlite 连接在同一个事件循环中创建与释放，避免
    worker 线程在事件循环关闭后回调（PytestUnhandledThreadExceptionWarning）。
    """
    engine = create_async_engine("sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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

    # 让路由内部创建的编排使用临时存储根
    monkeypatch.setenv("CAS_STORAGE_ROOT", str(tmp_path))

    app = FastAPI(lifespan=_lifespan)
    app.include_router(cas_router, prefix="/api/v1/crypto-animal-studio")
    app.dependency_overrides[get_db] = _get_db
    with TestClient(app) as test_client:
        yield test_client, tmp_path


def test_create_job_endpoint_runs_pipeline(api) -> None:
    """POST /production/jobs 创建任务并同步跑完，返回 ApiResponse 壳。"""
    client, storage = api
    resp = client.post(
        "/api/v1/crypto-animal-studio/production/jobs",
        json={"project_id": "demo-project", "episode_package": _package_dict(), "mode": "mock"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert {"code", "message", "data"}.issubset(body.keys())
    data = body["data"]
    assert data["status"] == "completed"
    assert data["manifest_path"].endswith("manifest.json")
    assert data["final_output"].endswith("final/final_video.txt")
    assert len(data["shots"]) == len(_package_dict()["shots"])
    assert (storage / Path(data["manifest_path"])).is_file()


def test_get_job_and_artifacts_endpoints(api) -> None:
    """GET 任务与产物列表可用；未知任务返回 404。"""
    client, _ = api
    created = client.post(
        "/api/v1/crypto-animal-studio/production/jobs",
        json={"project_id": "demo-project", "episode_package": _package_dict(), "mode": "mock"},
    ).json()["data"]

    got = client.get(f"/api/v1/crypto-animal-studio/production/jobs/{created['id']}")
    assert got.status_code == 200
    assert got.json()["data"]["id"] == created["id"]

    arts = client.get(f"/api/v1/crypto-animal-studio/production/jobs/{created['id']}/artifacts")
    assert arts.status_code == 200
    items = arts.json()["data"]
    kinds = {a["artifact_type"] for a in items}
    assert {"prompt", "image", "video", "voice", "subtitle", "manifest", "final_video"}.issubset(kinds)
    assert all(a["checksum"] for a in items)

    assert client.get("/api/v1/crypto-animal-studio/production/jobs/missing").status_code == 404
    assert client.get("/api/v1/crypto-animal-studio/production/jobs/missing/artifacts").status_code == 404


def test_retry_endpoint(api, monkeypatch: pytest.MonkeyPatch) -> None:
    """POST retry：失败任务重试后完成；未知任务 404。"""
    client, _ = api
    # 先制造一次失败（video 第 2 镜）
    monkeypatch.setattr(production_route, "build_mock_bundle", lambda: build_mock_bundle(video_fail_on_sequence=2))
    failed = client.post(
        "/api/v1/crypto-animal-studio/production/jobs",
        json={"project_id": "demo-project", "episode_package": _package_dict(), "mode": "mock"},
    ).json()["data"]
    assert failed["status"] == "failed"

    # 恢复正常供应商后重试
    monkeypatch.setattr(production_route, "build_mock_bundle", lambda: build_mock_bundle())
    retried = client.post(
        f"/api/v1/crypto-animal-studio/production/jobs/{failed['id']}/retry",
        json={"episode_package": _package_dict(), "mode": "mock"},
    )
    assert retried.status_code == 200
    assert retried.json()["data"]["status"] == "completed"

    assert (
        client.post(
            "/api/v1/crypto-animal-studio/production/jobs/missing/retry",
            json={"episode_package": _package_dict(), "mode": "mock"},
        ).status_code
        == 404
    )


def test_create_job_rejects_unknown_field(api) -> None:
    """请求体未知字段被拒绝（extra=forbid）。"""
    client, _ = api
    resp = client.post(
        "/api/v1/crypto-animal-studio/production/jobs",
        json={"project_id": "p", "episode_package": _package_dict(), "mode": "mock", "surprise": 1},
    )
    assert resp.status_code == 422


def test_cli_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture) -> None:
    """CLI run 子命令跑通并打印状态/job id/manifest/final output。"""
    from app.config import settings
    from app.crypto_animal_studio.production import cli

    db_file = tmp_path / "cli.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_file.as_posix()}")

    code = cli.main(
        [
            "run",
            "--project-id",
            "demo-project",
            "--episode-package",
            str(_SAMPLE),
            "--provider-mode",
            "mock",
            "--storage-root",
            str(tmp_path / "storage"),
            "--create-tables",
        ]
    )
    out = capsys.readouterr().out
    assert code == 0
    assert "status: completed" in out
    assert "job_id: " in out
    assert "manifest: " in out and "manifest.json" in out
    assert "final_output: " in out and "final_video.txt" in out
