"""通过模板 API 校验创建、删除和异常响应壳。"""

import pytest

from tests.test_database_baseline_business import STUDIO, baseline_client


pytestmark = pytest.mark.asyncio
PROMPTS = STUDIO + "/prompts"


async def test_create_prompt_template_returns_created_envelope(baseline_client):
    client, _ = baseline_client
    response = await client.post(PROMPTS, json={
        "category": "video_prompt", "name": "视频生成提示词", "content": "请生成视频提示词",
        "preview": "预览文案", "variables": ["scene", "style"], "is_default": True,
    })
    assert response.status_code == 201
    body = response.json()
    assert body["code"] == 201
    assert body["message"] == "success"
    assert body["data"]["category"] == "video_prompt"
    assert body["data"]["name"] == "视频生成提示词"
    assert body["data"]["is_default"] is True
    assert body["data"]["is_system"] is False
    assert body["data"]["id"]


async def test_delete_prompt_template_returns_empty_envelope(baseline_client):
    client, _ = baseline_client
    created = await client.post(PROMPTS, json={"category": "video_prompt", "name": "可删除", "content": "内容"})
    assert created.status_code == 201
    path = PROMPTS + "/" + created.json()["data"]["id"]
    response = await client.delete(path)
    assert response.status_code == 200
    assert response.json() == {"code": 200, "message": "success", "data": None, "meta": None}
    assert (await client.get(path)).status_code == 404


async def test_get_prompt_template_not_found_returns_api_response(baseline_client):
    client, _ = baseline_client
    response = await client.get(PROMPTS + "/missing")
    assert response.status_code == 404
    assert response.json() == {
        "code": 404, "message": "PromptTemplate not found", "data": None, "meta": None,
    }


async def test_create_prompt_template_validation_error_returns_api_response(baseline_client):
    client, _ = baseline_client
    response = await client.post(PROMPTS, json={"name": "缺字段模板"})
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == 422
    assert body["data"] is None
    assert "category" in body["message"]
    assert "content" in body["message"]
