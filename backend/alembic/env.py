"""Alembic runtime configuration for the backend's async SQLAlchemy models."""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config import settings
from app.core.db import Base
import app.models  # noqa: F401  # Import models so Base.metadata is complete.


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# The application setting is the single source of truth for both runtime and
# migration database connections; Compose injects the same DATABASE_URL.
config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata


def _run_migrations(connection: object) -> None:
    """Configure Alembic against one synchronous connection facade."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_offline() -> None:
    """Render SQL without opening a database connection."""
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations() -> None:
    """Run migrations through SQLAlchemy's async engine and sync bridge."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    """Run the revision chain against the configured application database."""
    asyncio.run(_run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
