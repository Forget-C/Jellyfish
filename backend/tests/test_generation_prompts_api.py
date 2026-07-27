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
            json={"reference_file_ids": ["file-1"]},
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


def test_shot_frame_render_binds_path_frame_and_guidance(client: TestClient, monkeypatch) -> None:
    """帧类型和镜头 ID 必须由路径绑定，guidance 仅由服务端加载。"""
    renderer = _Renderer(PromptRendererName.shot_frame)

    async def _guidance(**_kwargs):
        return dict.fromkeys(
            (
                "director_command_summary",
                "continuity_guidance",
                "frame_specific_guidance",
                "composition_anchor",
                "screen_direction_guidance",
            ),
            "服务端 guidance",
        )

    monkeypatch.setattr(route.prompt_renderer_registry, "resolve", lambda _name: renderer)
    monkeypatch.setattr(route, "_load_frame_render_guidance", _guidance)
    app.dependency_overrides[get_db] = _override_db(_DummyDB())
    try:
        response = client.post(
            "/api/v1/studio/generation-prompts/shots/shot-1/frames/first/render",
            json={"prompt": "首帧提示词", "images": []},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert renderer.request.input.shot_id == "shot-1"
    assert renderer.request.input.frame_type.value == "first"
    assert renderer.request.input.director_command_summary == "服务端 guidance"


def test_shot_video_render_binds_path_shot_and_rejects_delivery_body(client: TestClient, monkeypatch) -> None:
    """视频路由只接受视频渲染输入，禁止 body 声明交付协议。"""
    renderer = _Renderer(PromptRendererName.shot_video)
    monkeypatch.setattr(route.prompt_renderer_registry, "resolve", lambda _name: renderer)
    app.dependency_overrides[get_db] = _override_db(_DummyDB())
    try:
        response = client.post(
            "/api/v1/studio/generation-prompts/shots/shot-1/video/render",
            json={"reference_mode": "first", "image_file_ids": ["file-1"]},
        )
        invalid_response = client.post(
            "/api/v1/studio/generation-prompts/shots/shot-1/video/render",
            json={"reference_mode": "first", "delivery": "streaming"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert renderer.request.input.shot_id == "shot-1"
    assert renderer.request.input.image_file_ids == ["file-1"]
    assert invalid_response.status_code == 422
