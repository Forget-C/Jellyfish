"""真实画布图编辑的隔离模型能力和数据库。"""
import asyncio
import os
import uvicorn
from app.models.llm import Model, Provider
from app.core.integrations.video_capabilities import register_video_model_capability, VideoModelCapability
from tests.generation_canvas_browser_server import app, database, prepare, sessions, get_db

async def seed():
    """仅准备模型目录，不调用供应商。"""
    await prepare()
    register_video_model_capability(provider='vidu', model_prefix='graph-video-main', capability=VideoModelCapability(
        supports_subject_image_reference=True, allowed_ratios={'9:16', '16:9'}, max_seconds=10))
    register_video_model_capability(provider='vidu', model_prefix='graph-video-alt', capability=VideoModelCapability(
        supports_subject_image_reference=False, allowed_ratios={'16:9'}, supports_seed=False, max_seconds=3))
    async with sessions.begin() as db:
        db.add_all([Provider(id='graph-provider', name='openai', base_url='https://example.test'),
                    Provider(id='graph-video-provider', name='vidu', base_url='https://example.test')])
        await db.flush()
        db.add_all([Model(id=f'graph-{kind}', name=f'真实接入{kind}', category=kind, provider_id='graph-provider')
                    for kind in ('text', 'image', 'video')])
        db.add_all([Model(id='graph-video-main', name='graph-video-main', category='video', provider_id='graph-video-provider'),
                    Model(id='graph-video-alt', name='graph-video-alt', category='video', provider_id='graph-video-provider')])

if __name__ == '__main__':
    asyncio.run(seed())
    app.dependency_overrides[get_db] = database
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('CANVAS_BROWSER_PORT', '8274')))
