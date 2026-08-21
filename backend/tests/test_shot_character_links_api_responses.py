"""shot_character_links 接口响应壳测试。"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.api.v1.routes.studio import shot_character_links as route
from app.dependencies import get_db
from app.main import app
from app.models.studio import ShotCharacterLink


class _DummyDB:
    pass


def _override_db(db: _DummyDB):
    async def _get_db() -> AsyncGenerator[_DummyDB, None]:
        yield db

    return _get_db


def _make_link() -> ShotCharacterLink:
    obj = ShotCharacterLink(
        shot_id="shot-1",
        character_id="char-1",
        index=1,
        note="主角",
    )
    obj.id = 1
    obj.created_at = datetime.now(UTC)
    obj.updated_at = obj.created_at
    return obj


def test_list_shot_character_links_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _DummyDB()

    async def _fake_list_by_shot(*_args, **_kwargs):
        return [_make_link()]

    monkeypatch.setattr(route, "list_by_shot", _fake_list_by_shot)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/shot-character-links", params={"shot_id": "shot-1"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["message"] == "success"
    assert body["data"][0]["shot_id"] == "shot-1"
    assert body["data"][0]["character_id"] == "char-1"


def test_upsert_shot_character_link_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _DummyDB()

    async def _fake_upsert(*_args, **_kwargs):
        return _make_link()

    monkeypatch.setattr(route, "upsert", _fake_upsert)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/shot-character-links",
            json={
                "shot_id": "shot-1",
                "character_id": "char-1",
                "index": 1,
                "note": "主角",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["message"] == "success"
    assert body["data"]["id"] == 1
    assert body["data"]["note"] == "主角"


def test_upsert_shot_character_link_value_error_returns_api_response(client: TestClient, monkeypatch) -> None:
    db = _DummyDB()

    async def _fake_upsert(*_args, **_kwargs):
        raise ValueError("Character does not belong to the same project")

    monkeypatch.setattr(route, "upsert", _fake_upsert)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/shot-character-links",
            json={
                "shot_id": "shot-1",
                "character_id": "char-2",
                "index": 2,
                "note": "",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json() == {
        "code": 400,
        "message": "Character does not belong to the same project",
        "data": None,
        "meta": None,
    }
