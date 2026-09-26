"""项目起点（`start_mode`）的回归测试。

覆盖三件事：
1. 「从视频提示词开始」的项目创建后**自动有默认章节**（整集提示词看板需要章节承载镜头），
   「从剧本开始」的项目不会被悄悄塞一个章节；
2. `start_mode` 在响应里可见，默认值是 `script`（老客户端不传也不会变）；
3. 迁移/回滚对称：老库（没有该列）迁移后列存在且**旧行回填为 `script`**，
   重复迁移幂等，回滚删列后其它数据不丢。

迁移测试在 `tmp_path` 上造一个模拟老库，绝不触碰 `backend/jellyfish.db`。
"""

from __future__ import annotations

import asyncio
import importlib.util
import sqlite3
import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app

BACKEND_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = BACKEND_ROOT / "scripts"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from _llm_pipeline_columns import COLUMNS  # noqa: E402  (共享列清单)

START_MODE_DDL = "VARCHAR(16) NOT NULL DEFAULT 'script'"


# --------------------------------------------------------------------- 脚手架


def _load_script(name: str):
    spec = importlib.util.spec_from_file_location(f"{name}_module", SCRIPTS_DIR / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _build_file_session(db_path: Path):
    """在指定文件库上开会话（迁移测试用真实文件，便于跑 CLI）。"""
    from app.core.db import Base
    import app.models  # noqa: F401  — 注册全部模型

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return factory, engine


async def _build_memory_session():
    from app.core.db import Base
    import app.models  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return factory, engine


# --------------------------------------------------------- 创建项目时的默认章节


def test_prompts_start_project_gets_default_chapter() -> None:
    """从提示词开始 → 自动建默认章节（index 1，标题「默认章节」）。"""
    factory, engine = asyncio.run(_build_memory_session())

    async def override_db():
        # 与真实 get_db 行为一致：成功提交、失败回滚（否则 chapter 只 flush 不落库）
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            created = client.post(
                "/api/v1/studio/projects",
                json={
                    "id": "proj-prompts",
                    "name": "提示词起步",
                    "description": "",
                    "style": "真人都市",
                    "visual_style": "现实",
                    "start_mode": "prompts",
                    "unify_style": True,
                    "progress": 0,
                    "stats": {},
                },
            )
            assert created.status_code == 201, created.text
            assert created.json()["data"]["start_mode"] == "prompts"

            chapters = client.get("/api/v1/studio/chapters", params={"project_id": "proj-prompts"})
            assert chapters.status_code == 200
            items = chapters.json()["data"]["items"]
            assert len(items) == 1, items
            assert items[0]["index"] == 1
            assert items[0]["title"] == "默认章节"
            assert (items[0]["raw_text"] or "") == ""
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_script_start_project_has_no_auto_chapter() -> None:
    """从剧本开始（含不传 start_mode 的老客户端）→ 不会被自动塞章节。"""
    factory, engine = asyncio.run(_build_memory_session())

    async def override_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            created = client.post(
                "/api/v1/studio/projects",
                json={
                    "id": "proj-script",
                    "name": "剧本起步",
                    "description": "",
                    "style": "真人都市",
                    "visual_style": "现实",
                    "unify_style": True,
                    "progress": 0,
                    "stats": {},
                },
            )
            assert created.status_code == 201, created.text
            # 不传 start_mode 时默认就是 script（老客户端行为不变）
            assert created.json()["data"]["start_mode"] == "script"

            chapters = client.get("/api/v1/studio/chapters", params={"project_id": "proj-script"})
            assert chapters.json()["data"]["items"] == []
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_start_mode_is_in_openapi_schema() -> None:
    """`start_mode` 必须出现在创建/读回 schema 里（前端据此判断起点）。"""
    spec = app.openapi()
    assert "start_mode" in spec["components"]["schemas"]["ProjectRead"]["properties"]
    assert "start_mode" in spec["components"]["schemas"]["ProjectCreate"]["properties"]
    assert "start_mode" in spec["components"]["schemas"]["ProjectUpdate"]["properties"]


# --------------------------------------------------------------- 迁移 / 回滚


def test_migration_list_contains_start_mode() -> None:
    """共享列清单必须包含 projects.start_mode（迁移与回滚同源）。"""
    pairs = {(item.table, item.column) for item in COLUMNS}
    assert ("projects", "start_mode") in pairs
    item = next(item for item in COLUMNS if item.column == "start_mode")
    assert item.ddl == START_MODE_DDL


def _make_legacy_db(db_path: Path) -> None:
    """造一个「迁移前」的库：有全部表，但 projects 没有 start_mode，且已有一条老项目。"""
    factory, engine = asyncio.run(_build_file_session(db_path))
    asyncio.run(engine.dispose())

    with sqlite3.connect(db_path) as conn:
        # 模拟迁移前状态
        conn.execute("ALTER TABLE projects DROP COLUMN start_mode")
        conn.execute(
            "INSERT INTO projects (id, name, description, style, visual_style, seed, unify_style, progress, stats)"
            " VALUES ('proj-old', '老项目', '', '真人都市', '现实', 0, 1, 0, '{}')"
        )
        conn.commit()
        columns = {row[1] for row in conn.execute("PRAGMA table_info(projects)")}
    assert "start_mode" not in columns, "前置条件：老库不应有 start_mode"


def test_migrate_adds_column_and_backfills_old_rows(tmp_path: Path) -> None:
    """迁移后列存在，且旧行被回填为 script（老项目行为不变）。"""
    db_path = tmp_path / "legacy.db"
    _make_legacy_db(db_path)

    migrate = _load_script("migrate_llm_pipeline_columns")
    assert migrate.migrate(check_only=False, db_path=db_path) == 0

    with sqlite3.connect(db_path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(projects)")}
        assert "start_mode" in columns
        value = conn.execute("SELECT start_mode FROM projects WHERE id = 'proj-old'").fetchone()[0]
    assert value == "script"


def test_migration_is_idempotent(tmp_path: Path) -> None:
    """重复迁移不报错、不改动数据。"""
    db_path = tmp_path / "idempotent.db"
    _make_legacy_db(db_path)

    migrate = _load_script("migrate_llm_pipeline_columns")
    assert migrate.migrate(check_only=False, db_path=db_path) == 0
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE projects SET start_mode = 'prompts' WHERE id = 'proj-old'")
        conn.commit()

    assert migrate.migrate(check_only=False, db_path=db_path) == 0

    with sqlite3.connect(db_path) as conn:
        value = conn.execute("SELECT start_mode FROM projects WHERE id = 'proj-old'").fetchone()[0]
    assert value == "prompts", "重复迁移不应覆盖用户数据"


def test_migrate_check_mode_does_not_write(tmp_path: Path) -> None:
    """--check 只报告：不新增列。"""
    db_path = tmp_path / "checkonly.db"
    _make_legacy_db(db_path)

    migrate = _load_script("migrate_llm_pipeline_columns")
    assert migrate.migrate(check_only=True, db_path=db_path) == 0

    with sqlite3.connect(db_path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(projects)")}
    assert "start_mode" not in columns


def _patch_start_mode_only(monkeypatch) -> None:
    """把共享列清单临时收窄成「只有 projects.start_mode」。

    为什么需要：回滚脚本对既有 13 列里的 `shot_details.*` 做 DROP 时会被外键定义挡住
    （`unknown column "audio_file_id" in foreign key definition`），这是**既有脚本在
    当前模型建出的库上的既有边界**；本文件只负责验证 start_mode 这一列的迁移/回滚对称，
    因此把清单收窄，避免把既有问题算成本次回归。
    """
    import _llm_pipeline_columns as shared

    only_start_mode = tuple(item for item in shared.COLUMNS if item.column == "start_mode")
    assert only_start_mode, "共享清单里必须有 start_mode"
    monkeypatch.setattr(shared, "COLUMNS", only_start_mode, raising=True)


def test_rollback_removes_column_and_keeps_rows(tmp_path: Path, monkeypatch) -> None:
    """回滚删列后，项目行与其它数据仍在（对称回滚）。"""
    db_path = tmp_path / "rollback.db"
    _make_legacy_db(db_path)
    _patch_start_mode_only(monkeypatch)

    migrate = _load_script("migrate_llm_pipeline_columns")
    assert migrate.migrate(check_only=False, db_path=db_path) == 0

    rollback = _load_script("rollback_llm_pipeline_columns")
    monkeypatch.setattr(sys, "argv", ["rollback", "--db", str(db_path)])
    assert rollback.main() == 0

    with sqlite3.connect(db_path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(projects)")}
        rows = conn.execute("SELECT id, name FROM projects").fetchall()
    assert "start_mode" not in columns
    assert ("proj-old", "老项目") in rows


def test_rollback_then_migrate_round_trip(tmp_path: Path, monkeypatch) -> None:
    """回滚 → 再迁移 的往返：列回到存在且旧行仍回填为 script。"""
    db_path = tmp_path / "roundtrip.db"
    _make_legacy_db(db_path)
    _patch_start_mode_only(monkeypatch)

    migrate = _load_script("migrate_llm_pipeline_columns")
    rollback = _load_script("rollback_llm_pipeline_columns")

    assert migrate.migrate(check_only=False, db_path=db_path) == 0
    monkeypatch.setattr(sys, "argv", ["rollback", "--db", str(db_path)])
    assert rollback.main() == 0
    assert migrate.migrate(check_only=False, db_path=db_path) == 0

    with sqlite3.connect(db_path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(projects)")}
        value = conn.execute("SELECT start_mode FROM projects WHERE id = 'proj-old'").fetchone()[0]
    assert "start_mode" in columns
    assert value == "script"


def test_migrate_cli_rejects_missing_db(tmp_path: Path) -> None:
    """库不存在时 CLI 明确失败（退出码 1），不创建新库。"""
    missing = tmp_path / "not_there.db"
    result = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "migrate_llm_pipeline_columns.py"), "--db", str(missing)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert not missing.exists()
