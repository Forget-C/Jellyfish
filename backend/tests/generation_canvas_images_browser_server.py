"""Real HTTP/DB/TaskWorker media harness; only external HTTP/storage use local fakes."""
import asyncio
import base64
import os
from contextlib import asynccontextmanager
from pathlib import Path
import httpx
import uvicorn
from fastapi import Body
from botocore.exceptions import ClientError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.core import storage
from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.llm import Model, Provider
from app.models.studio import Project
from app.task_worker import TaskWorker

engine = create_async_engine('sqlite+aiosqlite:///' + os.environ['CANVAS_BROWSER_DATABASE'])
sessions = async_sessionmaker(engine, expire_on_commit=False)
control = {'calls': [], 'stream_connections': 0, 'fail_next': False}
objects = {}
media_dir = Path(os.environ['CANVAS_BROWSER_MEDIA_STORAGE'])
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')


async def head(*, key):
    if key not in objects:
        raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'HeadObject')
    value, mime, extra = objects[key]
    return storage.StoredFileInfo(key=key, url='unused', size=len(value), content_type=mime, extra=extra)


async def upload(*, key, data, content_type, extra_args=None):
    value = data.read()
    objects[key] = value, content_type, extra_args or {}
    target = media_dir / key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(value)


async def download(*, key):
    return objects[key][0]


def external(request):
    if request.method == 'POST':
        import json
        control['calls'].append(json.loads(request.content))
        failed = control['fail_next']
        control['fail_next'] = False
        return httpx.Response(200, json={'data': [{'url': 'https://media.test/' + ('failed/' if failed else 'complete/') + str(index)} for index in range(3)]})
    if request.url.path == '/failed/2':
        return httpx.Response(503)
    return httpx.Response(200, content=PNG, headers={'Content-Type': 'image/png'})


async def database():
    async with sessions.begin() as db:
        yield db


@app.get('/test/image-controls')
async def read_control():
    return control


@app.post('/test/image-controls')
async def set_control(body: dict = Body(...)):
    control['fail_next'] = body.get('fail_next', False)
    return control


@asynccontextmanager
async def lifespan(_app):
    from app.services.generation_canvas import stream
    original = stream.stream_events
    async def observe_stream(*args, **kwargs):
        control['stream_connections'] += 1
        async for value in original(*args, **kwargs):
            yield value
    stream.stream_events = observe_stream
    storage.get_file_info, storage.upload_file, storage.download_file = head, upload, download
    async with httpx.AsyncClient(transport=httpx.MockTransport(external)) as client:
        worker = TaskWorker(sessions, client=client)
        async def tick():
            while True:
                await worker.tick()
                await asyncio.sleep(.04)
        runner = asyncio.create_task(tick())
        try:
            yield
        finally:
            runner.cancel()
            jobs = list(worker.jobs.values())
            for job in jobs:
                job.cancel()
            await asyncio.gather(runner, *jobs, return_exceptions=True)
            worker.text_pool.shutdown(wait=False)
            await engine.dispose()


async def prepare():
    from app.bootstrap import bootstrap_all_registries
    bootstrap_all_registries()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as db:
        db.add(Project(id='canvas-project', name='图片画布项目', style='真人都市'))
        db.add(Provider(id='canvas-image-provider', name='openai', api_key='fixture-private', base_url='https://fixture.test/v1'))
        await db.flush()
        db.add(Model(id='canvas-image-model', name='image-model', provider_id='canvas-image-provider', category='image'))


if __name__ == '__main__':
    asyncio.run(prepare())
    app.router.lifespan_context = lifespan
    app.dependency_overrides[get_db] = database
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('CANVAS_BROWSER_PORT', '8278')))
