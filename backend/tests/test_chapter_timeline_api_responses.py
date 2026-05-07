"""章节时间线 API 响应壳与错误码测试。"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi.testclient import TestClient

from app.api.v1.routes.studio import chapters as chapters_route
from app.dependencies import get_db
from app.main import app
from app.models.studio import Chapter
from app.services.studio.chapter_timeline import TimelineLayoutConflictError
from app.schemas.studio.chapter_timeline import (
    ChapterTimelineRead,
    ChapterTimelineSegmentRead,
    TimelineClipStatus,
)


class _DummyDB:
    pass


def _override_db(db: _DummyDB):
    async def _get_db() -> AsyncGenerator[_DummyDB, None]:
        yield db

    return _get_db


def test_get_chapter_timeline_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _DummyDB()

    async def _fake_build(_session, chapter_id: str) -> ChapterTimelineRead:
        assert chapter_id == "c1"
        return ChapterTimelineRead(
            layout_version=1,
            segments=[
                ChapterTimelineSegmentRead(
                    id="",
                    shot_id="s1",
                    position=0,
                    clip_status=TimelineClipStatus.missing_video,
                    label="镜1",
                ),
            ],
        )

    monkeypatch.setattr(chapters_route, "build_timeline_read", _fake_build)

    async def _fake_get_or_404(_db, model, _eid, **_kwargs):
        if model is Chapter:
            return object()
        return None

    monkeypatch.setattr(chapters_route, "get_or_404", _fake_get_or_404)

    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/chapters/c1/timeline")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["data"]["layout_version"] == 1
    assert body["data"]["segments"][0]["shot_id"] == "s1"


class _DummyDbWithChapter:
    """占位：满足 Depends 注入形状。"""


def test_put_chapter_timeline_layout_conflict_returns_409(client: TestClient, monkeypatch) -> None:
    db = _DummyDbWithChapter()

    async def _fake_replace(*_args, **_kwargs):
        raise TimelineLayoutConflictError(server_version=2, client_version=1)

    monkeypatch.setattr(chapters_route, "replace_timeline_segments", _fake_replace)

    async def _fake_get_or_404(_db, model, _eid, **_kwargs):
        if model is Chapter:
            return object()
        return None

    monkeypatch.setattr(chapters_route, "get_or_404", _fake_get_or_404)

    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.put(
            "/api/v1/studio/chapters/c1/timeline",
            json={"segments": [{"shot_id": "s1"}], "layout_version": 1},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409
    body = response.json()
    assert body["code"] == 409
    assert body["data"] is None
    assert "server_layout_version" in body["message"] or "conflict" in body["message"].lower()


def test_put_chapter_timeline_bad_request_returns_400(client: TestClient, monkeypatch) -> None:
    db = _DummyDbWithChapter()

    async def _fake_replace(*_args, **_kwargs):
        raise ValueError("shot_id 不属于该章节: x")

    monkeypatch.setattr(chapters_route, "replace_timeline_segments", _fake_replace)

    async def _fake_get_or_404(_db, model, _eid, **_kwargs):
        if model is Chapter:
            return object()
        return None

    monkeypatch.setattr(chapters_route, "get_or_404", _fake_get_or_404)

    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.put(
            "/api/v1/studio/chapters/c1/timeline",
            json={"segments": [{"shot_id": "x"}]},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    err = response.json()
    assert err["code"] == 400
    assert "不属于" in err["message"] or "shot_id" in err["message"]


def test_put_chapter_timeline_success_returns_envelope(client: TestClient, monkeypatch) -> None:
    db = _DummyDbWithChapter()

    async def _fake_replace(*_args, **_kwargs):
        return ChapterTimelineRead(layout_version=2, segments=[])

    monkeypatch.setattr(chapters_route, "replace_timeline_segments", _fake_replace)

    async def _fake_get_or_404(_db, model, _eid, **_kwargs):
        if model is Chapter:
            return object()
        return None

    monkeypatch.setattr(chapters_route, "get_or_404", _fake_get_or_404)

    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.put(
            "/api/v1/studio/chapters/c1/timeline",
            json={"segments": [{"shot_id": "s1"}]},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["data"]["layout_version"] == 2
