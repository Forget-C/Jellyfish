"""通过唯一 Alembic 迁移链初始化或升级数据库，不自动猜测既有库的版本。"""

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings

BACKEND_ROOT = Path(__file__).resolve().parents[2]


async def _check_database_version() -> None:
    """拒绝非空且未纳管的数据库，避免错误 stamp 跳过必要的结构变更。"""
    engine = create_async_engine(settings.database_url)
    def is_unmanaged(sync) -> bool:
        schema = inspect(sync)
        tables = set(schema.get_table_names()) - {"alembic_version"}
        return bool(tables or schema.get_view_names()) and not MigrationContext.configure(sync).get_current_heads()

    try:
        async with engine.connect() as connection:
            if await connection.run_sync(is_unmanaged):
                raise RuntimeError(
                    "Database is non-empty but has no Alembic version. "
                    "Use an empty database for the initial schema."
                )
    finally:
        await engine.dispose()


def migrate_database() -> None:
    """启动应用前执行迁移；版本识别失败时退出，禁止带着不完整结构继续运行。"""
    asyncio.run(_check_database_version())
    command.upgrade(Config(str(BACKEND_ROOT / "alembic.ini")), "head")
    print("Database upgraded to Alembic head.")


if __name__ == "__main__":
    migrate_database()
