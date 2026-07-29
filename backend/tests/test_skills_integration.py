"""影视技能集成测试：FastAPI 应用、技能完整链路与（可选）真实 LLM。"""

from __future__ import annotations

from fastapi.testclient import TestClient


# ---------- FastAPI 应用集成 ----------


class TestAppIntegration:
    """FastAPI 应用端到端：健康检查与现有路由。"""

    def test_health_returns_ok(self, client: TestClient) -> None:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"code": 200, "message": "success", "data": {"status": "ok"}, "meta": None}

