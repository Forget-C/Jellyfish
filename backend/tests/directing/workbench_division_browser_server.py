"""隔离管理页划分测试，仅在文字供应商边界提供固定输出。"""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from types import SimpleNamespace

import uvicorn

from app import task_worker
from app.bootstrap import bootstrap_all_registries
from app.dependencies import get_db
from app.models.llm import Model, ModelSettings, Provider
from tests.generation_canvas_browser_server import app, database, engine, prepare, sessions


class ControlledTextModel:
    """返回实际原文中的连续场次和一个对象，由真实 Worker 校验交付。"""

    def __init__(self, **_kwargs):
        pass

    def invoke(self, messages):
        """根据冻结的业务请求选择对应固定模型输出。"""
        arguments = json.loads(messages[1].content)
        if 'shooting_preparation' in arguments:
            payload = {'issues': [{'id': 'route', 'category': 'path', 'kind': 'optional',
                'excerpt': '', 'problem': '路线可由生成设计', 'suggestion': '可由生成安排可行路线'}]}
        elif 'existing_assets' in arguments:
            assert arguments['script_text'] == '前厅点灯。'
            payload = {'objects': [{'kind': 'scene', 'name': '前厅', 'description': '灯光亮起', 'excerpt': '前厅'}]}
        else:
            assert arguments['script_text'] == '前厅点灯。后院下雨。'
            payload = {'scenes': [
                {'title': 'AI 前厅', 'excerpt': '前厅点灯。', 'purpose': '室内点灯'},
                {'title': 'AI 后院', 'excerpt': '后院下雨。', 'purpose': '地点转换'},
            ]}
        return SimpleNamespace(content=json.dumps(payload, ensure_ascii=False))


@asynccontextmanager
async def lifespan(_app):
    """执行隔离数据库的真实排队任务，随测试服务关闭。"""
    task_worker.ChatOpenAI = ControlledTextModel
    worker = task_worker.TaskWorker(sessions)

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


async def setup():
    """只写入隔离测试数据库的项目和文字模型配置。"""
    await prepare()
    async with sessions.begin() as db:
        db.add(Provider(id='division-provider', name='openai', base_url='https://fixture.test/v1', api_key='fixture'))
        await db.flush()
        db.add(Model(id='division-model', name='fixture-text', category='text', provider_id='division-provider', params={}))
        await db.flush()
        db.add(ModelSettings(id=1, default_text_model_id='division-model'))


if __name__ == '__main__':
    bootstrap_all_registries()
    asyncio.run(setup())
    app.dependency_overrides[get_db] = database
    app.router.lifespan_context = lifespan
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ['CANVAS_BROWSER_PORT']), timeout_graceful_shutdown=5)
