"""接口响应壳测试：验证创建/删除/异常返回结构。"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.dependencies import get_db
from app.main import app
from app.models.studio import PromptCategory, PromptTemplate


class _FakePromptDB:
    """最小 DB 替身：仅覆盖 prompts 路由测试所需行为。"""

    def __init__(self) -> None:
        self.items: dict[str, PromptTemplate] = {}

    async def get(self, model: type, entity_id: str) -> PromptTemplate | None:  # noqa: ANN401
        if model is not PromptTemplate:
            return None
        return self.items.get(entity_id)

    async def execute(self, *_args, **_kwargs) -> None:
        return None

    def add(self, obj: PromptTemplate) -> None:
        self.items[obj.id] = obj

    async def flush(self) -> None:
        return None

    async def refresh(self, obj: PromptTemplate) -> None:
        now = datetime.now(UTC)
        if getattr(obj, "created_at", None) is None:
            obj.created_at = now
        obj.updated_at = now

    async def delete(self, obj: PromptTemplate) -> None:
        self.items.pop(obj.id, None)


def _seed_prompt(
    db: _FakePromptDB,
    *,
    prompt_id: str = "tpl-1",
    is_default: bool = False,
    is_system: bool = False,
) -> PromptTemplate:
    now = datetime.now(UTC)
    obj = PromptTemplate(
        id=prompt_id,
        category=PromptCategory.video_prompt,
        name="视频提示词",
        preview="预览",
        content="内容",
        variables=["scene"],
        is_default=is_default,
        is_system=is_system,
    )
    obj.created_at = now
    obj.updated_at = now
    db.items[obj.id] = obj
    return obj


def _override_db(db: _FakePromptDB):
    async def _get_db() -> AsyncGenerator[_FakePromptDB, None]:
        yield db

    return _get_db


def test_create_prompt_template_returns_created_envelope(client: TestClient) -> None:
    db = _FakePromptDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/prompts",
            json={
                "category": "video_prompt",
                "name": "视频生成提示词",
                "content": "请生成视频提示词",
                "preview": "预览文案",
                "variables": ["scene", "style"],
                "is_default": True,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    body = response.json()
    assert body["code"] == 201
    assert body["message"] == "success"
    assert body["data"]["category"] == "video_prompt"
    assert body["data"]["name"] == "视频生成提示词"
    assert body["data"]["is_default"] is True
    assert body["data"]["is_system"] is False
    assert body["data"]["id"]


def test_delete_prompt_template_returns_empty_envelope(client: TestClient) -> None:
    db = _FakePromptDB()
    _seed_prompt(db, prompt_id="tpl-delete")
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.delete("/api/v1/studio/prompts/tpl-delete")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body == {"code": 200, "message": "success", "data": None, "meta": None}
    assert "tpl-delete" not in db.items


def test_get_prompt_template_not_found_returns_api_response(client: TestClient) -> None:
    db = _FakePromptDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/prompts/missing")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    body = response.json()
    assert body == {"code": 404, "message": "PromptTemplate not found", "data": None, "meta": None}


def test_create_prompt_template_validation_error_returns_api_response(client: TestClient) -> None:
    db = _FakePromptDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/prompts",
            json={
                "name": "缺字段模板",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == 422
    assert body["data"] is None
    assert "category" in body["message"]
    assert "content" in body["message"]
