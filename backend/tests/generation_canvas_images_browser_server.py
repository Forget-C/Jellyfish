"""Real HTTP/DB/TaskWorker media harness; only external HTTP/storage use local fakes."""
import asyncio
import struct
import zlib
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
control = {'calls': [], 'stream_connections': 0, 'fail_next': False, 'response_delay': 0}
objects = {}
media_dir = Path(os.environ['CANVAS_BROWSER_MEDIA_STORAGE'])
def image_bytes(index):
    """Small deterministic native PNGs make each preview visibly distinguishable."""
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    palette = ((235, 85, 85), (70, 175, 110), (70, 120, 230))
    color = palette[index % len(palette)]
    pixels = b''.join(b'\0' + bytes(color) * 240 for _ in range(120))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 240, 120, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')



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


async def external(request):
    if request.method == 'POST':
        await asyncio.sleep(control['response_delay'])
        import json
        body = json.loads(request.content)
        control['calls'].append(body)
        count = body['n'] if os.environ.get('CANVAS_BROWSER_VARIABLE_IMAGE_COUNT') else 3
        failed = control['fail_next']
        control['fail_next'] = False
        return httpx.Response(200, json={'data': [{'url': 'https://media.test/' + ('failed/' if failed else 'complete/') + str(index)} for index in range(count)]})
    if request.url.path == '/failed/2':
        return httpx.Response(503)
    return httpx.Response(200, content=image_bytes(int(request.url.path.rsplit('/', 1)[1])), headers={'Content-Type': 'image/png'})


async def database():
    async with sessions.begin() as db:
        yield db


@app.get('/test/image-controls')
async def read_control():
    return control


@app.post('/test/image-controls')
async def set_control(body: dict = Body(...)):
    control['fail_next'] = body.get('fail_next', False)
    control['response_delay'] = min(5, max(0, float(body.get('response_delay', 0))))
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
        db.add(Provider(id='canvas-video-provider', name='vidu', api_key='fixture-private', base_url='https://fixture.test'))
        db.add(Provider(id='canvas-image-provider', name='openai', api_key='fixture-private', base_url='https://fixture.test/v1'))
        await db.flush()
        db.add(Model(id='canvas-image-model', name='image-model', provider_id='canvas-image-provider', category='image'))
        db.add(Model(id='canvas-carried-video-model', name='video-model', provider_id='canvas-image-provider', category='video'))
        db.add(Model(id='canvas-subject-model', name='viduq2-pro', provider_id='canvas-video-provider', category='video'))


if __name__ == '__main__':
    asyncio.run(prepare())
    app.router.lifespan_context = lifespan
    app.dependency_overrides[get_db] = database
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('CANVAS_BROWSER_PORT', '8278')))
