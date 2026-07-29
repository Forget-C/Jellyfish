"""已下线 Film 分镜帧提示词任务接口的回归测试。"""

from fastapi.testclient import TestClient


def test_legacy_film_shot_frame_prompt_task_endpoint_is_unmounted(client: TestClient) -> None:
    """帧提示词只能由统一同步渲染 API 提供，不再创建 legacy run_args 任务。"""
    response = client.post("/api/v1/film/tasks/shot-frame-prompts", json={})
    assert response.status_code == 404
