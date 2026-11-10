"""Real video frames prepared and saved through the public canvas API."""
import subprocess

import pytest

from app.core import storage
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_video_frame_is_independent_idempotent_and_preserves_provenance(canvas_client, tmp_path, monkeypatch):
    async def upload(*, key, data, **_kwargs):
        (tmp_path / key.rsplit('/', 1)[-1]).write_bytes(data.read())

    async def download(*, key):
        return (tmp_path / key.rsplit('/', 1)[-1]).read_bytes()

    monkeypatch.setattr(storage, 'upload_file', upload)
    monkeypatch.setattr(storage, 'download_file', download)
    video = tmp_path / 'test.mp4'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=32x24:r=10:d=1',
        '-f', 'lavfi', '-i', 'color=blue:s=32x24:r=10:d=1', '-filter_complex', 'concat=n=2:v=1:a=0',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(video)], check=True)
    client = canvas_client
    uploaded = await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('clip.mp4', video.read_bytes(), 'video/mp4')})
    assert uploaded.status_code == 201, uploaded.text
    file_id = uploaded.json()['data']['id']
    canvas = (await client.post('/canvases/p', json={'name': '选帧'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = {**canvas['document'], 'cards': [{'id': 'clip', 'type': 'content.video', 'file_id': file_id}]}
    assert (await client.put(url, json={'request_id': 'clip', 'expected_revision': 0, 'document': document})).status_code == 200
    before = (await client.get(url)).json()['data']
    request = {'request_id': 'select-frame', 'source_card_id': 'clip', 'source_file_id': file_id, 'at_ms': 1300}
    response = await client.post(url + '/video-frames', json=request)
    assert response.status_code == 200, response.text
    frame = response.json()['data']
    assert (await client.post(url + '/video-frames', json=request)).json()['data'] == frame
    assert (await client.get(url)).json()['data'] == before
    assert frame['frame_origin']['source_file_id'] == file_id
    assert frame['frame_origin']['at_ms'] == 1300
    assert frame['type'] == 'content.image'
    result = await client.get(f"/files/{frame['file_id']}/download")
    assert result.headers['content-type'] == 'image/png'
    rgb = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'rawvideo',
        '-pix_fmt', 'rgb24', 'pipe:1'], input=result.content, capture_output=True, check=True).stdout
    assert len(rgb) == 32 * 24 * 3
    assert rgb[2] > 240 and rgb[0] < 10  # 1.3 seconds is blue, unlike the first second.
    invalid = await client.post(url + '/video-frames', json={**request, 'at_ms': 5000})
    assert invalid.status_code == 422, invalid.text
    assert (await client.get(url)).json()['data'] == before
    forged = {**frame, 'frame_origin': {**frame['frame_origin'], 'at_ms': 0}}
    document['cards'].append(forged)
    rejected = await client.put(url, json={'request_id': 'forged', 'expected_revision': 1, 'document': document})
    assert rejected.status_code == 422, rejected.text
    document['cards'] = [frame]  # The saved frame does not require the original card.
    saved = await client.put(url, json={'request_id': 'save-frame', 'expected_revision': 1, 'document': document})
    assert saved.status_code == 200, saved.text
    reopened = (await client.get(url)).json()['data']['document']
    assert reopened['cards'] == [frame]
    assert (await client.delete(f"/files/{frame['file_id']}")).status_code == 409
