"""Real four-card HTTP/DB/Worker harness; only supplier and storage I/O are controlled."""
import asyncio
import os
from contextlib import asynccontextmanager
from types import SimpleNamespace

import uvicorn

from app.dependencies import get_db
from app.models.llm import Model
import app.task_worker as worker_module
from tests import generation_canvas_images_browser_server as images

SAMPLE = '清晨，林夏走过安静的街道，回头望向镜头。保持人物身份、自然步态与柔和侧光。'
images.control['text_calls'] = []


class ControlledText:
    """Return deterministic external text chunks while the real Worker publishes them."""
    def __init__(self, **_params):
        pass

    async def astream(self, messages):
        images.control['text_calls'].append(messages[0].content)
        for text in (SAMPLE[:20], SAMPLE[20:]):
            await asyncio.sleep(.05)
            yield SimpleNamespace(content=text)


@asynccontextmanager
async def lifespan(app):
    worker_module.ChatOpenAI = ControlledText
    async with images.lifespan(app):
        yield


async def prepare():
    await images.prepare()
    async with images.sessions.begin() as db:
        db.add(Model(id='canvas-text-model', name='controlled-text', provider_id='canvas-image-provider', category='text'))


if __name__ == '__main__':
    asyncio.run(prepare())
    images.app.router.lifespan_context = lifespan
    images.app.dependency_overrides[get_db] = images.database
    uvicorn.run(images.app, host='127.0.0.1', port=int(os.environ.get('CANVAS_BROWSER_PORT', '8460')))
