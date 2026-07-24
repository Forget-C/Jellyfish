"""CAS 健康端点 API 测试。

覆盖：端点返回成功、响应使用 ApiResponse 壳、data 含 service/status/schema_version。
使用仓库既有的 ``client`` fixture（TestClient）；若 app 依赖未满足会自动跳过。
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_cas_health_returns_success(client: TestClient) -> None:
    """GET /api/v1/crypto-animal-studio/health 应返回 200 且 code=200。"""
    resp = client.get("/api/v1/crypto-animal-studio/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200


def test_cas_health_uses_api_response_envelope(client: TestClient) -> None:
    """响应应使用统一 ApiResponse 壳：包含 code / message / data 字段。"""
    body = client.get("/api/v1/crypto-animal-studio/health").json()
    assert set(["code", "message", "data"]).issubset(body.keys())


def test_cas_health_data_fields(client: TestClient) -> None:
    """data 应包含 service / status / schema_version 且取值正确。"""
    data = client.get("/api/v1/crypto-animal-studio/health").json()["data"]
    assert data["service"] == "crypto-animal-studio"
    assert data["status"] == "ok"
    assert data["schema_version"] == "1.0"
