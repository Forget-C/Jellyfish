"""generated_video 接口响应壳测试。"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.v1.routes.film import generated_video as route
from app.dependencies import get_db
from app.main import app
from app.services.paid_outlet_guard import require_video_outlet


class _FakeTaskRecord:
    def __init__(self, task_id: str) -> None:
        self.id = task_id


class _FakeTaskManager:
    def __init__(self, *_args, **_kwargs) -> None:
        pass

    async def create(self, *_args, **_kwargs) -> _FakeTaskRecord:
        return _FakeTaskRecord("video-task-1")


class _FakeDB:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.committed = False

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        self.committed = True


async def _async_noop(*_args, **_kwargs) -> None:
    return None


def _override_db(db: _FakeDB):
    async def _get_db() -> AsyncGenerator[_FakeDB, None]:
        yield db

    return _get_db


def test_preview_video_generation_prompt_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _FakeDB()

    async def _fake_preview(*_args, **_kwargs):
        return "视频预览提示词", ["file-1", "file-2"], {
            "shot_id": "shot-1",
            "title": "镜头一",
            "script_excerpt": "主角转身看向门口。",
            "action_beats": ["主角转身", "视线停在门口"],
            "action_beat_phases": [
                {"text": "主角转身", "phase": "trigger"},
                {"text": "视线停在门口", "phase": "aftermath"},
            ],
            "previous_shot_summary": "标题：镜头零；剧本摘录：主角推门进入走廊",
            "next_shot_goal": "标题：镜头二；主角停住动作，保持警惕",
            "continuity_guidance": "承接上一镜头动作，不要像全新场面重新开局",
            "composition_anchor": "以走廊门口作为空间锚点",
            "screen_direction_guidance": "保持主角朝向和视线落点连续",
            "dialogue_summary": "",
            "characters": [],
            "scene": None,
            "props": [],
            "costumes": [],
            "camera": {"camera_shot": "MS", "angle": "EYE_LEVEL", "movement": "STATIC", "duration": 4},
            "atmosphere": "紧张",
            "visual_style": "现实",
            "style": "真人都市",
            "negative_prompt": "",
        }

    monkeypatch.setattr(route, "preview_prompt_and_images", _fake_preview)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/film/tasks/video/preview-prompt",
            json={
                "shot_id": "shot-1",
                "reference_mode": "first_last",
                "prompt": "生成一个压迫感强的镜头",
                "images": [],
                "ratio": "9:16",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["message"] == "success"
    assert body["data"]["prompt"] == "视频预览提示词"
    assert body["data"]["images"] == ["file-1", "file-2"]
    assert body["data"]["pack"]["previous_shot_summary"].startswith("标题：镜头零")
    assert body["data"]["pack"]["next_shot_goal"].startswith("标题：镜头二")


def test_preview_video_generation_prompt_not_found_returns_api_response(
    client: TestClient, monkeypatch
) -> None:
    db = _FakeDB()

    async def _fake_preview(*_args, **_kwargs):
        raise HTTPException(status_code=404, detail="Shot not found")

    monkeypatch.setattr(route, "preview_prompt_and_images", _fake_preview)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/film/tasks/video/preview-prompt",
            json={
                "shot_id": "shot-missing",
                "reference_mode": "text_only",
                "prompt": "仅文本生成",
                "images": [],
                "ratio": "16:9",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json() == {"code": 404, "message": "Shot not found", "data": None, "meta": None}


def test_create_video_generation_task_returns_created_envelope(client: TestClient, monkeypatch) -> None:
    db = _FakeDB()

    async def _fake_build_run_args(*_args, **_kwargs):
        return {"prompt": "最终视频提示词", "images": ["file-1"]}

    monkeypatch.setattr(route, "build_run_args", _fake_build_run_args)
    monkeypatch.setattr(route, "TaskManager", _FakeTaskManager)
    monkeypatch.setattr(route, "enqueue_task_execution", lambda task_id: SimpleNamespace(id=f"celery-{task_id}"))
    monkeypatch.setattr(route, "mark_shot_generating", _async_noop)
    # 真实出视频出口由 router 守卫（DRY_RUN 下 409）；本文件只验证响应壳，
    # 建任务与派发都已打桩，这里把守卫摘掉。守卫本身见 test_paid_outlet_guard.py。
    app.dependency_overrides[require_video_outlet] = lambda: None
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/film/tasks/video",
            json={
                "shot_id": "shot-1",
                "reference_mode": "first",
                "prompt": "生成一个节奏紧张的视频片段",
                "images": [],
                "ratio": "9:16",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    body = response.json()
    assert body["code"] == 201
    assert body["message"] == "success"
    assert body["data"]["task_id"] == "video-task-1"
    assert body["meta"] is None
    assert db.committed is True
    assert len(db.added) == 1


def test_create_video_generation_task_validation_error_returns_api_response(client: TestClient) -> None:
    db = _FakeDB()
    # 守卫是 route 级依赖，会先于请求体校验执行；本用例要验的是 422 语义，
    # 因此同样先摘掉守卫（详见 test_paid_outlet_guard.py 里的顺序断言）。
    app.dependency_overrides[require_video_outlet] = lambda: None
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/film/tasks/video",
            json={
                "shot_id": "shot-1",
                "reference_mode": "invalid-mode",
                "prompt": "bad",
                "images": [],
                "ratio": "16:9",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == 422
    assert body["data"] is None
    assert "reference_mode" in body["message"]


# ---------------------------------------------------------------------------
# legacy 出视频出口的入参预检（接线验证：钳制 / 拒绝都发生在建任务之前）
# ---------------------------------------------------------------------------


def _stub_video_route(monkeypatch, db, run_args):
    async def _fake_build_run_args(*_args, **_kwargs):
        return run_args

    monkeypatch.setattr(route, "build_run_args", _fake_build_run_args)
    monkeypatch.setattr(route, "TaskManager", _FakeTaskManager)
    monkeypatch.setattr(route, "enqueue_task_execution", lambda task_id: SimpleNamespace(id=f"celery-{task_id}"))
    monkeypatch.setattr(route, "mark_shot_generating", _async_noop)
    app.dependency_overrides[require_video_outlet] = lambda: None
    app.dependency_overrides[get_db] = _override_db(db)


def test_video_route_clamps_short_duration_and_reports_warning(client: TestClient, monkeypatch) -> None:
    """3s 镜头（低于 seedance-2.0-mini 的 5s 下限）必须被钳到 5s 并带出 warning。"""
    db = _FakeDB()
    run_args = {
        "prompt": "最终视频提示词",
        "images": ["file-1"],
        "input": {"model": "seedance-2.0-mini", "ratio": "9:16", "seconds": 3, "prompt": "x"},
    }
    _stub_video_route(monkeypatch, db, run_args)
    try:
        response = client.post(
            "/api/v1/film/tasks/video",
            json={"shot_id": "shot-1", "reference_mode": "first", "prompt": "p", "images": [], "ratio": "9:16"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    warnings = (response.json().get("meta") or {}).get("video_option_warnings") or []
    assert any("低于模型下限" in item for item in warnings)
    # 关键：发出去的入参已经被改写成合法值（建任务用的就是它）
    assert run_args["input"]["seconds"] == 5
    assert run_args["input"]["resolution"] == "480p"


def test_video_route_rejects_unsupported_resolution_before_creating_task(client: TestClient, monkeypatch) -> None:
    """非法分辨率必须在建任务之前 422，而不是发给供应商再失败。"""
    db = _FakeDB()
    run_args = {
        "prompt": "最终视频提示词",
        "images": [],
        "input": {
            "model": "seedance-2.0-mini",
            "ratio": "9:16",
            "seconds": 5,
            "prompt": "x",
            "resolution": "8k",
        },
    }
    _stub_video_route(monkeypatch, db, run_args)
    try:
        response = client.post(
            "/api/v1/film/tasks/video",
            json={"shot_id": "shot-1", "reference_mode": "first", "prompt": "p", "images": [], "ratio": "9:16"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert "不可提交" in response.json()["message"]
    assert db.added == [], "被拒绝时不应写入任何任务行"


def test_video_route_reports_bound_audio_limitation(client: TestClient, monkeypatch) -> None:
    """断点④·声音侧：镜头绑了声音但供应商不接受上传音频时，必须在响应里说清楚。

    这条断言防的是"看起来接上了"：声音的 file_id 会进入生成入参（可追溯），
    但 APIMart 协议没有音频输入字段，所以响应里必须明确告知"本次不会携带"。
    """
    db = _FakeDB()
    run_args = {
        "prompt": "最终视频提示词",
        "images": [],
        "provider": "apimart",
        "input": {"model": "seedance-2.0-mini", "ratio": "9:16", "seconds": 5, "prompt": "x"},
    }
    _stub_video_route(monkeypatch, db, run_args)

    async def _fake_attach(db_, *, shot_id, input_payload, provider, model):  # noqa: ANN001
        input_payload["audio_source_file_id"] = "file-audio-x"
        return ["镜头已绑定声音「配音」，但当前视频供应商/模型不接受上传音频：本次生成请求不会携带该音频。"]

    monkeypatch.setattr(route, "attach_shot_audio_to_video_input", _fake_attach)
    try:
        response = client.post(
            "/api/v1/film/tasks/video",
            json={"shot_id": "shot-1", "reference_mode": "first", "prompt": "p", "images": [], "ratio": "9:16"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    warnings = (response.json().get("meta") or {}).get("video_option_warnings") or []
    assert any("不会携带该音频" in item for item in warnings)
    assert run_args["input"]["audio_source_file_id"] == "file-audio-x"
