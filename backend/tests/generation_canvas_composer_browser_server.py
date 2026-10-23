"""真实 Composer 页面，隔离数据库和外部文件存储。"""
import asyncio
import os
from pathlib import Path
import uvicorn
from tests.generation_canvas_graph_browser_server import app, seed, database, get_db
from app.core import storage

if __name__ == '__main__':
    media_dir = Path(os.environ['CANVAS_BROWSER_MEDIA_STORAGE'])
    media_dir.mkdir(parents=True, exist_ok=True)
    async def upload_file(*, key, data, **kwargs):
        """只替换外部对象存储。"""
        (media_dir / Path(key).name).write_bytes(data.read())
    async def download_file(*, key):
        return (media_dir / Path(key).name).read_bytes()
    storage.upload_file = upload_file
    storage.download_file = download_file
    asyncio.run(seed())
    app.dependency_overrides[get_db] = database
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ['CANVAS_BROWSER_PORT']))
