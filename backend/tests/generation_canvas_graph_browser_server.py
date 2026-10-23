"""真实画布图编辑的隔离模型能力和数据库。"""
import asyncio
import os
import uvicorn
from app.models.llm import Model, Provider
from tests.generation_canvas_browser_server import app, database, prepare, sessions, get_db

async def seed():
    """仅准备模型目录，不调用供应商。"""
    await prepare()
    async with sessions.begin() as db:
        db.add(Provider(id='graph-provider', name='openai', base_url='https://example.test'))
        await db.flush()
        db.add_all([Model(id=f'graph-{kind}', name=f'真实接入{kind}', category=kind, provider_id='graph-provider')
                    for kind in ('text', 'image', 'video')])

if __name__ == '__main__':
    asyncio.run(seed())
    app.dependency_overrides[get_db] = database
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('CANVAS_BROWSER_PORT', '8274')))
