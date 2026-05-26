"""image_tasks 接口响应壳测试。"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any, cast

from fastapi.testclient import TestClient

from app.api.v1.routes.studio import image_tasks as route
from app.dependencies import get_db
from app.main import app


class _DummyDB:
    async def get(self, *_args, **_kwargs):
        return None

    async def execute(self, *_args, **_kwargs):
        class _Result:
            def scalars(self):
                class _Scalars:
                    def first(self):
                        return None

                return _Scalars()

        return _Result()

    def add(self, *_args, **_kwargs):
        return None

    async def flush(self):
        return None

    async def refresh(self, *_args, **_kwargs):
        return None


def _override_db(db: _DummyDB):
    async def _get_db() -> AsyncGenerator[_DummyDB, None]:
        yield db

    return _get_db


def test_create_actor_image_task_requires_prompt(client: TestClient) -> None:
    db = _DummyDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/image-tasks/actors/actor-1/image-tasks",
            json={"image_id": 1, "prompt": "   ", "images": []},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json() == {
        "code": 400,
        "message": "prompt is required for actor generation",
        "data": None,
        "meta": None,
    }


def test_render_actor_image_prompt_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _DummyDB()

    class _Base:
        prompt = "基础演员提示词"
        default_images = ["file-1", "file-2"]
        entity_type = "actor"
        entity_id = "actor-1"
        relation_type = "actor_image"
        relation_entity_id = "1"

    class _Derived:
        prompt = "渲染后的演员提示词"
        images = ["file-1", "file-2"]

    async def _fake_build_base(*_args, **_kwargs):
        return _Base()

    def _fake_derive(*_args, **_kwargs):
        return _Derived()

    monkeypatch.setattr(route, "_build_actor_image_base_draft_service", _fake_build_base)
    monkeypatch.setattr(route, "_derive_asset_image_preview_service", _fake_derive)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/image-tasks/actors/actor-1/render-prompt",
            json={"image_id": 1, "images": []},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["message"] == "success"
    assert body["data"]["prompt"] == "渲染后的演员提示词"
    assert body["data"]["images"] == ["file-1", "file-2"]


def test_create_shot_frame_image_task_requires_prompt(client: TestClient) -> None:
    db = _DummyDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/image-tasks/shot/shot-1/frame-image-tasks",
            json={"frame_type": "first", "prompt": "   ", "target_ratio": "16:9", "images": []},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json() == {
        "code": 400,
        "message": "prompt is required for shot frame generation",
        "data": None,
        "meta": None,
    }


def test_render_shot_frame_prompt_returns_success_envelope_when_prompt_given(client: TestClient, monkeypatch) -> None:
    db = _DummyDB()
    async def _fake_load_frame_render_guidance(**_kwargs):
        return {
            "director_command_summary": "必须：锁定主角视线方向",
            "continuity_guidance": "当前镜头应承接上一镜头的动作与情绪，不要像全新场面重新开局",
            "frame_specific_guidance": "首帧只表现惊响出现后的最初僵直反应，人物尚未完成捂耳和下蹲动作",
            "composition_anchor": "以温室门框和人物站位作为空间锚点，保持环境与人物同时可读",
            "screen_direction_guidance": "保持陆远与环境入口的视线方向稳定，避免无故翻转朝向",
        }

    monkeypatch.setattr(route, "_load_frame_render_guidance", _fake_load_frame_render_guidance)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/image-tasks/shot/shot-1/frame-render-prompt",
            json={
                "frame_type": "first",
                "prompt": "生成一个紧张的首帧画面",
                "images": [
                    {"type": "character", "id": "char-1", "name": "陆远", "file_id": "file-1"},
                    {"type": "scene", "id": "scene-1", "name": "温室", "file_id": "file-2"},
                ],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["message"] == "success"
    assert body["data"]["base_prompt"] == "生成一个紧张的首帧画面"
    assert body["data"]["selected_guidance"] == [
        "高优先级导演指令：必须：锁定主角视线方向",
        "当前帧职责：首帧只表现惊响出现后的最初僵直反应，人物尚未完成捂耳和下蹲动作",
        "连续性要求：当前镜头应承接上一镜头的动作与情绪，不要像全新场面重新开局",
    ]
    assert body["data"]["dropped_guidance"] == [
        "构图锚点：以温室门框和人物站位作为空间锚点，保持环境与人物同时可读",
        "朝向与视线：保持陆远与环境入口的视线方向稳定，避免无故翻转朝向",
    ]
    assert body["data"]["selected_guidance_details"][1]["reason_tag"] == "首帧保时序"
    assert body["data"]["selected_guidance_details"][1]["reason"] == "当前是首帧，系统优先保留触发瞬间与未完成态约束，避免画面直接跳到后续完成动作。"
    assert body["data"]["dropped_guidance_details"][0]["reason_tag"] == "首帧降构图"
    assert body["data"]["dropped_guidance_details"][1]["reason_tag"] == "首帧降轴线"
    assert body["data"]["images"] == ["file-1", "file-2"]
    assert body["data"]["mappings"] == [
        {"token": "图1", "type": "character", "id": "char-1", "name": "陆远", "file_id": "file-1"},
        {"token": "图2", "type": "scene", "id": "scene-1", "name": "温室", "file_id": "file-2"},
    ]
    assert "高优先级导演指令：必须：锁定主角视线方向" in body["data"]["rendered_prompt"]
    assert "当前帧职责：首帧只表现惊响出现后的最初僵直反应，人物尚未完成捂耳和下蹲动作" in body["data"]["rendered_prompt"]
    assert "连续性要求：当前镜头应承接上一镜头的动作与情绪，不要像全新场面重新开局" in body["data"]["rendered_prompt"]
    assert "构图锚点：以温室门框和人物站位作为空间锚点，保持环境与人物同时可读" not in body["data"]["rendered_prompt"]
    assert "朝向与视线：保持陆远与环境入口的视线方向稳定，避免无故翻转朝向" not in body["data"]["rendered_prompt"]
    assert "图1: 陆远" in body["data"]["rendered_prompt"]
    assert "图2: 温室" in body["data"]["rendered_prompt"]
    assert "生成一个紧张的首帧画面" in body["data"]["rendered_prompt"]


def test_render_shot_frame_prompt_requires_prompt(client: TestClient) -> None:
    db = _DummyDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/image-tasks/shot/shot-1/frame-render-prompt",
            json={
                "frame_type": "first",
                "prompt": "",
                "images": [],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422


def test_create_shot_frame_image_task_renders_prompt_before_submit(client: TestClient, monkeypatch) -> None:
    class _ShotDetailDB(_DummyDB):
        async def get(self, model, ident):
            if getattr(model, "__name__", "") == "ShotDetail" and ident == "shot-1":
                return object()
            return None

    db = _ShotDetailDB()

    async def _fake_resolve_image_refs(*_args, **_kwargs):
        return [{"image_url": "data:image/png;base64,abc"}]

    async def _fake_load_frame_render_guidance(**_kwargs):
        return {
            "director_command_summary": "必须：锁定主角视线方向",
            "continuity_guidance": "当前镜头应承接上一镜头的动作与情绪，不要像全新场面重新开局",
            "frame_specific_guidance": "首帧只表现惊响出现后的最初僵直反应，人物尚未完成捂耳和下蹲动作",
            "composition_anchor": "以温室门框和人物站位作为空间锚点，保持环境与人物同时可读",
            "screen_direction_guidance": "保持陆远与环境入口的视线方向稳定，避免无故翻转朝向",
        }

    async def _fake_create_image_task_and_link(*_args, **kwargs):
        assert kwargs["prompt"].startswith("## 图片内容说明")
        assert "高优先级导演指令：必须：锁定主角视线方向" in kwargs["prompt"]
        assert "当前帧职责：首帧只表现惊响出现后的最初僵直反应，人物尚未完成捂耳和下蹲动作" in kwargs["prompt"]
        assert "连续性要求：当前镜头应承接上一镜头的动作与情绪，不要像全新场面重新开局" in kwargs["prompt"]
        assert "构图锚点：以温室门框和人物站位作为空间锚点，保持环境与人物同时可读" not in kwargs["prompt"]
        assert "朝向与视线：保持陆远与环境入口的视线方向稳定，避免无故翻转朝向" not in kwargs["prompt"]
        assert "图1: 陆远" in kwargs["prompt"]
        assert kwargs["images"] == [{"image_url": "data:image/png;base64,abc"}]
        assert kwargs["target_ratio"] == "9:16"
        assert kwargs["resolution_profile"] == "standard"
        assert kwargs["purpose"] == "video_reference"
        assert kwargs["render_context"]["images"] == ["file-1"]
        assert kwargs["render_context"]["mappings"][0]["token"] == "图1"
        assert kwargs["render_context"]["selected_guidance"][0] == "高优先级导演指令：必须：锁定主角视线方向"
        assert kwargs["render_context"]["selected_guidance_details"][1]["reason_tag"] == "首帧保时序"
        assert kwargs["render_context"]["dropped_guidance_details"][0]["reason_tag"] == "首帧降构图"
        assert kwargs["render_context"]["dropped_guidance_details"][1]["reason_tag"] == "首帧降轴线"
        return "task-1"

    monkeypatch.setattr(route, "_resolve_reference_image_refs_by_file_ids_service", _fake_resolve_image_refs)
    monkeypatch.setattr(route, "_load_frame_render_guidance", _fake_load_frame_render_guidance)
    monkeypatch.setattr(route, "_create_image_task_and_link_service", _fake_create_image_task_and_link)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/image-tasks/shot/shot-1/frame-image-tasks",
            json={
                "frame_type": "first",
                "prompt": "陆远站在温室里",
                "target_ratio": "9:16",
                "resolution_profile": "standard",
                "images": [
                    {"type": "character", "id": "char-1", "name": "陆远", "file_id": "file-1"},
                ],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    body = response.json()
    assert body["data"]["task_id"] == "task-1"


def test_run_image_generation_task_persists_render_context(monkeypatch) -> None:
    from app.services.studio import image_task_runner as runner

    calls: dict[str, Any] = {}

    class _FakeTaskStore:
        def __init__(self, _session):
            pass

        async def set_status(self, *_args, **_kwargs):
            return None

        async def set_progress(self, *_args, **_kwargs):
            return None

        async def set_result(self, _task_id, payload):
            calls["result_payload"] = payload

    class _FakeSession:
        async def commit(self):
            return None

        async def rollback(self):
            return None

    class _FakeSessionContext:
        async def __aenter__(self):
            return _FakeSession()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class _FakeImageTask:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self):
            return None

        async def get_result(self):
            class _Result:
                def model_dump(self):
                    return {"images": [{"url": "http://example.com/a.png"}]}

            return _Result()

    async def _fake_cancel_if_requested_async(**_kwargs):
        return False

    async def _fake_persist_images_to_assets(*_args, **_kwargs):
        return None

    async def _fake_resolve_related_shot_id(*_args, **_kwargs):
        return None

    monkeypatch.setattr(runner, "SqlAlchemyTaskStore", _FakeTaskStore)
    monkeypatch.setattr(runner, "async_session_maker", lambda: _FakeSessionContext())
    monkeypatch.setattr(runner, "ImageGenerationTask", _FakeImageTask)
    monkeypatch.setattr(runner, "cancel_if_requested_async", _fake_cancel_if_requested_async)
    monkeypatch.setattr(runner, "_persist_images_to_assets", _fake_persist_images_to_assets)
    monkeypatch.setattr(runner, "_resolve_related_shot_id", _fake_resolve_related_shot_id)
    monkeypatch.setattr(runner, "log_task_event", lambda *_args, **_kwargs: None)

    import asyncio

    asyncio.run(
        runner.run_image_generation_task(
            "task-1",
            {
                "provider": "openai",
                "api_key": "k",
                "base_url": None,
                "relation_type": "shot_frame_image",
                "relation_entity_id": "1",
                "render_context": {
                    "images": ["file-1"],
                    "mappings": [{"token": "图1", "name": "陆远", "file_id": "file-1"}],
                    "selected_guidance": ["高优先级导演指令：必须：锁定主角视线方向"],
                    "dropped_guidance": ["朝向与视线：保持陆远与环境入口的视线方向稳定，避免无故翻转朝向"],
                    "selected_guidance_details": [
                        {
                            "text": "高优先级导演指令：必须：锁定主角视线方向",
                            "category": "summary",
                            "reason_tag": "导演主指令",
                            "reason": "导演主指令始终属于最高优先级约束，因此会优先保留。",
                        }
                    ],
                    "dropped_guidance_details": [
                        {
                            "text": "朝向与视线：保持陆远与环境入口的视线方向稳定，避免无故翻转朝向",
                            "category": "screen",
                            "reason_tag": "首帧降轴线",
                            "reason": "当前是首帧，系统更优先保空间建立与站位关系，因此将朝向与视线 guidance 降为次级。",
                        }
                    ],
                },
                "input": {"prompt": "## 图片内容说明\n图1: 陆远", "model": "gpt-image-1"},
            },
        )
    )

    assert calls["result_payload"]["render_context"]["images"] == ["file-1"]
    assert calls["result_payload"]["render_context"]["selected_guidance_details"][0]["reason_tag"] == "导演主指令"
    assert calls["result_payload"]["render_context"]["dropped_guidance_details"][0]["reason_tag"] == "首帧降轴线"


def test_persist_images_to_assets_accepts_data_url_result(monkeypatch) -> None:
    from app.services.studio import image_task_runner as runner

    calls: dict[str, Any] = {}

    class _FakeSession:
        async def execute(self, *_args, **_kwargs):
            class _Result:
                def scalars(self):
                    class _Scalars:
                        def first(self):
                            return None

                    return _Scalars()

            return _Result()

        async def get(self, *_args, **_kwargs):
            return None

    class _FakeFile:
        id = "file-1"

    async def _fake_create_file_from_url_or_b64(_session, **kwargs):
        calls["file_kwargs"] = kwargs
        return _FakeFile()

    class _ImageItem:
        url = "data:image/png;base64,abc"
        b64_json = None

    class _Result:
        images = [_ImageItem()]

    monkeypatch.setattr(runner, "create_file_from_url_or_b64", _fake_create_file_from_url_or_b64)

    import asyncio

    asyncio.run(
        runner._persist_images_to_assets(
            _FakeSession(),
            task_id="task-1",
            relation_type="actor_image",
            relation_entity_id="1",
            result=_Result(),
        )
    )

    assert calls["file_kwargs"]["b64_data"] == "data:image/png;base64,abc"
    assert "url" not in calls["file_kwargs"]


def test_run_image_generation_task_persists_provider_error_when_result_missing(monkeypatch) -> None:
    from app.services.studio import image_task_runner as runner

    calls: dict[str, Any] = {}

    class _FakeTaskStore:
        def __init__(self, _session):
            pass

        async def set_status(self, task_id, status):
            calls.setdefault("statuses", []).append((task_id, status))

        async def set_progress(self, *_args, **_kwargs):
            return None

        async def set_error(self, task_id, error):
            calls["error"] = (task_id, error)

    class _FakeSession:
        async def commit(self):
            return None

        async def rollback(self):
            return None

    class _FakeSessionContext:
        async def __aenter__(self):
            return _FakeSession()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class _FakeImageTask:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self):
            return None

        async def get_result(self):
            return None

        async def status(self):
            return {"error": "URL too long"}

    async def _fake_cancel_if_requested_async(**_kwargs):
        return False

    async def _fake_resolve_related_shot_id(*_args, **_kwargs):
        return None

    monkeypatch.setattr(runner, "SqlAlchemyTaskStore", _FakeTaskStore)
    monkeypatch.setattr(runner, "async_session_maker", lambda: _FakeSessionContext())
    monkeypatch.setattr(runner, "ImageGenerationTask", _FakeImageTask)
    monkeypatch.setattr(runner, "cancel_if_requested_async", _fake_cancel_if_requested_async)
    monkeypatch.setattr(runner, "_resolve_related_shot_id", _fake_resolve_related_shot_id)
    monkeypatch.setattr(runner, "log_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(runner, "log_task_failure", lambda *_args, **_kwargs: None)

    import asyncio

    asyncio.run(
        runner.run_image_generation_task(
            "task-1",
            {
                "provider": "openai",
                "api_key": "k",
                "base_url": None,
                "relation_type": "actor_image",
                "relation_entity_id": "1",
                "input": {"prompt": "portrait", "model": "gpt-image-1"},
            },
        )
    )

    assert calls["error"] == ("task-1", "URL too long")
