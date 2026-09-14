"""shot extracted candidates 接口响应壳测试。"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi.testclient import TestClient

from app.api.v1.routes.studio import shots as route
from app.dependencies import get_db
from app.main import app
from app.models.studio import ShotCandidateStatus, ShotCandidateType, ShotDialogueCandidateStatus, ShotStatus
from app.schemas.studio.shots import (
    ActionBeatPhaseRead,
    ShotAssetsOverviewRead,
    ShotAssetsOverviewSummary,
    ShotExtractionSummaryRead,
    ShotPreparationStateRead,
    ShotRuntimeSummaryRead,
    ShotRead,
)


class _FakeDB:
    pass


def _override_db(db: _FakeDB):
    async def _get_db() -> AsyncGenerator[_FakeDB, None]:
        yield db

    return _get_db


def _fake_preparation_state() -> ShotPreparationStateRead:
    return ShotPreparationStateRead(
        shot=ShotRead(
            id="shot-1",
            chapter_id="chapter-1",
            index=1,
            title="镜头一",
            thumbnail="",
            status=ShotStatus.ready,
            skip_extraction=False,
            script_excerpt="摘录",
            generated_video_file_id=None,
            last_extracted_at=None,
            extraction=ShotExtractionSummaryRead(
                state="extracted_resolved",
                has_extracted=True,
                last_extracted_at=None,
                asset_candidate_total=1,
                dialogue_candidate_total=0,
                pending_asset_count=0,
                pending_dialogue_count=0,
            ),
        ),
        assets_overview=ShotAssetsOverviewRead(
            shot_id="shot-1",
            skip_extraction=False,
            status=ShotStatus.ready,
            summary=ShotAssetsOverviewSummary(
                linked_count=1,
                pending_count=0,
                ignored_count=0,
                total_count=1,
            ),
            items=[],
        ),
        dialogue_candidates=[],
        saved_dialogue_lines=[],
        pending_confirm_count=0,
        basic_info_ready=True,
        semantic_defaults_ready=True,
        action_beats_ready=True,
        action_beats_count=3,
        action_beat_phases=[
            ActionBeatPhaseRead(text="听到异响骤然僵住", phase="trigger"),
            ActionBeatPhaseRead(text="修枝剪脱手下坠", phase="peak"),
            ActionBeatPhaseRead(text="蹲下后呼吸急促", phase="aftermath"),
        ],
        ready_for_generation=True,
    )


def test_get_shot_extracted_candidates_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _FakeDB()

    class _Candidate:
        id = 1
        shot_id = "shot-1"
        candidate_type = ShotCandidateType.character
        candidate_name = "仙女A"
        candidate_status = ShotCandidateStatus.pending
        linked_entity_id = None
        source = "extraction"
        payload = {}
        confirmed_at = None
        created_at = "2026-01-01T00:00:00Z"
        updated_at = "2026-01-01T00:00:00Z"

    async def _fake_list(*_args, **_kwargs):
        return [_Candidate()]

    monkeypatch.setattr(route, "list_shot_extracted_candidates", _fake_list)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/shots/shot-1/extracted-candidates")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["message"] == "success"
    assert body["data"][0]["candidate_name"] == "仙女A"
    assert body["data"][0]["candidate_status"] == "pending"


def test_update_shot_skip_extraction_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _FakeDB()

    class _Shot:
        id = "shot-1"
        chapter_id = "chapter-1"
        index = 1
        title = "镜头一"
        thumbnail = ""
        status = ShotStatus.ready
        skip_extraction = True
        script_excerpt = "摘录"
        generated_video_file_id = None

    async def _fake_set_skip(*_args, **_kwargs):
        return _Shot()

    async def _fake_build_state(*_args, **_kwargs):
        return _fake_preparation_state()

    monkeypatch.setattr(route, "set_skip_extraction", _fake_set_skip)
    monkeypatch.setattr(route, "build_shot_preparation_state", _fake_build_state)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.patch(
            "/api/v1/studio/shots/shot-1/skip-extraction",
            json={"skip": True},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["data"]["action"] == "skip_extraction"
    assert body["data"]["state"]["shot"]["status"] == "ready"
    assert body["data"]["state"]["action_beats_ready"] is True
    assert body["data"]["state"]["action_beats_count"] == 3
    assert body["data"]["state"]["action_beat_phases"][0]["phase"] == "trigger"
    assert body["data"]["state"]["ready_for_generation"] is True


def test_link_extracted_candidate_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _FakeDB()

    class _Candidate:
        id = 2
        shot_id = "shot-1"
        candidate_type = ShotCandidateType.scene
        candidate_name = "河边"
        candidate_status = ShotCandidateStatus.linked
        linked_entity_id = "scene-1"
        source = "extraction"
        payload = {}
        confirmed_at = None
        created_at = "2026-01-01T00:00:00Z"
        updated_at = "2026-01-01T00:00:00Z"

    async def _fake_link(*_args, **_kwargs):
        return _Candidate()

    async def _fake_build_state(*_args, **_kwargs):
        return _fake_preparation_state()

    monkeypatch.setattr(route, "link_shot_extracted_candidate", _fake_link)
    monkeypatch.setattr(route, "build_shot_preparation_state", _fake_build_state)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.patch(
            "/api/v1/studio/shots/extracted-candidates/2/link",
            json={"linked_entity_id": "scene-1"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["data"]["action"] == "link_asset_candidate"
    assert body["data"]["state"]["shot"]["id"] == "shot-1"
    assert body["data"]["state"]["assets_overview"]["summary"]["linked_count"] == 1


def test_ignore_extracted_candidate_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _FakeDB()

    class _Candidate:
        id = 3
        shot_id = "shot-1"
        candidate_type = ShotCandidateType.prop
        candidate_name = "银斧头"
        candidate_status = ShotCandidateStatus.ignored
        linked_entity_id = None
        source = "extraction"
        payload = {}
        confirmed_at = None
        created_at = "2026-01-01T00:00:00Z"
        updated_at = "2026-01-01T00:00:00Z"

    async def _fake_ignore(*_args, **_kwargs):
        return _Candidate()

    async def _fake_build_state(*_args, **_kwargs):
        return _fake_preparation_state()

    monkeypatch.setattr(route, "ignore_shot_extracted_candidate", _fake_ignore)
    monkeypatch.setattr(route, "build_shot_preparation_state", _fake_build_state)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.patch("/api/v1/studio/shots/extracted-candidates/3/ignore")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["data"]["action"] == "ignore_asset_candidate"
    assert body["data"]["state"]["shot"]["id"] == "shot-1"


def test_get_shot_preparation_state_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _FakeDB()

    async def _fake_build_state(*_args, **_kwargs):
        return _fake_preparation_state()

    monkeypatch.setattr(route, "build_shot_preparation_state", _fake_build_state)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/shots/shot-1/preparation-state")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["data"]["shot"]["id"] == "shot-1"
    assert body["data"]["assets_overview"]["shot_id"] == "shot-1"
    assert body["data"]["ready_for_generation"] is True


def test_link_existing_asset_for_preparation_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _FakeDB()

    async def _fake_link_existing(*_args, **_kwargs):
        return _fake_preparation_state()

    monkeypatch.setattr(route, "link_existing_asset_for_preparation", _fake_link_existing)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(
            "/api/v1/studio/shots/shot-1/preparation-link",
            json={
                "project_id": "project-1",
                "chapter_id": "chapter-1",
                "entity_type": "scene",
                "linked_entity_id": "scene-1",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["data"]["action"] == "link_asset_candidate"
    assert body["data"]["state"]["shot"]["id"] == "shot-1"


def test_get_shot_extracted_dialogue_candidates_returns_success_envelope(
    client: TestClient,
    monkeypatch,
) -> None:
    db = _FakeDB()

    class _Candidate:
        id = 4
        shot_id = "shot-1"
        index = 1
        text = "你终于来了。"
        line_mode = "DIALOGUE"
        speaker_name = "男子"
        target_name = None
        candidate_status = ShotDialogueCandidateStatus.pending
        linked_dialog_line_id = None
        source = "extraction"
        payload = {}
        confirmed_at = None
        created_at = "2026-01-01T00:00:00Z"
        updated_at = "2026-01-01T00:00:00Z"

    async def _fake_list(*_args, **_kwargs):
        return [_Candidate()]

    monkeypatch.setattr(route, "list_shot_extracted_dialogue_candidates", _fake_list)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/shots/shot-1/extracted-dialogue-candidates")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["data"][0]["text"] == "你终于来了。"
    assert body["data"][0]["candidate_status"] == "pending"


def test_preview_shot_video_prompt_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _FakeDB()

    class _Preview:
        shot_id = "shot-1"
        template_id = "tpl-1"
        template_name = "视频模板"
        rendered_prompt = "视频提示词"
        warnings = []
        pack = {
            "shot_id": "shot-1",
            "title": "镜头一",
            "script_excerpt": "摘录",
            "action_beats": [],
            "dialogue_summary": "",
            "characters": [],
            "scene": None,
            "props": [],
            "costumes": [],
            "camera": {
                "camera_shot": "",
                "angle": "",
                "movement": "",
                "duration": None,
            },
            "atmosphere": "",
            "visual_style": "",
            "style": "",
            "negative_prompt": "",
        }

    async def _fake_derive(*_args, **_kwargs):
        return _Preview()

    monkeypatch.setattr(route, "derive_video_preview", _fake_derive)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/shots/shot-1/video-prompt-preview")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["data"]["rendered_prompt"] == "视频提示词"
    assert body["data"]["pack"]["title"] == "镜头一"


def test_get_shot_video_readiness_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _FakeDB()

    class _Readiness:
        shot_id = "shot-1"
        reference_mode = "text_only"
        ready = True
        checks = [
            {
                "key": "extraction_ready",
                "ok": True,
                "message": "信息提取确认已完成",
            }
        ]

    async def _fake_readiness(*_args, **_kwargs):
        return _Readiness()

    monkeypatch.setattr(route, "get_shot_video_readiness", _fake_readiness)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/shots/shot-1/video-readiness")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["data"]["ready"] is True
    assert body["data"]["checks"][0]["key"] == "extraction_ready"


def test_list_shot_runtime_summary_returns_success_envelope(client: TestClient, monkeypatch) -> None:
    db = _FakeDB()

    async def _fake_runtime_summary(*_args, **_kwargs):
        return [
            ShotRuntimeSummaryRead(
                shot_id="shot-1",
                has_active_tasks=True,
                has_active_video_tasks=True,
                has_active_frame_tasks=False,
                active_task_count=1,
            )
        ]

    monkeypatch.setattr(route, "list_shot_runtime_summary_by_chapter", _fake_runtime_summary)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.get("/api/v1/studio/shots/runtime-summary", params={"chapter_id": "chapter-1"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["data"][0]["shot_id"] == "shot-1"
    assert body["data"][0]["has_active_tasks"] is True


def test_accept_extracted_dialogue_candidate_returns_success_envelope(
    client: TestClient,
    monkeypatch,
) -> None:
    db = _FakeDB()

    class _Candidate:
        id = 5
        shot_id = "shot-1"
        index = 1
        text = "你终于来了。"
        line_mode = "DIALOGUE"
        speaker_name = "男子"
        target_name = None
        candidate_status = ShotDialogueCandidateStatus.accepted
        linked_dialog_line_id = 11
        source = "extraction"
        payload = {}
        confirmed_at = None
        created_at = "2026-01-01T00:00:00Z"
        updated_at = "2026-01-01T00:00:00Z"

    async def _fake_accept(*_args, **_kwargs):
        return _Candidate()

    async def _fake_build_state(*_args, **_kwargs):
        return _fake_preparation_state()

    monkeypatch.setattr(route, "accept_shot_extracted_dialogue_candidate", _fake_accept)
    monkeypatch.setattr(route, "build_shot_preparation_state", _fake_build_state)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.patch(
            "/api/v1/studio/shots/extracted-dialogue-candidates/5/accept",
            json={},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["data"]["action"] == "accept_dialogue_candidate"
    assert body["data"]["state"]["shot"]["id"] == "shot-1"
    assert body["data"]["state"]["ready_for_generation"] is True


def test_ignore_extracted_dialogue_candidate_returns_success_envelope(
    client: TestClient,
    monkeypatch,
) -> None:
    db = _FakeDB()

    class _Candidate:
        id = 6
        shot_id = "shot-1"
        index = 1
        text = "你终于来了。"
        line_mode = "DIALOGUE"
        speaker_name = "男子"
        target_name = None
        candidate_status = ShotDialogueCandidateStatus.ignored
        linked_dialog_line_id = None
        source = "extraction"
        payload = {}
        confirmed_at = None
        created_at = "2026-01-01T00:00:00Z"
        updated_at = "2026-01-01T00:00:00Z"

    async def _fake_ignore(*_args, **_kwargs):
        return _Candidate()

    async def _fake_build_state(*_args, **_kwargs):
        return _fake_preparation_state()

    monkeypatch.setattr(route, "ignore_shot_extracted_dialogue_candidate", _fake_ignore)
    monkeypatch.setattr(route, "build_shot_preparation_state", _fake_build_state)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.patch("/api/v1/studio/shots/extracted-dialogue-candidates/6/ignore")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["data"]["action"] == "ignore_dialogue_candidate"
    assert body["data"]["state"]["shot"]["id"] == "shot-1"
