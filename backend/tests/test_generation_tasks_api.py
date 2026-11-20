"""固定媒体生成任务路由的 Binder 覆盖。"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi.testclient import TestClient

from app.api.v1.routes.studio import generation_tasks as route
from app.dependencies import get_db
from app.main import app
from app.services.generation.submission import GenerationAccepted


class _DummyDB:
    """记录提交次数的最小异步会话替身。"""

    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        """模拟任务持久化后的事务提交。"""
        self.commits += 1


def _override_db(db: _DummyDB):
    """为路由测试提供不连接数据库的依赖替换。"""

    async def _get_db() -> AsyncGenerator[_DummyDB, None]:
        yield db

    return _get_db


class _Submitter:
    """捕获 Binder 生成命令的提交器替身。"""

    command = None

    def __init__(self, *, entity_gate) -> None:  # noqa: ANN001
        """与生产构造函数保持相同关键字注入方式。"""

    async def submit_async(self, _db, command):  # noqa: ANN001
        """返回固定 task ID，避免测试触及实体门禁与持久化细节。"""
        self.command = command
        type(self).command = command
        return GenerationAccepted(task_id="task-1", model_id="resolved-model")








def test_asset_image_task_routes_bind_asset_slots_from_path(client: TestClient, monkeypatch) -> None:
    """演员、角色与具名资产路径必须固定为同一种资产图片槽位命令。"""
    db = _DummyDB()
    monkeypatch.setattr(route, "GenerationSubmitter", _Submitter)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        cases = (
            ("/api/v1/studio/generation-tasks/actors/actor-1/slots/11/tasks", "actor-1", "11"),
            ("/api/v1/studio/generation-tasks/characters/character-1/slots/12/tasks", "character-1", "12"),
            ("/api/v1/studio/generation-tasks/assets/prop/prop-1/slots/13/tasks", "prop-1", "13"),
        )
        for path, entity_id, slot_id in cases:
            response = client.post(
                path,
                json={
                    "execution_prompt": "最终资产提示词",
                    "operation_input": {"kind": "image_generation", "target_ratio": "1:1"},
                },
            )
            assert response.status_code == 201
            assert _Submitter.command.modality.value == "image"
            assert _Submitter.command.operation.value == "image_generation"
            assert _Submitter.command.delivery.value == "async_polling"
            assert _Submitter.command.target.kind.value == "asset_image_slot"
            assert _Submitter.command.target.entity_id == entity_id
            assert _Submitter.command.target.slot_id == slot_id
    finally:
        app.dependency_overrides.clear()

    assert db.commits == 3
