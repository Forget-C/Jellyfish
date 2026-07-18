"""Seed system-managed prompt templates after the database schema is migrated."""

import asyncio
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from app.config import settings


BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROMPT_TEMPLATE_SEED = BACKEND_ROOT / "sql" / "001-init-prompt-template.sql"


def _split_sql_statements(sql: str) -> list[str]:
    """Split the seed file on statement terminators outside SQL string literals."""
    statements: list[str] = []
    buffer: list[str] = []
    quote: str | None = None
    escaped = False
    for character in sql:
        buffer.append(character)
        if quote:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                quote = None
            continue
        if character in {"'", '"', "`"}:
            quote = character
        elif character == ";":
            statement = "".join(buffer).strip().rstrip(";").strip()
            if statement:
                statements.append(statement)
            buffer = []
    trailing = "".join(buffer).strip()
    if trailing:
        statements.append(trailing)
    return statements


def _seed_statements() -> list[str]:
    """Load only executable seed statements and preserve user-owned templates."""
    statements: list[str] = []
    for statement in _split_sql_statements(PROMPT_TEMPLATE_SEED.read_text(encoding="utf-8")):
        normalized = statement.lstrip().upper()
        if normalized.startswith(("BEGIN", "COMMIT", "SET NAMES")):
            continue
        if normalized.startswith("DELETE FROM `PROMPT_TEMPLATES`"):
            # The legacy seed replaced IDs 1-6 unconditionally. Restrict the
            # replacement to system rows so a user record is never deleted.
            statement = statement.replace(" WHERE ", " WHERE is_system = 1 AND ", 1)
        if normalized.startswith(("DELETE", "INSERT")):
            statements.append(statement)
    return statements


async def _execute_seed(connection: AsyncConnection, dry_run: bool) -> int:
    """Execute system prompt template seed statements on one transaction."""
    statements = _seed_statements()
    if dry_run:
        return len(statements)
    for statement in statements:
        if connection.dialect.name == "sqlite":
            statement = statement.replace("INSERT IGNORE INTO", "INSERT OR IGNORE INTO")
        elif connection.dialect.name in {"mysql", "mariadb"}:
            # aiomysql delegates to PyMySQL, whose cursor applies Python-style
            # interpolation even when no SQL parameters were supplied. Prompt
            # templates contain Jinja ``%`` tokens, so preserve them by giving
            # the DB-API escaped percent characters.
            statement = statement.replace("%", "%%")
        await connection.exec_driver_sql(statement)
    return len(statements)


async def seed_system_data(*, dry_run: bool = False) -> int:
    """Apply the idempotent system seed after Alembic has created its tables."""
    engine = create_async_engine(settings.database_url)
    try:
        async with engine.begin() as connection:
            return await _execute_seed(connection, dry_run)
    finally:
        await engine.dispose()


def main() -> None:
    """Run the system seed command and print an operator-friendly summary."""
    statement_count = asyncio.run(seed_system_data())
    print(f"Applied {statement_count} system seed statements.")


if __name__ == "__main__":
    main()
