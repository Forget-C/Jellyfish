"""Actual canvas page/Worker fixture; only provider HTTP and object storage replaced."""
import asyncio
import os
from pathlib import Path
from contextlib import asynccontextmanager
import httpx
import uvicorn
from botocore.exceptions import ClientError
from fastapi import Body
from app.core import storage
from app.models.llm import Model, Provider
from app.task_worker import TaskWorker
from tests.generation_canvas_browser_server import app, database, prepare, sessions, get_db

media_dir = Path(os.environ['CANVAS_BROWSER_MEDIA_STORAGE'])
control = {'calls': [], 'release': False}


async def upload(*, key, data, **kwargs):
    (media_dir / Path(key).name).write_bytes(data.read())


async def download(*, key):
    return (media_dir / Path(key).name).read_bytes()


async def head(*, key):
    path = media_dir / Path(key).name
    if not path.exists():
        raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'HeadObject')
    return storage.StoredFileInfo(key=key, url='unused', size=path.stat().st_size, content_type='video/mp4', extra={})


def provider(request):
    control['calls'].append({'method': request.method, 'url': str(request.url), 'body': __import__('json').loads(request.content) if request.content else None})
    if request.method == 'POST':
        return httpx.Response(200, json={'task_id': 'video-result', 'id': 'video-result'})
    if request.url.host == 'media.test':
        return httpx.Response(200, content=Path(os.environ['CANVAS_VIDEO_FIXTURE']).read_bytes(), headers={'Content-Type': 'video/mp4'})
    if not control['release']:
        return httpx.Response(200, json={'status': 'running'})
    return httpx.Response(200, json={'status': 'succeeded', 'content': {'video_url': 'https://media.test/output.mp4'}, 'creations': [{'url': 'https://media.test/output.mp4'}]})


@app.get('/test/video-controls')
async def controls():
    return control


@app.post('/test/video-controls')
async def update_control(body: dict = Body(...)):
    control['release'] = body.get('release', control['release'])
    return control


@asynccontextmanager
async def lifespan(_app):
    storage.upload_file, storage.download_file, storage.get_file_info = upload, download, head
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(sessions, client=client)
        async def tick():
            while True:
                await worker.tick()
                await asyncio.sleep(.05)
        runner = asyncio.create_task(tick())
        try:
            yield
        finally:
            runner.cancel()
            for job in worker.jobs.values():
                job.cancel()
            await asyncio.gather(runner, *list(worker.jobs.values()), return_exceptions=True)
            worker.text_pool.shutdown(wait=False)


async def seed():
    from app.bootstrap import bootstrap_all_registries
    bootstrap_all_registries()
    await prepare()
    async with sessions.begin() as db:
        db.add_all([Provider(id='frames-provider', name='volcengine', api_key='test', base_url='https://video.test'), Provider(id='subjects-provider', name='vidu', api_key='test', base_url='https://video.test')])
        await db.flush()
        db.add_all([Model(id='video-frames', name='doubao-seedance', category='video', provider_id='frames-provider'), Model(id='video-subjects', name='viduq2-pro', category='video', provider_id='subjects-provider')])


if __name__ == '__main__':
    media_dir.mkdir(parents=True, exist_ok=True)
    asyncio.run(seed())
    app.router.lifespan_context = lifespan
    app.dependency_overrides[get_db] = database
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ['CANVAS_BROWSER_PORT']))
