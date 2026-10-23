"""Isolated real HTTP + TaskWorker fixture, fake only external text provider."""
import asyncio
import os
from contextlib import asynccontextmanager
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

engine = create_async_engine('sqlite+aiosqlite:///' + os.environ['CANVAS_BROWSER_DATABASE'])
sessions = async_sessionmaker(engine, expire_on_commit=False)
control = {'release': 0, 'fail_next': False, 'calls': []}


class ControlledModel:
    """Provider chunks remain blocked until the browser observes committed increments."""
    def __init__(self, **params):
        self.params = params

    async def astream(self, messages):
        control['calls'].append({key: self.params.get(key) for key in ('model', 'temperature', 'base_url', 'max_retries')}
                                | {'text': messages[0].content})
        fail = control['fail_next']
        control['fail_next'] = False
        yield SimpleNamespace(content='第一段')
        while control['release'] < 1:
            await asyncio.sleep(.03)
        yield SimpleNamespace(content='第二段')
        while control['release'] < 2:
            await asyncio.sleep(.03)
        if fail:
            raise RuntimeError('controlled provider failure')
        yield SimpleNamespace(content='第三段')


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
    for key in ('release', 'fail_next'):
        if key in body:
            control[key] = body[key]
    return control


@asynccontextmanager
async def lifespan(_app):
    worker_module.ChatOpenAI = ControlledModel
    worker = TaskWorker(sessions)
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
        await engine.dispose()


async def prepare():
    from app.bootstrap import bootstrap_all_registries
    bootstrap_all_registries()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as db:
        db.add(Project(id='canvas-project', name='文本流画布项目', style='真人都市'))
        db.add(Provider(id='canvas-runtime-provider', name='openai', api_key='fixture-private', base_url='https://fixture.test/v1'))
        await db.flush()
        db.add(Model(id='canvas-runtime-text', name='controlled-text', provider_id='canvas-runtime-provider', category='text', params={'temperature': 0.2}))


if __name__ == '__main__':
    asyncio.run(prepare())
    app.router.lifespan_context = lifespan
    app.dependency_overrides[get_db] = database
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('CANVAS_BROWSER_PORT', '8276')))
