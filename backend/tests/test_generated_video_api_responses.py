"""已下线 Film 视频提交接口的回归测试。"""

from fastapi.testclient import TestClient


def test_legacy_film_video_submit_endpoints_are_unmounted(client: TestClient) -> None:
    """视频预览与提交必须仅通过统一 studio generation API 提供。"""
    for path in (
        "/api/v1/film/tasks/video/preview-prompt",
        "/api/v1/film/tasks/video",
    ):
        response = client.post(path, json={})
        assert response.status_code == 404
