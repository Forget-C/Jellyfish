"""共享 HTTP 连接的单次媒体提交与单次观察契约。"""

import json

import httpx
import pytest

from app.core.contracts.provider import ProviderConfig
from app.core.contracts.provider_media import ProviderImageInput, ProviderImageReference, ProviderVideoInput
from app.core.integrations.media_provider import MediaProvider, ProviderDataError


@pytest.mark.asyncio
async def test_create_error_is_not_retried_and_missing_id_is_failure():
    """创建失败不自动重提；接口成功但无 ID 也不能进入轮询状态。"""
    requests = []
    responses = [httpx.Response(503), httpx.Response(200, json={})]

    def handle(request):
        """按顺序给出一次 HTTP 失败和一次无 ID 的成功响应。"""
        requests.append(request)
        return responses.pop(0)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        provider = MediaProvider(client)
        config = ProviderConfig(provider="vidu", api_key="test", base_url="https://provider.invalid")
        inp = ProviderVideoInput(prompt="test", model="viduq2", ratio="16:9")
        with pytest.raises(httpx.HTTPStatusError):
            await provider.submit(config, inp)
        assert len(requests) == 1
        with pytest.raises(ProviderDataError, match="provider_task_id_missing"):
            await provider.submit(config, inp)
        assert len(requests) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_key,kind,payload", [
    ("openai", "video_generation", {"status": "completed"}),
    ("volcengine", "video_generation", {"status": "succeeded", "content": {"video_url": "https://media.invalid/a.mp4"}}),
    ("vidu", "video_generation", {"state": "success", "creations": [{"url": "https://media.invalid/a.mp4"}]}),
    ("vidu", "image_generation", {"state": "success", "creations": [{"url": "https://media.invalid/a.png"}]}),
    ("kling", "video_generation", {"tasks": [{"status": "succeeded", "outputs": [{"type": "video", "url": "https://media.invalid/a.mp4"}]}]}),
    ("kling", "image_generation", {"data": {"task_status": "succeed", "task_result": {"images": [{"url": "https://media.invalid/a.png"}]}}}),
])
async def test_each_poll_uses_one_request_and_preserves_remote_id(provider_key, kind, payload):
    """各供应商成功结果只返回执行期位置，轮询不会调用创建接口。"""
    requests = []

    def handle(request):
        """模拟成功的远端任务状态。"""
        requests.append(request)
        return httpx.Response(200, json=payload)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await MediaProvider(client).poll(
            ProviderConfig(provider=provider_key, api_key="test", base_url="https://provider.invalid"),
            kind=kind, task_id="remote-123",
        )
        assert len(requests) == 1 and requests[0].method == "GET"
        assert "remote-123" in str(requests[0].url)
        assert result.status == "succeeded" and len(result.outputs) == 1
        if provider_key == "openai":
            assert result.outputs[0].url.endswith("/videos/remote-123/content")
            assert result.outputs[0].headers == {"Authorization": "Bearer test"}


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["image_generation", "video_generation"])
@pytest.mark.parametrize("state", ["created", "queueing"])
async def test_vidu_accepted_and_queued_tasks_remain_running(kind, state):
    """Vidu 已创建和排队均是合法中间态，只继续查询原 ID。"""
    requests = []

    def handle(request):
        """记录轮询方法，模拟尚无产物的 Vidu 中间态。"""
        requests.append(request)
        return httpx.Response(200, json={"state": state})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await MediaProvider(client).poll(
            ProviderConfig(provider="vidu", api_key="test"), kind=kind, task_id="original-id",
        )
    assert result.status == "running" and not result.outputs
    assert len(requests) == 1 and requests[0].method == "GET"
    assert requests[0].url.path == "/ent/v2/tasks/original-id/creations"


@pytest.mark.asyncio
async def test_direct_image_uses_explicit_provider_reference_contract():
    """图片引用正常校验和序列化，不绕过 Pydantic 或修改对象私有字段。"""
    requests = []

    def handle(request):
        """捕获请求中只有执行期地址，无业务文件 ID。"""
        requests.append(request)
        return httpx.Response(200, json={"data": [{"b64_json": "aW1hZ2U="}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await MediaProvider(client).submit(
            ProviderConfig(provider="openai", api_key="test", base_url="https://provider.invalid"),
            ProviderImageInput(prompt="test", model="gpt-image-1", images=[ProviderImageReference(image_url="data:image/png;base64,aW1hZ2U=")]),
        )
        assert result[0].b64_json == "aW1hZ2U="
        assert json.loads(requests[0].content)["images"] == [{"image_url": "data:image/png;base64,aW1hZ2U="}]
        assert requests[0].url.path == "/images/edits"


@pytest.mark.asyncio
async def test_poll_http_failure_and_success_without_output_are_distinct():
    """可退避的查询错误保留 HTTP 类型；成功但无视频地址属于不可用数据。"""
    responses = [httpx.Response(429), httpx.Response(200, json={"status": "succeeded", "content": {}})]

    def handle(request):
        """同一远端 ID 的两次独立查询。"""
        return responses.pop(0)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        provider = MediaProvider(client)
        config = ProviderConfig(provider="volcengine", api_key="test")
        with pytest.raises(httpx.HTTPStatusError):
            await provider.poll(config, kind="video_generation", task_id="remote")
        with pytest.raises(ProviderDataError):
            await provider.poll(config, kind="video_generation", task_id="remote")
