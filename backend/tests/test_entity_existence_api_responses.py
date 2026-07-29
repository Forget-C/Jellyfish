"""entities existence-check 接口响应壳测试。"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.dependencies import get_db
from app.main import app
from app.services.studio.entities import StudioEntitiesService


class _FakeDB:
    pass


def _override_db(db: _FakeDB):
    async def _get_db() -> AsyncGenerator[_FakeDB, None]:
        yield db

    return _get_db


def test_entity_existence_check_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    async def _fake_check(self, **_kwargs):  # noqa: ANN001
        return {
            "characters": [
                {
                    "name": "角色一",
                    "exists": True,
                    "linked_to_project": True,
                    "linked_to_shot": False,
                    "asset_id": "character-1",
                    "link_id": None,
                }
            ],
            "props": [],
            "scenes": [],
            "costumes": [],
        }

    monkeypatch.setattr(StudioEntitiesService, "check_names_existence", _fake_check)
    app.dependency_overrides[get_db] = _override_db(_FakeDB())
    try:
        response = client.post(
            "/api/v1/studio/entities/existence-check",
            json={
                "project_id": "project-1",
                "shot_id": "shot-1",
                "character_names": ["角色一"],
                "prop_names": [],
                "scene_names": [],
                "costume_names": [],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {
        "code": 200,
        "message": "success",
        "data": {
            "characters": [
                {
                    "name": "角色一",
                    "exists": True,
                    "linked_to_project": True,
                    "linked_to_shot": False,
                    "asset_id": "character-1",
                    "link_id": None,
                }
            ],
            "props": [],
            "scenes": [],
            "costumes": [],
        },
        "meta": None,
    }


def test_entity_existence_check_relation_error_returns_api_response(client: TestClient, monkeypatch) -> None:
    async def _fake_check(self, **_kwargs):  # noqa: ANN001
        raise HTTPException(status_code=404, detail="shot_id does not belong to project_id")

    monkeypatch.setattr(StudioEntitiesService, "check_names_existence", _fake_check)
    app.dependency_overrides[get_db] = _override_db(_FakeDB())
    try:
        response = client.post(
            "/api/v1/studio/entities/existence-check",
            json={
                "project_id": "project-1",
                "shot_id": "shot-404",
                "character_names": [],
                "prop_names": [],
                "scene_names": [],
                "costume_names": [],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json() == {
        "code": 404,
        "message": "shot_id does not belong to project_id",
        "data": None,
        "meta": None,
    }
