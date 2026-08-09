"""CAS 生产 CLI（同步执行，Windows PowerShell 兼容）。

用法::

    uv run python -m app.crypto_animal_studio.production.cli run \
      --project-id demo-project \
      --episode-package samples/cas/demo_episode.json \
      --provider-mode mock

仅使用标准库 argparse（不新增依赖）。输出：状态、job id、manifest 路径、成片路径。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.core.db import Base
from app.crypto_animal_studio.production.artifact_manager import ArtifactManager, default_storage_root
from app.crypto_animal_studio.production.enums import ArtifactType
from app.crypto_animal_studio.production.orchestrator import start_production
from app.crypto_animal_studio.production.providers.mock import build_mock_bundle
from app.crypto_animal_studio.application.parsing import parse_episode_package


async def _run(project_id: str, package_path: Path, provider_mode: str, storage_root: Path | None, create_tables: bool) -> int:
    """执行一次生产并打印结果；返回进程退出码。"""
    # 走版本分派：v1 行为完全不变，同时接受 v1.1 文档；未知版本显式失败。
    package = parse_episode_package(json.loads(package_path.read_text(encoding="utf-8")))

    engine = create_async_engine(settings.database_url)
    if create_tables:
        # 仅为副作用导入：把 ORM 模型注册到 Base.metadata，供 create_all 建表使用。
        # 与 app/core/db.py::init_db 保持同一写法。
        import app.crypto_animal_studio.production.models  # noqa: F401  # pylint: disable=unused-import
        import app.crypto_animal_studio.domain.import_ledger  # noqa: F401  # pylint: disable=unused-import
        import app.models.studio  # noqa: F401  # pylint: disable=unused-import

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        job = await start_production(
            db, project_id=project_id, package=package, providers=build_mock_bundle(), provider_mode=provider_mode, storage_root=storage_root
        )
        manager = ArtifactManager(db, job, storage_root=storage_root)
        manifest_rel = manager.artifact_relpath(ArtifactType.manifest)
        final_rel = manager.artifact_relpath(ArtifactType.final_video)
        await db.commit()

    root = storage_root or default_storage_root()
    print(f"status: {job.status}")
    print(f"job_id: {job.id}")
    print(f"manifest: {root / Path(manifest_rel)}")
    print(f"final_output: {root / Path(final_rel)}")
    if job.error_message:
        print(f"error: {job.error_message}", file=sys.stderr)
    await engine.dispose()
    return 0 if job.status == "completed" else 1


def main(argv: list[str] | None = None) -> int:
    """CLI 入口。"""
    parser = argparse.ArgumentParser(prog="cas-production", description="CAS production pipeline (mock providers)")
    sub = parser.add_subparsers(dest="command", required=True)
    run_cmd = sub.add_parser("run", help="run a production job from an EpisodePackage JSON file")
    run_cmd.add_argument("--project-id", required=True)
    run_cmd.add_argument("--episode-package", required=True, type=Path)
    run_cmd.add_argument("--provider-mode", default="mock", choices=["mock"])
    run_cmd.add_argument("--storage-root", type=Path, default=None, help="override storage root (defaults to <repo>/storage)")
    run_cmd.add_argument("--create-tables", action="store_true", help="create tables if missing (dev/SQLite convenience)")

    args = parser.parse_args(argv)
    if args.command == "run":
        return asyncio.run(_run(args.project_id, args.episode_package, args.provider_mode, args.storage_root, args.create_tables))
    return 2


if __name__ == "__main__":  # pragma: no cover - 进程入口
    raise SystemExit(main())
