"""路由层：四个预览入口的挂载、统一 ApiResponse 信封、失败结构化明细、DRY_RUN 不触网。"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

BASE = "/api/v1/studio/llm"

ENTITY_URL = f"{BASE}/entity-extraction/preview"
IMAGE_URL = f"{BASE}/image-prompt/preview"
VIDEO_URL = f"{BASE}/video-prompt/preview"
BINDING_URL = f"{BASE}/asset-binding/preview"
STATUS_URL = f"{BASE}/orchestration/status"

SOURCE = "将军府庭院内，秦老夫人拄着拐杖逼问姜岁欢嫁妆下落。姜岁欢攥紧手中玉佩，沉默不语。"
SHOT_TEXT = "姜岁欢跪在庭院中央抬头，秦老夫人拄拐俯视，气氛压迫。"


@pytest.fixture(autouse=True)
def _force_dry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JELLYFISH_DRY_RUN", "1")
    monkeypatch.delenv("JELLYFISH_REAL_LLM_CONFIRMED", raising=False)


def test_preview_routes_are_registered(client: TestClient) -> None:
    from app.main import app

    paths = {route.path for route in app.routes if hasattr(route, "path")}
    assert ENTITY_URL in paths
    assert IMAGE_URL in paths
    assert VIDEO_URL in paths
    assert BINDING_URL in paths
    assert STATUS_URL in paths


def test_entity_extraction_route_returns_structured_preview(client: TestClient) -> None:
    response = client.post(
        ENTITY_URL,
        json={
            "chapter_text": SOURCE,
            "candidate_names": ["姜岁欢", "将军府庭院", "拐杖"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["message"] == "success"
    data = body["data"]
    assert data["meta"]["dry_run"] is True
    assert data["meta"]["llm_called"] is False
    assert [item["name"] for item in data["items"]] == ["姜岁欢", "将军府庭院", "拐杖"]
    assert data["dropped"] == []
    assert "未创建任何实体" in data["note"]


def test_image_prompt_route_returns_all_default_slots(client: TestClient) -> None:
    response = client.post(
        IMAGE_URL,
        json={
            "shot_text": SHOT_TEXT,
            "entity_profiles": [
                {"name": "姜岁欢", "entity_type": "character", "profile": "清冷少女，素色襦裙"}
            ],
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["meta"]["llm_called"] is False
    assert len(data["slots"]) == 9
    assert {slot["category"] for slot in data["slots"]} >= {
        "character_image_front",
        "scene_image_front",
        "costume_image_front",
        "frame_head_image",
        "frame_tail_image",
        "frame_key_image",
    }
    character_slot = next(slot for slot in data["slots"] if slot["category"] == "character_image_front")
    assert character_slot["layers"]["subject"].startswith("姜岁欢（角色）：")
    assert character_slot["prompt"]
    assert character_slot["negative_prompt"]


def test_video_prompt_route_returns_aligned_preview(client: TestClient) -> None:
    response = client.post(
        VIDEO_URL,
        json={"shot_text": SHOT_TEXT, "camera_movement": "推", "duration_seconds": 8},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["meta"]["llm_called"] is False
    assert data["camera_movement"]["key"] == "推"
    assert data["camera_movement"]["enum_code"] == "DOLLY_IN"
    assert data["camera"]["movement"] == "推镜（缓慢推近）"
    assert data["duration_seconds"] == 8
    assert data["final_prompt"].startswith("[DRY_RUN 占位]")
    assert "未提交任何视频生成任务" in data["note"]


def test_status_route_exposes_guard_and_vocab(client: TestClient) -> None:
    response = client.get(STATUS_URL)

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["guard"]["dry_run"] is True
    assert data["guard"]["real_call_confirmed"] is False
    for required in ("推", "拉", "摇", "移", "跟", "环绕"):
        assert required in data["camera_movement_keys"]
    assert set(data["entity_type_whitelist"]) == {"character", "scene", "prop"}


def test_missing_input_returns_structured_error_in_envelope(client: TestClient) -> None:
    response = client.post(ENTITY_URL, json={})

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == 400
    assert body["data"] is None
    assert body["meta"]["error"]["code"] == "llm_orchestration_error"
    assert "chapter_id" in body["meta"]["error"]["message"]
    # 出错时也不能是裸异常字符串
    assert isinstance(body["meta"]["error"], dict)


def test_unknown_shot_id_returns_404_envelope(client: TestClient) -> None:
    response = client.post(VIDEO_URL, json={"shot_id": "shot-does-not-exist"})

    assert response.status_code == 404
    body = response.json()
    assert body["code"] == 404
    assert body["meta"]["error"]["message"]


def test_image_prompt_route_refuses_when_the_requested_asset_has_no_materials(client: TestClient) -> None:
    """本次要的资产都没有可用于出图的资料 → 结构化 422（原因 + 怎么补），页面据此标在那一行。

    统一信封必须把结构化明细原样放进 `meta.error`：页面"逐项隔离"就是靠读它，
    读不到就只能当成普通失败（那会把后面的项一起停掉）。
    """
    response = client.post(
        IMAGE_URL,
        json={
            "entity_profiles": [{"name": "苏晚棠素服", "entity_type": "costume", "profile": ""}],
            "categories": ["costume_image_front"],
        },
    )

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == 422
    assert body["data"] is None
    error = body["meta"]["error"]
    assert error["code"] == "asset_profile_missing"
    # 原因点名的是**这次要的那一项**（不把没被要求的资产列进来）
    assert "苏晚棠素服" in error["message"]
    assert "没有可用于出图的资料" in error["message"]
    # 怎么补必须给（用户照做就能拿到可用结果）
    assert error["fix"]
    assert error["assets"] == ["苏晚棠素服"]


def test_status_route_exposes_binding_confirm_endpoints(client: TestClient) -> None:
    data = client.get(STATUS_URL).json()["data"]

    endpoints = data["binding_confirm_endpoints"]
    assert endpoints["character"] == "POST /api/v1/studio/shot-character-links"
    assert endpoints["scene"] == "POST /api/v1/studio/shot-links/scene"
    assert endpoints["prop"] == "POST /api/v1/studio/shot-links/prop"
    assert endpoints["costume"] == "POST /api/v1/studio/shot-links/costume"


def test_asset_binding_route_rejects_project_without_assets(client: TestClient) -> None:
    response = client.post(BINDING_URL, json={"project_id": "project-that-does-not-exist"})

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == 400
    assert body["data"] is None
    assert isinstance(body["meta"]["error"], dict)


def test_dry_run_routes_never_touch_network(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DRY_RUN 开启时，四个路由一个真实 HTTP 请求都不发。"""
    hits: list[str] = []

    async def _forbidden_post(self, url, *args, **kwargs):  # type: ignore[no-untyped-def]
        hits.append(str(url))
        raise AssertionError(f"DRY_RUN 下不允许发起真实 HTTP 请求：{url}")

    monkeypatch.setattr(httpx.AsyncClient, "post", _forbidden_post, raising=True)

    assert client.post(ENTITY_URL, json={"chapter_text": SOURCE, "candidate_names": ["姜岁欢"]}).status_code == 200
    assert client.post(IMAGE_URL, json={"shot_text": SHOT_TEXT}).status_code == 200
    assert client.post(VIDEO_URL, json={"shot_text": SHOT_TEXT}).status_code == 200
    # 绑定接口对无资产项目返回 400，同样不应触网
    assert client.post(BINDING_URL, json={"project_id": "project-that-does-not-exist"}).status_code == 400

    assert hits == []
