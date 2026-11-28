"""用途事实重构的实际供应商请求与错误优先级回归。"""
import json

import httpx
import pytest

from app.core.contracts.provider import ProviderConfig
from app.core.contracts.provider_media import RemoteTaskReference
from app.core.contracts.provider_media import ProviderVideoInput, ProviderVideoFrames, ProviderVideoSubject
from app.core.integrations.media_provider import bind_media_provider
from app.core.integrations.video_capabilities import (
    VideoModelCapability, register_video_model_capability, clear_video_model_capability_overrides,
)


@pytest.mark.asyncio
@pytest.mark.parametrize(('provider', 'model', 'frames', 'path', 'field', 'expected'), [
    ('openai', 'sora-2', {'first_frame': 'first', 'last_frame': 'last', 'key_frames': [' ', ' key ', 'next']}, '/videos', 'input_reference', {'image_url': 'data:image/png;base64,key'}),
    ('openai', 'sora-2', {'first_frame': ' ', 'last_frame': ' last ', 'key_frames': [' ']}, '/videos', 'input_reference', {'image_url': 'data:image/png;base64,last'}),
    ('openai', 'sora-2', {'first_frame': 'first', 'last_frame': 'last'}, '/videos', 'input_reference', {'image_url': 'data:image/png;base64,first'}),
    ('kling', ' Kling-3.0 ', {'last_frame': 'data:custom,last'}, '/image-to-video/kling-3.0', 'contents', [{'type': 'prompt', 'text': 'test'}, {'type': 'last_frame', 'url': 'data:custom,last'}]),
    ('kling', 'kling-3.0', {'first_frame': 'first', 'last_frame': 'last'}, '/image-to-video/kling-3.0', 'contents', [{'type': 'prompt', 'text': 'test'}, {'type': 'first_frame', 'url': 'data:image/png;base64,first'}, {'type': 'last_frame', 'url': 'data:image/png;base64,last'}]),
    ('vidu', 'viduq2', {'last_frame': 'last'}, '/ent/v2/img2video', 'images', ['data:image/png;base64,last']),
    ('vidu', 'viduq2', {'key_frames': ['same', ' ', 'same']}, '/ent/v2/reference2video', 'images', ['data:image/png;base64,same', 'data:image/png;base64,same']),
])
async def test_final_reference_request(provider, model, frames, path, field, expected):
    def handler(request):
        assert request.url.path == path
        assert json.loads(request.content)[field] == expected
        return httpx.Response(200, json={'id': 'result'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await bind_media_provider(
            ProviderConfig(provider=provider, api_key='key', base_url='https://example.test'), client=client,
        ).invoke(
            ProviderVideoInput(prompt='test', ratio='16:9', model=model, frame_references=ProviderVideoFrames(**frames)))
    assert isinstance(result, RemoteTaskReference) and result.task_id == 'result'


@pytest.mark.asyncio
@pytest.mark.parametrize(('provider', 'model', 'seed', 'frames', 'message'), [
    ('kling', 'unknown', 1, {'key_frames': ['key']}, 'seed is not supported by provider=kling model=unknown'),
    ('kling', 'unknown', None, {'key_frames': ['key']}, 'Kling video model must be kling-3.0 or kling-3.0-turbo'),
    ('kling', 'kling-3.0-turbo', None, {'first_frame': 'first', 'key_frames': ['key']}, 'Kling 3.0 Omni image-to-video does not support key_frame'),
    ('kling', 'kling-3.0-turbo', None, {'last_frame': 'last'}, 'Kling 3.0 Turbo only supports text-to-video'),
    ('vidu', ' ', None, {}, 'Vidu video generation requires model'),
])
async def test_invalid_request_preserves_error_priority(provider, model, seed, frames, message):
    def handler(request):
        pytest.fail('invalid input must not reach provider')
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError) as error:
            await bind_media_provider(
                ProviderConfig(provider=provider, api_key='key'), client=client,
            ).invoke(
                ProviderVideoInput(prompt='test', ratio='16:9', model=model, seed=seed, frame_references=ProviderVideoFrames(**frames)))
    assert str(error.value) == message


@pytest.mark.asyncio
async def test_vidu_override_keeps_subject_branch_and_media_error():
    register_video_model_capability(provider='vidu', model_prefix='usage-test', capability=VideoModelCapability(
        supports_subject_image_reference=True, supports_subject_video_reference=True,
        supports_subject_reference_with_frame_reference=True))
    def handler(request):
        assert request.url.path == '/ent/v2/reference2video'
        body = json.loads(request.content)
        assert body['subjects'] == [{'name': 'hero', 'images': ['https://example.test/hero.png']}]
        assert 'images' not in body
        return httpx.Response(200, json={'id': 'result'})
    try:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            inp = ProviderVideoInput(prompt='test', model='usage-test', ratio='16:9',
                frame_references=ProviderVideoFrames(first_frame='first'),
                subject_references=[ProviderVideoSubject(name='hero', images=['https://example.test/hero.png'])])
            assert (await bind_media_provider(ProviderConfig(provider='vidu', api_key='key'), client=client).invoke(inp)).task_id == 'result'
            inp.subject_references[0].images = ['invalid']
            inp.subject_references[0].videos = ['invalid']
            with pytest.raises(ValueError) as error:
                await bind_media_provider(ProviderConfig(provider='vidu', api_key='key'), client=client).invoke(inp)
            assert str(error.value) == 'Vidu subject image references require an http(s) URL or data:image URL'
    finally:
        clear_video_model_capability_overrides(provider='vidu')
