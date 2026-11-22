"""生成画布真实页面的隔离 HTTP 后端。"""
import asyncio
import os
from pathlib import Path
import uvicorn
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.llm import Model, ModelSettings, Provider
from app.models.studio import Project

engine = create_async_engine('sqlite+aiosqlite:///' + os.environ['CANVAS_BROWSER_DATABASE'])
sessions = async_sessionmaker(engine, expire_on_commit=False)


async def database():
    """与生产依赖一致，允许选帧服务先提交、再读取或更新画布。"""
    async with sessions() as db:
        try:
            yield db
            await db.commit()
        except Exception:
            await db.rollback()
            raise


async def prepare():
    """仅在临时文件库准备两个空项目。"""
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as db:
        db.add(Project(id='canvas-project', name='独立画布项目', style='真人都市'))
        db.add(Project(id='other-project', name='其他项目', style='真人都市'))
        if provider_url := os.environ.get('CANVAS_BROWSER_ASSISTANT_PROVIDER'):
            db.add(Provider(id='browser-assistant-provider', provider_key='openai', name='画布助手测试',
                            base_url=provider_url, api_key='browser-test-key'))
            await db.flush()
            db.add(Model(id='browser-assistant-model', name='browser-assistant-model', category='text',
                         provider_id='browser-assistant-provider',
                         capability_profile={'image_inputs': {'declaration': 'supported'}}
                         if os.environ.get('CANVAS_BROWSER_MEDIA_STORAGE') else None))
            db.add(Model(id='browser-tool-model', name='browser-tool-model', category='text',
                         provider_id='browser-assistant-provider',
                         capability_profile={'tool_calling': {'declaration': 'supported'}}))
            if os.environ.get('CANVAS_BROWSER_ASSISTANT_REVIEW'):
                db.add(Provider(id='browser-review-provider', provider_key='aliyun_bailian', name='审看测试',
                                base_url=provider_url, api_key='browser-test-key'))
                await db.flush()
                db.add(Model(id='browser-review-model', name='qwen3.8-omni-flash', category='text',
                             provider_id='browser-review-provider', capability_profile={
                                 field: {'declaration': 'supported'} for field in
                                 ('video_inputs', 'audio_inputs', 'tool_calling')
                             }))
            await db.flush()
            db.add(ModelSettings(id=1, default_text_model_id='browser-assistant-model'))


if __name__ == '__main__':
    if os.environ.get('CANVAS_BROWSER_MEDIA_STORAGE'):
        from types import SimpleNamespace
        from app.core import storage
        media_dir = Path(os.environ['CANVAS_BROWSER_MEDIA_STORAGE'])
        media_dir.mkdir(parents=True, exist_ok=True)
        media_types = {}
        async def upload_file(*, key, data, **kwargs):
            """只替换外部对象存储 I/O，保留真实文件路由及服务。"""
            (media_dir / Path(key).name).write_bytes(data.read())
            media_types[key] = kwargs.get('content_type')
        async def download_file(*, key):
            return (media_dir / Path(key).name).read_bytes()
        async def get_file_info(*, key):
            return SimpleNamespace(size=(media_dir / Path(key).name).stat().st_size, content_type=media_types.get(key))
        storage.upload_file = upload_file
        storage.download_file = download_file
        storage.get_file_info = get_file_info
    asyncio.run(prepare())
    app.dependency_overrides[get_db] = database
    # A proxied canvas event stream can outlive the browser during test teardown.
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('CANVAS_BROWSER_PORT', '8271')),
                timeout_graceful_shutdown=5)
