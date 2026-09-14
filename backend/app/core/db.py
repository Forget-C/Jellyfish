"""SQLAlchemy 异步引擎与会话。"""

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    AsyncEngine,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.engine import make_url

from app.config import settings


def _build_engine() -> AsyncEngine:
    """短事务使用最新已提交读；文件行锁后的引用检查不能沿用更早的快照。"""
    options = {"isolation_level": "READ COMMITTED"} if make_url(settings.database_url).get_backend_name() == "mysql" else {}
    return create_async_engine(
        settings.database_url,
        echo=settings.debug,
        future=True,
        **options,
    )


def _build_session_maker(bind_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """创建可在短事务间复用的异步会话工厂。"""
    return async_sessionmaker(
        bind_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )


engine = _build_engine()
async_session_maker = _build_session_maker(engine)


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""

    pass


async def close_db() -> None:
    """关闭数据库连接。"""
    await engine.dispose()
