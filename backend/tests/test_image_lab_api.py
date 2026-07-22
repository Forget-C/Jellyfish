"""图片实验室接口测试。"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.api.v1.routes.studio import image_lab as route
from app.dependencies import get_db
from app.main import app
from app.models.experiment_sessions import ExperimentMessage


class _DummyDB:
    """图片实验室路由测试所需的最小数据库替身。"""

    def __init__(self) -> None:
        self.experiment_session = type("ExperimentSessionStub", (), {"updated_at": None})()

    async def get(self, *_args):
        return self.experiment_session

    def add_all(self, _items):
        return None

    async def commit(self):
        return None

    async def refresh(self, _value):
        """消息替身已包含服务端时间字段，无需额外刷新。"""

        return None


async def _override_db():
    """为请求注入最小数据库替身，避免测试依赖真实数据库。"""
    yield _DummyDB()


def test_create_image_lab_task_uses_selected_references(client: TestClient, monkeypatch) -> None:
    """图片实验室应将模型、提示词及参考图传给通用图片任务创建器。"""
    async def _fake_append_messages(_db, *, session_id, drafts):
        """返回带稳定顺序的两条服务端权威消息。"""
        now = datetime.now(UTC)
        return [
            ExperimentMessage(
                id=f"message-{index}", session_id=session_id, sequence=index,
                role=draft.role, content=draft.content, status=draft.status,
                payload=draft.payload, created_at=now, updated_at=now,
            )
            for index, draft in enumerate(drafts, start=1)
        ]

    async def _fake_resolve_references(_db, *, file_ids: list[str]):
        assert file_ids == ["reference-1"]
        return [{"image_url": "data:image/png;base64,abc"}]

    async def _fake_create_task(**kwargs):
        assert kwargs["model_id"] == "image-model-1"
        assert kwargs["prompt"] == "一只水彩风格的鲸鱼"
        assert kwargs["images"] == [{"image_url": "data:image/png;base64,abc"}]
        assert kwargs["target_ratio"] == "1:1"
        assert kwargs["resolution_profile"] == "high"
        assert kwargs["relation_type"] == "image_lab"
        assert kwargs["purpose"] == "generic"
        assert kwargs["render_context"] == {"reference_file_ids": ["reference-1"]}
        return "task-1"

    monkeypatch.setattr(route, "resolve_reference_image_refs_by_file_ids", _fake_resolve_references)
    monkeypatch.setattr(route, "create_image_task_and_link", _fake_create_task)
    monkeypatch.setattr(route, "append_experiment_messages", _fake_append_messages)
    monkeypatch.setattr("app.tasks.execute_task.enqueue_task_execution", lambda _task_id: None)
    app.dependency_overrides[get_db] = _override_db
    try:
        response = client.post(
            "/api/v1/studio/image-lab/tasks",
            json={
            "model_id": "image-model-1",
                "session_id": "session-1",
                "prompt": "一只水彩风格的鲸鱼",
                "images": ["reference-1"],
                "target_ratio": "1:1",
                "resolution_profile": "high",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert response.json()["data"]["task_id"] == "task-1"
    assert [item["sequence"] for item in response.json()["data"]["messages"]] == [1, 2]
    assert [item["role"] for item in response.json()["data"]["messages"]] == ["user", "task"]
    assert response.json()["data"]["messages"][1]["task_id"] == "task-1"
