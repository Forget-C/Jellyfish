"""Isolated real HTTP + TaskWorker fixture, fake only external text provider."""
import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
import uvicorn
from fastapi import Body
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.llm import Model, Provider
from app.models.studio import Project
from app.task_worker import TaskWorker
import app.task_worker as worker_module

database_url = os.environ.get('CANVAS_BROWSER_DATABASE_URL')
if database_url:
    from sqlalchemy.engine import make_url
    parsed = make_url(database_url)
    if parsed.get_backend_name() != 'mysql' or not (parsed.database or '').startswith('jellyfish_check'):
        raise ValueError('browser MySQL evidence requires an explicit jellyfish_check database')
engine = create_async_engine(database_url, isolation_level='READ COMMITTED') if database_url else create_async_engine(
    'sqlite+aiosqlite:///' + os.environ['CANVAS_BROWSER_DATABASE'])
project_id = os.environ.get('CANVAS_BROWSER_PROJECT_ID', 'canvas-project')
provider_id = project_id + '-provider' if database_url else 'canvas-runtime-provider'
model_id = project_id + '-text' if database_url else 'canvas-runtime-text'
sessions = async_sessionmaker(engine, expire_on_commit=False)
control = {'release': 0, 'release_for': {}, 'fail_next': False, 'calls': [], 'stream_connections': 0, 'disconnect_epoch': 0, 'duplicate_next': False, 'check_release': False, 'check_calls': []}


class ControlledModel:
    """Provider chunks remain blocked until the browser observes committed increments."""
    def __init__(self, **params):
        self.params = params

    async def astream(self, messages):
        if database_url and self.params.get('model') != model_id:
            yield SimpleNamespace(content='unrelated isolated fixture')
            return
        control['calls'].append({key: self.params.get(key) for key in ('model', 'temperature', 'base_url', 'max_retries')}
                                | {'text': messages[0].content})
        fail = control['fail_next']
        control['fail_next'] = False
        yield SimpleNamespace(content='第一段')
        while control['release_for'].get(messages[0].content, control['release']) < 1:
            await asyncio.sleep(.03)
        yield SimpleNamespace(content='第二段')
        while control['release_for'].get(messages[0].content, control['release']) < 2:
            await asyncio.sleep(.03)
        if fail:
            raise RuntimeError('controlled provider failure')
        yield SimpleNamespace(content='第三段')


    async def ainvoke(self, messages):
        data = json.loads(messages[1].content)
        if 'requirements' in data:
            control['check_calls'].append('R01')
            return SimpleNamespace(content=json.dumps({'results': [
                {'item_id': item['item_id'], 'outcome': 'conforming', 'message': '已核对历史正文',
                 'submitted_excerpt': data['output_text']} for item in data['requirements']
            ]}))
        field = data['requirement']['field_id']
        calls = control['check_calls']
        first_duration = field == 'estimated_duration' and field not in calls
        calls.append(field)
        while not control['check_release']:
            await asyncio.sleep(.03)
        if first_duration:
            return SimpleNamespace(content='malformed')
        return SimpleNamespace(content=json.dumps({
            'outcome': 'conforming', 'message': '已传入本项设计',
            'submitted_excerpt': data['requirement']['text'],
        }))


async def database():
    async with sessions() as db:
        try:
            yield db
            await db.commit()
        except Exception:
            await db.rollback()
            raise


@app.get('/test/runtime-controls')
async def read_control():
    return control


@app.post('/test/runtime-controls')
async def set_control(body: dict = Body(...)):
    if body.get('disconnect'):
        control['disconnect_epoch'] += 1
    if body.get('expire_events'):
        from sqlalchemy import delete
        from app.models.generation_canvas import CanvasEvent
        async with sessions.begin() as db:
            await db.execute(delete(CanvasEvent))
    for key in ('release', 'release_for', 'fail_next', 'duplicate_next', 'check_release'):
        if key in body:
            control[key] = body[key]
    return control


@asynccontextmanager
async def lifespan(_app):
    worker_module.ChatOpenAI = ControlledModel
    from app.services.generation_canvas import stream
    original_stream = stream.stream_events
    async def controlled_stream(*args, **kwargs):
        # Real persistent stream; faults live only at the HTTP transport boundary.
        control['stream_connections'] += 1
        epoch = control['disconnect_epoch']
        async for chunk in original_stream(*args, **kwargs):
            if epoch != control['disconnect_epoch']:
                return
            yield chunk
            if control['duplicate_next'] and chunk.startswith('id:'):
                control['duplicate_next'] = False
                yield chunk
    stream.stream_events = controlled_stream
    worker = TaskWorker(sessions)
    async def tick():
        while True:
            await worker.tick()
            await asyncio.sleep(.05)
    runner = asyncio.create_task(tick())
    def report_worker_failure(future):
        if not future.cancelled() and future.exception():
            import traceback
            traceback.print_exception(future.exception())
            control['worker_error'] = str(future.exception())
    runner.add_done_callback(report_worker_failure)
    try:
        yield
    finally:
        runner.cancel()
        for job in worker.jobs.values():
            job.cancel()
        await asyncio.gather(runner, *list(worker.jobs.values()), return_exceptions=True)
        worker.text_pool.shutdown(wait=False)
        await engine.dispose()


async def prepare():
    from app.bootstrap import bootstrap_all_registries
    bootstrap_all_registries()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as db:
        db.add(Project(id=project_id, name='文本流画布项目', style='真人都市'))
        db.add(Provider(id=provider_id, name='openai', api_key='fixture-private', base_url='https://fixture.test/v1'))
        await db.flush()
        db.add(Model(id=model_id, name=model_id if database_url else 'controlled-text', provider_id=provider_id, category='text', params={'temperature': 0.2}))
    # Bootstrap and Uvicorn run on separate loops; no pooled MySQL connection may cross them.
    await engine.dispose()


if __name__ == '__main__':
    if os.environ.get('CANVAS_BROWSER_MEDIA_STORAGE'):
        from app.core import storage
        media_dir = Path(os.environ['CANVAS_BROWSER_MEDIA_STORAGE'])
        media_dir.mkdir(parents=True, exist_ok=True)
        async def upload_file(*, key, data, **kwargs):
            """只替换外部对象存储 I/O，保留真实文件路由及服务。"""
            (media_dir / Path(key).name).write_bytes(data.read())
        async def download_file(*, key):
            return (media_dir / Path(key).name).read_bytes()
        storage.upload_file = upload_file
        storage.download_file = download_file
    asyncio.run(prepare())
    app.router.lifespan_context = lifespan
    app.dependency_overrides[get_db] = database
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('CANVAS_BROWSER_PORT', '8276')))
