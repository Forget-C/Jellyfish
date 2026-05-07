"""Studio 主链路接口响应壳测试：projects / chapters / shots。"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.dependencies import get_db
from app.main import app
from app.models.studio import (
    Chapter,
    ChapterStatus,
    Project,
    ProjectStyle,
    ProjectVisualStyle,
    Shot,
    ShotStatus,
)


class _FakeStudioDB:
    """最小 Studio DB 替身：仅覆盖项目/章节/镜头接口测试所需行为。"""

    def __init__(self) -> None:
        self.projects: dict[str, Project] = {}
        self.chapters: dict[str, Chapter] = {}
        self.shots: dict[str, Shot] = {}

    async def get(self, model: type, entity_id: str):  # noqa: ANN001
        if model is Project:
            return self.projects.get(entity_id)
        if model is Chapter:
            return self.chapters.get(entity_id)
        if model is Shot:
            return self.shots.get(entity_id)
        return None

    def add(self, obj: object) -> None:
        if isinstance(obj, Project):
            self.projects[obj.id] = obj
            return
        if isinstance(obj, Chapter):
            self.chapters[obj.id] = obj
            return
        if isinstance(obj, Shot):
            self.shots[obj.id] = obj
            return
        raise TypeError(f"Unsupported object type: {type(obj)!r}")

    async def flush(self) -> None:
        return None

    async def refresh(self, obj: object) -> None:
        now = datetime.now(UTC)
        if getattr(obj, "created_at", None) is None:
            obj.created_at = now
        obj.updated_at = now

    async def delete(self, obj: object) -> None:
        if isinstance(obj, Project):
            self.projects.pop(obj.id, None)
            return
        if isinstance(obj, Chapter):
            self.chapters.pop(obj.id, None)
            return
        if isinstance(obj, Shot):
            self.shots.pop(obj.id, None)
            return
        raise TypeError(f"Unsupported object type: {type(obj)!r}")

    async def execute(self, _stmt):  # noqa: ANN001
        class _EmptyResult:
            def all(self) -> list[tuple]:
                return []

        return _EmptyResult()


def _override_db(db: _FakeStudioDB):
    async def _get_db() -> AsyncGenerator[_FakeStudioDB, None]:
        yield db

    return _get_db


def _seed_project(db: _FakeStudioDB, project_id: str = "proj-1") -> Project:
    now = datetime.now(UTC)
    obj = Project(
        id=project_id,
        name="测试项目",
        description="项目说明",
        style=ProjectStyle.real_people_city,
        visual_style=ProjectVisualStyle.live_action,
        seed=7,
        unify_style=True,
        progress=10,
        stats={},
    )
    obj.created_at = now
    obj.updated_at = now
    db.projects[obj.id] = obj
    return obj


def _seed_chapter(
    db: _FakeStudioDB,
    *,
    chapter_id: str = "ch-1",
    project_id: str = "proj-1",
) -> Chapter:
    now = datetime.now(UTC)
    obj = Chapter(
        id=chapter_id,
        project_id=project_id,
        index=1,
        title="第一章",
        summary="章节摘要",
        raw_text="原文",
        condensed_text="精简原文",
        storyboard_count=0,
        status=ChapterStatus.draft,
    )
    obj.created_at = now
    obj.updated_at = now
    db.chapters[obj.id] = obj
    return obj


def _seed_shot(
    db: _FakeStudioDB,
    *,
    shot_id: str = "shot-1",
    chapter_id: str = "ch-1",
) -> Shot:
    now = datetime.now(UTC)
    obj = Shot(
        id=shot_id,
        chapter_id=chapter_id,
        index=1,
        title="镜头一",
        thumbnail="",
        status=ShotStatus.pending,
        script_excerpt="剧本摘录",
        generated_video_file_id=None,
    )
    obj.created_at = now
    obj.updated_at = now
    db.shots[obj.id] = obj
    return obj


def test_create_project_returns_created_envelope(client: TestClient) -> None:
    db = _FakeStudioDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/projects",
            json={
                "id": "proj-create",
                "name": "新项目",
                "description": "说明",
                "style": "真人都市",
                "visual_style": "现实",
                "seed": 1,
                "unify_style": True,
                "progress": 0,
                "stats": {},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    body = response.json()
    assert body["code"] == 201
    assert body["message"] == "success"
    assert body["data"]["id"] == "proj-create"
    assert body["data"]["name"] == "新项目"


def test_project_style_options_returns_grouped_choices(client: TestClient) -> None:
    response = client.get("/api/v1/studio/projects/style-options")
    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert "视觉" in body["data"]["visual_styles"][0]["label"] or body["data"]["visual_styles"][0]["value"] in {"现实", "动漫"}
    assert "现实" in body["data"]["styles_by_visual_style"]
    assert "动漫" in body["data"]["styles_by_visual_style"]
    assert "video_ratios" not in body["data"]
    assert "default_video_ratio" not in body["data"]


def test_create_project_rejects_invalid_style_combo(client: TestClient) -> None:
    db = _FakeStudioDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/projects",
            json={
                "id": "proj-invalid-style",
                "name": "新项目",
                "description": "说明",
                "style": "真人都市",
                "visual_style": "动漫",
                "seed": 1,
                "unify_style": True,
                "progress": 0,
                "stats": {},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert "style is not allowed for visual_style" in response.json()["message"]


def test_get_project_not_found_returns_api_response(client: TestClient) -> None:
    db = _FakeStudioDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/projects/missing")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json() == {"code": 404, "message": "Project not found", "data": None, "meta": None}


def test_list_project_timeline_returns_empty_envelope(client: TestClient) -> None:
    db = _FakeStudioDB()
    _seed_project(db, "proj-timeline")
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/projects/proj-timeline/timeline")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"code": 200, "message": "success", "data": [], "meta": None}


def test_list_project_timeline_not_found_returns_api_response(client: TestClient) -> None:
    db = _FakeStudioDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/projects/missing/timeline")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json() == {"code": 404, "message": "Project not found", "data": None, "meta": None}


def test_delete_project_returns_empty_envelope(client: TestClient) -> None:
    db = _FakeStudioDB()
    _seed_project(db, "proj-delete")
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.delete("/api/v1/studio/projects/proj-delete")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"code": 200, "message": "success", "data": None, "meta": None}
    assert "proj-delete" not in db.projects


def test_create_chapter_returns_created_envelope(client: TestClient) -> None:
    db = _FakeStudioDB()
    _seed_project(db, "proj-chapter")
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/chapters",
            json={
                "id": "ch-create",
                "project_id": "proj-chapter",
                "index": 1,
                "title": "第一章",
                "summary": "摘要",
                "raw_text": "原文",
                "condensed_text": "精简原文",
                "storyboard_count": 0,
                "status": "draft",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    body = response.json()
    assert body["code"] == 201
    assert body["data"]["id"] == "ch-create"
    assert body["data"]["project_id"] == "proj-chapter"


def test_create_chapter_missing_project_returns_api_response(client: TestClient) -> None:
    db = _FakeStudioDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/chapters",
            json={
                "id": "ch-fail",
                "project_id": "proj-missing",
                "index": 1,
                "title": "第一章",
                "summary": "",
                "raw_text": "",
                "condensed_text": "",
                "storyboard_count": 0,
                "status": "draft",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json() == {"code": 400, "message": "Project not found", "data": None, "meta": None}


def test_get_chapter_not_found_returns_api_response(client: TestClient) -> None:
    db = _FakeStudioDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/chapters/missing")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json() == {"code": 404, "message": "Chapter not found", "data": None, "meta": None}


def test_create_shot_returns_created_envelope(client: TestClient) -> None:
    db = _FakeStudioDB()
    _seed_project(db, "proj-shot")
    _seed_chapter(db, chapter_id="ch-shot", project_id="proj-shot")
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/shots",
            json={
                "id": "shot-create",
                "chapter_id": "ch-shot",
                "index": 1,
                "title": "镜头一",
                "thumbnail": "",
                "status": "pending",
                "script_excerpt": "镜头内容",
                "generated_video_file_id": None,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    body = response.json()
    assert body["code"] == 201
    assert body["data"]["id"] == "shot-create"
    assert body["data"]["chapter_id"] == "ch-shot"


def test_get_shot_not_found_returns_api_response(client: TestClient) -> None:
    db = _FakeStudioDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/shots/missing")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json() == {"code": 404, "message": "Shot not found", "data": None, "meta": None}


def test_delete_shot_returns_empty_envelope(client: TestClient) -> None:
    db = _FakeStudioDB()
    _seed_project(db, "proj-shot-delete")
    _seed_chapter(db, chapter_id="ch-shot-delete", project_id="proj-shot-delete")
    _seed_shot(db, shot_id="shot-delete", chapter_id="ch-shot-delete")
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.delete("/api/v1/studio/shots/shot-delete")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"code": 200, "message": "success", "data": None, "meta": None}
    assert "shot-delete" not in db.shots


def test_create_shot_validation_error_returns_api_response(client: TestClient) -> None:
    db = _FakeStudioDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/shots",
            json={
                "id": "shot-invalid",
                "title": "缺字段镜头",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == 422
    assert body["data"] is None
    assert "chapter_id" in body["message"]
    assert "index" in body["message"]
