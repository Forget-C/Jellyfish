from __future__ import annotations

from collections.abc import AsyncGenerator

from app.api.v1.routes import script_processing as script_processing_route
from app.dependencies import get_db
from app.main import app
from app.services.script_processing_tasks import (
    AsyncTaskCreateResult,
    CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE,
    CHAPTER_DIVISION_RELATION_TYPE,
    CONSISTENCY_CHECK_RELATION_TYPE,
    COSTUME_INFO_ANALYSIS_RELATION_TYPE,
    ENTITY_MERGE_RELATION_TYPE,
    PROP_INFO_ANALYSIS_RELATION_TYPE,
    SCENE_INFO_ANALYSIS_RELATION_TYPE,
    SCRIPT_OPTIMIZATION_RELATION_TYPE,
    SCRIPT_SIMPLIFICATION_RELATION_TYPE,
    SCRIPT_EXTRACTION_RELATION_TYPE,
    VARIANT_ANALYSIS_RELATION_TYPE,
)
from app.core.task_manager.types import TaskStatus


def _override_db():
    class _FakeDB:
        async def commit(self) -> None:
            return None

    async def _get_db() -> AsyncGenerator[None, None]:
        yield _FakeDB()

    return _get_db


def test_divide_async_returns_created_task_payload(client, monkeypatch) -> None:
    async def _fake_create_divide_task(_db, *, chapter_id: str, script_text: str, write_to_db: bool):
        assert chapter_id == "chapter-1"
        assert script_text == "一段剧本"
        assert write_to_db is True
        return AsyncTaskCreateResult(
            task_id="task-1",
            status=TaskStatus.pending,
            reused=False,
            relation_type=CHAPTER_DIVISION_RELATION_TYPE,
            relation_entity_id="chapter-1",
        )

    monkeypatch.setattr(script_processing_route, "create_divide_task", _fake_create_divide_task)
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post(
            "/api/v1/script-processing/divide-async",
            json={
                "chapter_id": "chapter-1",
                "script_text": "一段剧本",
                "write_to_db": True,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["task_id"] == "task-1"
    assert body["data"]["status"] == "pending"
    assert body["data"]["reused"] is False


def test_extract_async_returns_created_task_payload(client, monkeypatch) -> None:
    async def _fake_create_extract_task(
        _db,
        *,
        project_id: str,
        chapter_id: str,
        script_division: dict,
        consistency: dict | None,
        refresh_cache: bool,
    ):
        assert project_id == "project-1"
        assert chapter_id == "chapter-1"
        assert script_division == {"shots": []}
        assert consistency is None
        assert refresh_cache is False
        return AsyncTaskCreateResult(
            task_id="task-extract-1",
            status=TaskStatus.pending,
            reused=False,
            relation_type=SCRIPT_EXTRACTION_RELATION_TYPE,
            relation_entity_id="chapter-1",
        )

    monkeypatch.setattr(script_processing_route, "create_extract_task", _fake_create_extract_task)
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post(
            "/api/v1/script-processing/extract-async",
            json={
                "project_id": "project-1",
                "chapter_id": "chapter-1",
                "script_division": {"shots": []},
                "consistency": None,
                "refresh_cache": False,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["task_id"] == "task-extract-1"
    assert body["data"]["status"] == "pending"
    assert body["data"]["reused"] is False


def test_merge_entities_async_returns_created_task_payload(client, monkeypatch) -> None:
    async def _fake_create_merge_task(
        _db,
        *,
        relation_entity_id: str,
        all_shot_extractions: list[dict],
        historical_library: dict | None,
        script_division: dict | None,
        previous_merge: dict | None,
        conflict_resolutions: list[dict] | None,
    ):
        assert relation_entity_id == "chapter-1"
        assert all_shot_extractions == []
        assert historical_library is None
        assert script_division is None
        assert previous_merge is None
        assert conflict_resolutions is None
        return AsyncTaskCreateResult(
            task_id="task-merge-1",
            status=TaskStatus.pending,
            reused=False,
            relation_type=ENTITY_MERGE_RELATION_TYPE,
            relation_entity_id="chapter-1",
        )

    def _fake_pick_relation_entity_id(*, chapter_id: str | None, project_id: str | None) -> str:
        assert chapter_id == "chapter-1"
        assert project_id == "project-1"
        return "chapter-1"

    monkeypatch.setattr(script_processing_route, "pick_merge_relation_entity_id", _fake_pick_relation_entity_id)
    monkeypatch.setattr(script_processing_route, "create_merge_task", _fake_create_merge_task)
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post(
            "/api/v1/script-processing/merge-entities-async",
            json={
                "project_id": "project-1",
                "chapter_id": "chapter-1",
                "all_shot_extractions": [],
                "historical_library": None,
                "script_division": None,
                "previous_merge": None,
                "conflict_resolutions": None,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["task_id"] == "task-merge-1"
    assert body["data"]["status"] == "pending"
    assert body["data"]["reused"] is False


def test_check_consistency_async_returns_created_task_payload(client, monkeypatch) -> None:
    async def _fake_create_consistency_task(_db, *, relation_entity_id: str, script_text: str):
        assert relation_entity_id == "chapter-1"
        assert script_text == "完整剧本"
        return AsyncTaskCreateResult(
            task_id="task-consistency-1",
            status=TaskStatus.pending,
            reused=False,
            relation_type=CONSISTENCY_CHECK_RELATION_TYPE,
            relation_entity_id="chapter-1",
        )

    def _fake_pick_relation_entity_id(*, chapter_id: str | None, project_id: str | None) -> str:
        assert chapter_id == "chapter-1"
        assert project_id == "project-1"
        return "chapter-1"

    monkeypatch.setattr(script_processing_route, "pick_consistency_relation_entity_id", _fake_pick_relation_entity_id)
    monkeypatch.setattr(script_processing_route, "create_consistency_task", _fake_create_consistency_task)
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post(
            "/api/v1/script-processing/check-consistency-async",
            json={
                "project_id": "project-1",
                "chapter_id": "chapter-1",
                "script_text": "完整剧本",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["task_id"] == "task-consistency-1"
    assert body["data"]["status"] == "pending"
    assert body["data"]["reused"] is False


def test_analyze_variants_async_returns_created_task_payload(client, monkeypatch) -> None:
    async def _fake_create_variant_task(
        _db,
        *,
        relation_entity_id: str,
        merged_library: dict,
        all_shot_extractions: list[dict],
        script_division: dict | None,
    ):
        assert relation_entity_id == "chapter-1"
        assert merged_library == {}
        assert all_shot_extractions == []
        assert script_division is None
        return AsyncTaskCreateResult(
            task_id="task-variant-1",
            status=TaskStatus.pending,
            reused=False,
            relation_type=VARIANT_ANALYSIS_RELATION_TYPE,
            relation_entity_id="chapter-1",
        )

    def _fake_pick_relation_entity_id(*, chapter_id: str | None, project_id: str | None) -> str:
        assert chapter_id == "chapter-1"
        assert project_id == "project-1"
        return "chapter-1"

    monkeypatch.setattr(script_processing_route, "pick_variant_relation_entity_id", _fake_pick_relation_entity_id)
    monkeypatch.setattr(script_processing_route, "create_variant_task", _fake_create_variant_task)
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post(
            "/api/v1/script-processing/analyze-variants-async",
            json={
                "project_id": "project-1",
                "chapter_id": "chapter-1",
                "merged_library": {},
                "all_shot_extractions": [],
                "script_division": None,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["task_id"] == "task-variant-1"
    assert body["data"]["status"] == "pending"
    assert body["data"]["reused"] is False


def test_analyze_character_portrait_async_returns_created_task_payload(client, monkeypatch) -> None:
    async def _fake_create(_db, *, relation_entity_id: str, character_context: str | None, character_description: str):
        assert relation_entity_id == "chapter-1"
        assert character_context is None
        assert character_description == "人物描述"
        return AsyncTaskCreateResult("task-char-1", TaskStatus.pending, False, CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE, "chapter-1")

    def _fake_pick(*, relation_entity_id: str | None = None, chapter_id: str | None, project_id: str | None, endpoint: str) -> str:
        assert relation_entity_id is None
        assert chapter_id == "chapter-1"
        assert project_id == "project-1"
        assert endpoint == "analyze-character-portrait-async"
        return "chapter-1"

    monkeypatch.setattr(script_processing_route, "pick_analysis_relation_entity_id", _fake_pick)
    monkeypatch.setattr(script_processing_route, "create_character_portrait_task", _fake_create)
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post("/api/v1/script-processing/analyze-character-portrait-async", json={"project_id": "project-1", "chapter_id": "chapter-1", "character_context": None, "character_description": "人物描述"})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["data"]["task_id"] == "task-char-1"


def test_analyze_prop_info_async_returns_created_task_payload(client, monkeypatch) -> None:
    async def _fake_create(_db, *, relation_entity_id: str, prop_context: str | None, prop_description: str):
        assert relation_entity_id == "chapter-1"
        assert prop_context is None
        assert prop_description == "道具描述"
        return AsyncTaskCreateResult("task-prop-1", TaskStatus.pending, False, PROP_INFO_ANALYSIS_RELATION_TYPE, "chapter-1")

    def _fake_pick(*, relation_entity_id: str | None = None, chapter_id: str | None, project_id: str | None, endpoint: str) -> str:
        assert relation_entity_id is None
        assert endpoint == "analyze-prop-info-async"
        return "chapter-1"

    monkeypatch.setattr(script_processing_route, "pick_analysis_relation_entity_id", _fake_pick)
    monkeypatch.setattr(script_processing_route, "create_prop_info_task", _fake_create)
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post("/api/v1/script-processing/analyze-prop-info-async", json={"project_id": "project-1", "chapter_id": "chapter-1", "prop_context": None, "prop_description": "道具描述"})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["data"]["task_id"] == "task-prop-1"


def test_analyze_scene_info_async_returns_created_task_payload(client, monkeypatch) -> None:
    async def _fake_create(_db, *, relation_entity_id: str, scene_context: str | None, scene_description: str):
        assert relation_entity_id == "chapter-1"
        assert scene_context is None
        assert scene_description == "场景描述"
        return AsyncTaskCreateResult("task-scene-1", TaskStatus.pending, False, SCENE_INFO_ANALYSIS_RELATION_TYPE, "chapter-1")

    def _fake_pick(*, relation_entity_id: str | None = None, chapter_id: str | None, project_id: str | None, endpoint: str) -> str:
        assert relation_entity_id is None
        assert endpoint == "analyze-scene-info-async"
        return "chapter-1"

    monkeypatch.setattr(script_processing_route, "pick_analysis_relation_entity_id", _fake_pick)
    monkeypatch.setattr(script_processing_route, "create_scene_info_task", _fake_create)
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post("/api/v1/script-processing/analyze-scene-info-async", json={"project_id": "project-1", "chapter_id": "chapter-1", "scene_context": None, "scene_description": "场景描述"})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["data"]["task_id"] == "task-scene-1"


def test_analyze_costume_info_async_returns_created_task_payload(client, monkeypatch) -> None:
    async def _fake_create(_db, *, relation_entity_id: str, costume_context: str | None, costume_description: str):
        assert relation_entity_id == "chapter-1"
        assert costume_context is None
        assert costume_description == "服装描述"
        return AsyncTaskCreateResult("task-costume-1", TaskStatus.pending, False, COSTUME_INFO_ANALYSIS_RELATION_TYPE, "chapter-1")

    def _fake_pick(*, relation_entity_id: str | None = None, chapter_id: str | None, project_id: str | None, endpoint: str) -> str:
        assert relation_entity_id is None
        assert endpoint == "analyze-costume-info-async"
        return "chapter-1"

    monkeypatch.setattr(script_processing_route, "pick_analysis_relation_entity_id", _fake_pick)
    monkeypatch.setattr(script_processing_route, "create_costume_info_task", _fake_create)
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post("/api/v1/script-processing/analyze-costume-info-async", json={"project_id": "project-1", "chapter_id": "chapter-1", "costume_context": None, "costume_description": "服装描述"})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["data"]["task_id"] == "task-costume-1"


def test_optimize_script_async_returns_created_task_payload(client, monkeypatch) -> None:
    async def _fake_create(_db, *, relation_entity_id: str, script_text: str, consistency: dict):
        assert relation_entity_id == "chapter-opt"
        assert script_text == "原始剧本"
        assert consistency == {"has_issues": True}
        return AsyncTaskCreateResult("task-opt-1", TaskStatus.pending, False, SCRIPT_OPTIMIZATION_RELATION_TYPE, "chapter-opt")

    def _fake_pick(*, chapter_id: str | None, project_id: str | None, endpoint: str) -> str:
        assert endpoint == "optimize-script-async"
        return "chapter-opt"

    monkeypatch.setattr(script_processing_route, "pick_analysis_relation_entity_id", _fake_pick)
    monkeypatch.setattr(script_processing_route, "create_script_optimization_task", _fake_create)
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post(
            "/api/v1/script-processing/optimize-script-async",
            json={
                "project_id": "project-1",
                "chapter_id": "chapter-opt",
                "script_text": "原始剧本",
                "consistency": {"has_issues": True},
            },
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["data"]["task_id"] == "task-opt-1"


def test_simplify_script_async_returns_created_task_payload(client, monkeypatch) -> None:
    async def _fake_create(_db, *, relation_entity_id: str, script_text: str):
        assert relation_entity_id == "chapter-simplify"
        assert script_text == "原始剧本"
        return AsyncTaskCreateResult("task-simplify-1", TaskStatus.pending, False, SCRIPT_SIMPLIFICATION_RELATION_TYPE, "chapter-simplify")

    def _fake_pick(*, chapter_id: str | None, project_id: str | None, endpoint: str) -> str:
        assert endpoint == "simplify-script-async"
        return "chapter-simplify"

    monkeypatch.setattr(script_processing_route, "pick_analysis_relation_entity_id", _fake_pick)
    monkeypatch.setattr(script_processing_route, "create_script_simplification_task", _fake_create)
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post(
            "/api/v1/script-processing/simplify-script-async",
            json={
                "project_id": "project-1",
                "chapter_id": "chapter-simplify",
                "script_text": "原始剧本",
            },
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["data"]["task_id"] == "task-simplify-1"


def test_script_optimization_and_simplification_sync_routes_are_not_public(client) -> None:
    """防止同步兼容接口重新绕过统一异步任务执行链。"""
    optimize_response = client.post("/api/v1/script-processing/optimize-script", json={})
    simplify_response = client.post("/api/v1/script-processing/simplify-script", json={})

    assert optimize_response.status_code == 404
    assert simplify_response.status_code == 404
