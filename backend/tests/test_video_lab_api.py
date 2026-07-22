"""视频实验室接口测试。"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.api.v1.routes.studio import video_lab as route
from app.dependencies import get_db
from app.main import app
from app.models.experiment_sessions import ExperimentMessage


class _DummyTaskRecord:
    """模拟任务管理器返回的异步任务记录。"""

    id = "video-lab-task-1"


class _DummyTaskManager:
    """捕获任务创建调用，避免路由测试依赖真实任务存储。"""

    async def create(self, **_kwargs) -> _DummyTaskRecord:
        return _DummyTaskRecord()


class _DummyDB:
    """视频实验室路由测试所需的最小数据库替身。"""

    def __init__(self) -> None:
        self.added: list[object] = []
        self.committed = False
        self.experiment_session = type("ExperimentSessionStub", (), {"updated_at": None})()

    def add(self, value: object) -> None:
        self.added.append(value)

    def add_all(self, values: list[object]) -> None:
        self.added.extend(values)

    async def get(self, *_args) -> object:
        return self.experiment_session

    async def commit(self) -> None:
        self.committed = True

    async def refresh(self, _value: object) -> None:
        """消息替身已包含服务端时间字段，无需额外刷新。"""

        return None


async def _override_db():
    """为请求注入最小数据库替身，避免测试依赖真实数据库。"""
    yield _DummyDB()


def test_create_video_lab_task_maps_typed_frames(client: TestClient, monkeypatch) -> None:
    """视频实验室应将具名首尾关键帧和已选模型交给独立任务构建器。"""
    captured: dict = {}

    async def _fake_build_run_args(_db, **kwargs):
        captured.update(kwargs)
        return {"source": "video_lab", "input": {"prompt": kwargs["prompt"]}}

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

    def _fake_task_manager(*_args, **_kwargs):
        return _DummyTaskManager()

    monkeypatch.setattr(route, "build_video_lab_run_args", _fake_build_run_args)
    monkeypatch.setattr(route, "append_experiment_messages", _fake_append_messages)
    monkeypatch.setattr(route, "TaskManager", _fake_task_manager)
    monkeypatch.setattr(route, "enqueue_task_execution", lambda _task_id: None)
    app.dependency_overrides[get_db] = _override_db
    try:
        response = client.post(
            "/api/v1/studio/video-lab/tasks",
            json={
                "model_id": "video-model-1",
                "session_id": "session-1",
                "prompt": "白发少女在雨夜回头",
                "ratio": "16:9",
                    "frame_references": {
                        "first_frame_file_id": "first-file",
                        "last_frame_file_id": "last-file",
                        "key_frame_file_ids": ["key-file"],
                    },
                    "subject_references": [
                        {"name": "少女", "image_file_ids": ["character-file"], "video_file_ids": []}
                    ],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert response.json()["data"]["task_id"] == "video-lab-task-1"
    assert [item["sequence"] for item in response.json()["data"]["messages"]] == [1, 2]
    assert [item["role"] for item in response.json()["data"]["messages"]] == ["user", "task"]
    assert response.json()["data"]["messages"][1]["task_id"] == "video-lab-task-1"
    assert {key: value for key, value in captured.items() if key not in {"subject_references", "frame_references"}} == {
        "model_id": "video-model-1",
        "prompt": "白发少女在雨夜回头",
        "ratio": "16:9",
    }
    assert captured["frame_references"].model_dump() == {
        "first_frame_file_id": "first-file",
        "last_frame_file_id": "last-file",
        "key_frame_file_ids": ["key-file"],
    }
    assert [item.model_dump() for item in captured["subject_references"]] == [
        {"name": "少女", "image_file_ids": ["character-file"], "video_file_ids": []}
    ]
