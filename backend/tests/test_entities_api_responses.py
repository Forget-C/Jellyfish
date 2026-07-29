"""entities 接口响应壳测试。"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.dependencies import get_db
from app.main import app
from app.models.studio import Actor, ProjectStyle, ProjectVisualStyle


class _FakeResult:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _FakeEntityDB:
    def __init__(self) -> None:
        self.actors: dict[str, Actor] = {}
        self.actor_images: list[object] = []

    async def get(self, model: type, entity_id):  # noqa: ANN401
        if model is Actor:
            return self.actors.get(entity_id)
        return None

    def add(self, obj: object) -> None:
        if isinstance(obj, Actor):
            self.actors[obj.id] = obj
        else:
            self.actor_images.append(obj)

    async def flush(self) -> None:
        return None

    async def refresh(self, obj: object) -> None:
        now = datetime.now(UTC)
        if getattr(obj, "created_at", None) is None:
            obj.created_at = now
        obj.updated_at = now

    async def delete(self, obj: object) -> None:
        if isinstance(obj, Actor):
            self.actors.pop(obj.id, None)

    async def execute(self, *_args, **_kwargs):
        return _FakeResult([])


def _override_db(db: _FakeEntityDB):
    async def _get_db() -> AsyncGenerator[_FakeEntityDB, None]:
        yield db

    return _get_db


def test_create_actor_entity_returns_created_envelope(client: TestClient) -> None:
    db = _FakeEntityDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/entities/actor",
            json={
                "id": "actor-1",
                "name": "演员一",
                "description": "测试演员",
                "tags": [],
                "prompt_template_id": None,
                "view_count": 2,
                "style": ProjectStyle.real_people_city.value,
                "visual_style": ProjectVisualStyle.live_action.value,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    body = response.json()
    assert body["code"] == 201
    assert body["message"] == "success"
    assert body["data"]["id"] == "actor-1"
    assert body["data"]["thumbnail"] == ""


def test_get_actor_entity_not_found_returns_api_response(client: TestClient) -> None:
    db = _FakeEntityDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/entities/actor/missing")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json() == {"code": 404, "message": "Actor not found", "data": None, "meta": None}


def test_delete_actor_entity_returns_empty_envelope(client: TestClient) -> None:
    db = _FakeEntityDB()
    actor = Actor(
        id="actor-1",
        name="演员一",
        description="",
        tags=[],
        prompt_template_id=None,
        view_count=1,
        style=ProjectStyle.real_people_city,
        visual_style=ProjectVisualStyle.live_action,
    )
    actor.created_at = datetime.now(UTC)
    actor.updated_at = actor.created_at
    db.actors[actor.id] = actor

    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.delete("/api/v1/studio/entities/actor/actor-1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"code": 200, "message": "success", "data": None, "meta": None}
    assert "actor-1" not in db.actors


def test_create_entity_invalid_entity_type_returns_api_response(client: TestClient) -> None:
    db = _FakeEntityDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post("/api/v1/studio/entities/unknown", json={"id": "x"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json() == {
        "code": 400,
        "message": "entity_type must be one of: actor/character/scene/prop/costume",
        "data": None,
        "meta": None,
    }
