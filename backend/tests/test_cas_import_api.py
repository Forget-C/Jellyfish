"""CAS 导入 API 路由测试：ApiResponse 外壳与错误翻译（薄路由）。

用最小 FastAPI app 挂载 CAS 路由并覆盖 get_db，避免拉起完整应用；
用 monkeypatch 替换 application 层导入服务，聚焦验证「路由 + 响应壳 + 异常→HTTP」。
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.crypto_animal_studio.api.import_episode as route
from app.crypto_animal_studio.api import router as cas_router
from app.crypto_animal_studio.application.import_episode import ProjectNotFoundError
from app.crypto_animal_studio.application.import_result import ImportCounts, ImportResult
from app.dependencies import get_db

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SAMPLE = _REPO_ROOT / "docs" / "crypto-animal-studio" / "samples" / "sample-episode-package-v1.json"


async def _fake_db():
    """占位会话（被 monkeypatch 的服务不会真正使用它）。"""
    yield object()


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(cas_router, prefix="/api/v1/crypto-animal-studio")
    app.dependency_overrides[get_db] = _fake_db
    return TestClient(app)


def _request_body(dry_run: bool = True) -> dict:
    return {
        "project_id": "proj-1",
        "episode_package": json.loads(_SAMPLE.read_text(encoding="utf-8")),
        "dry_run": dry_run,
        "idempotency_key": "k1",
    }


def test_import_endpoint_success_envelope(monkeypatch) -> None:
    """成功路径：返回 200 + ApiResponse 外壳 + data 为 ImportResult。"""

    async def _fake_import(db, *, project_id, package, idempotency_key, dry_run=False):
        return ImportResult(
            status="dry_run",
            dry_run=True,
            idempotent_replay=False,
            project_id=project_id,
            episode_id=package.episode_id,
            idempotency_key=idempotency_key,
            payload_hash="0" * 64,
            chapter_id=None,
            chapter_index=1,
            created=ImportCounts(shots=4),
            reused=ImportCounts(),
            warnings=[],
        )

    monkeypatch.setattr(route, "import_episode", _fake_import)
    resp = _make_client().post("/api/v1/crypto-animal-studio/import", json=_request_body())
    assert resp.status_code == 200
    body = resp.json()
    assert {"code", "message", "data"}.issubset(body.keys())
    assert body["code"] == 200
    assert body["data"]["status"] == "dry_run"
    assert body["data"]["created"]["shots"] == 4


def test_import_endpoint_project_not_found_maps_404(monkeypatch) -> None:
    """项目不存在 → 404，且仍是 ApiResponse 外壳。"""

    async def _raise(db, *, project_id, package, idempotency_key, dry_run=False):
        raise ProjectNotFoundError("Project not found: proj-1")

    monkeypatch.setattr(route, "import_episode", _raise)
    resp = _make_client().post("/api/v1/crypto-animal-studio/import", json=_request_body())
    assert resp.status_code == 404


def test_import_endpoint_rejects_unknown_body_field() -> None:
    """请求体未知字段被拒绝（extra=forbid）→ 422。"""
    bad = _request_body()
    bad["surprise"] = 1
    resp = _make_client().post("/api/v1/crypto-animal-studio/import", json=bad)
    assert resp.status_code == 422
