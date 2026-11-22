"""Model management exposes capability declarations separately from adapter support."""

from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.dependencies import get_db
from tests.support.llm_api_app import build_llm_only_app


@pytest.mark.asyncio
async def test_model_capabilities_follow_each_provider_config(tmp_path) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'capabilities.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def db_session():
        async with sessions.begin() as session:
            yield session

    app = build_llm_only_app()
    app.dependency_overrides[get_db] = db_session
    path = "/api/v1/llm"
    supported = {"declaration": "supported", "source": "供应商说明"}
    model = {
        "name": "qwen3-vl-flash",
        "category": "text",
        "params": {"temperature": 0.3},
    }

    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            from app.bootstrap import bootstrap_all_registries
            bootstrap_all_registries()
            for provider_id in ("a", "b"):
                provider = await http.post(path + "/providers", json={
                    "id": provider_id, "name": provider_id, "provider_key": "aliyun_bailian",
                    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                })
                assert provider.status_code == 201, provider.text
                request = dict(model, id=provider_id, provider_id=provider_id)
                if provider_id == "a":
                    request["capability_profile"] = {
                        "image_inputs": supported, "video_inputs": supported, "max_input_tokens": 16384,
                    }
                response = await http.post(path + "/models", json=request)
                assert response.status_code == 201, response.text

            response = await http.get(path + "/models/a")
            configured = response.json()["data"]
            assert configured["capability_profile"]["video_inputs"] == supported
            assert configured["capability_profile"]["max_input_tokens"] == 16384
            assert configured["params"] == {"temperature": 0.3}
            assert configured["storyboard_inspection_capabilities"]["image_inputs"]
            assert not configured["storyboard_inspection_capabilities"]["video_inputs"]
            assert not configured["effective_capabilities"]["video_inputs"]

            updated = await http.patch(path + "/models/a", json={"capability_profile": {
                **configured["capability_profile"], "tool_calling": supported,
            }})
            assert updated.status_code == 200, updated.text
            assert updated.json()["data"]["effective_capabilities"]["tool_calling"]
            listed = (await http.get(path + "/models")).json()["data"]["items"]
            by_id = {item["id"]: item for item in listed}
            assert by_id["a"]["capability_profile"] == updated.json()["data"]["capability_profile"]
            assert by_id["b"]["capability_profile"]["tool_calling"]["declaration"] == "unknown"

            assert (await http.patch(path + "/providers/a", json={"status": "disabled"})).status_code == 200
            disabled = (await http.get(path + "/models/a")).json()["data"]
            assert disabled["capability_profile"]["tool_calling"] == supported
            assert not disabled["effective_capabilities"]["tool_calling"]
            assert not disabled["storyboard_inspection_capabilities"]["image_inputs"]
    finally:
        await engine.dispose()
