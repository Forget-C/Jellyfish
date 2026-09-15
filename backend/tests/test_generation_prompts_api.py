"""固定 generation-prompts 路由的最小 API 覆盖。"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi.testclient import TestClient

from app.api.v1.routes.studio import generation_prompts as route
from app.dependencies import get_db
from app.main import app
from app.services.generation.prompts import PromptRendererName, RenderedPromptSnapshot


class _DummyDB:
    """不触及数据库的路由测试会话替身。"""


def _override_db(db: _DummyDB):
    """为测试应用注入稳定的异步数据库依赖。"""

    async def _get_db() -> AsyncGenerator[_DummyDB, None]:
        yield db

    return _get_db


class _Renderer:
    """记录 Binder 输入并返回固定快照的渲染器替身。"""

    def __init__(self, name: PromptRendererName) -> None:
        self.name = name
        self.request = None

    async def render(self, _db, request):  # noqa: ANN001
        """保存内部输入，用于证明目标字段来自路径而非请求体。"""
        self.request = request
        return RenderedPromptSnapshot(
            render_id="render-1",
            renderer=self.name,
            execution_prompt="已渲染提示词",
            variables_snapshot={},
        )


def test_asset_render_binds_path_target_and_rejects_target_body(client: TestClient, monkeypatch) -> None:
    """资产路径应决定实体和槽位，body 不能覆盖生成目标。"""
    renderer = _Renderer(PromptRendererName.asset_image)
    monkeypatch.setattr(route.prompt_renderer_registry, "resolve", lambda _name: renderer)
    app.dependency_overrides[get_db] = _override_db(_DummyDB())
    try:
        response = client.post(
            "/api/v1/studio/generation-prompts/assets/actor/actor-1/slots/2/render",
            json={"references": [{"file_id": "file-1", "role": "identity"}]},
        )
        invalid_response = client.post(
            "/api/v1/studio/generation-prompts/assets/actor/actor-1/slots/2/render",
            json={"target": {"entity_id": "other"}},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["data"]["execution_prompt"] == "已渲染提示词"
    assert renderer.request.input.entity_id == "actor-1"
    assert renderer.request.input.image_id == 2
    assert invalid_response.status_code == 422




def test_legacy_studio_image_task_endpoint_is_unmounted(client: TestClient) -> None:
    """旧图片任务路由删除后，调用方不能再绕过统一生成提交链。"""
    response = client.post(
        "/api/v1/studio/actors/actor-1/image-tasks",
        json={"prompt": "旧入口请求"},
    )

    assert response.status_code == 404
