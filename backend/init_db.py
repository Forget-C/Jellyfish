import asyncio

from app.core.db import init_db, close_db
from app.core.storage import init_storage


async def _main() -> None:
    """初始化数据库并确保对象存储 bucket 存在。"""
    await init_db()
    # backend-init-db 容器启动时一并确保对象存储 bucket，避免运行期首次上传才暴露 NoSuchBucket。
    init_storage()
    await close_db()


if __name__ == "__main__":
    asyncio.run(_main())

