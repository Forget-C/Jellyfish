#!/usr/bin/env python
"""初始化一个**全新的**临时测试数据库（本机跑全量后端测试用）。

为什么需要它：
    后端有一部分接口测试**不使用内存库**，而是直接走 `get_db` 依赖，因此需要一个
    「表结构完整、且模型/供应商配置可用」的 SQLite 库。缺表时这些用例会以
    `no such table: model_settings` 之类的错误失败，看起来像代码回归，其实是环境没初始化；
    只建表不写配置同样会失败（例如视频计划接口会因为「供应商没有 api_key」返回 503）。

安全边界（本脚本会写假供应商 / 假模型 / 改默认模型设置，所以必须严格限定作用目标）：
    1. **只创建不存在的库**：目标文件已存在 → 直接拒绝，绝不在既有库上执行；
    2. 拒绝正式库：仓库内的 `backend/jellyfish.db`、以及任何以 `jellyfish.db` 命名的目标；
    3. 拒绝仓库工作树内的任何路径（临时测试库不该写在仓库里）；
    4. **不做静默覆盖、不做自动删除、不做备份式改名** —— 拒绝就是拒绝，一个字节都不写。

用法：
    python backend/scripts/init_test_db.py /tmp/jf_test/test.db

注意：pytest 已经**自带隔离**（``tests/conftest.py`` 会在每次会话开始时新建一个
全新临时库并覆盖 ``DATABASE_URL``），所以跑测试**不需要**先执行本脚本、
也不需要手动设置 ``DATABASE_URL``：直接
``cd backend && .venv/bin/python -m pytest tests/ -q`` 即可。
本脚本留给「需要一份带种子的独立临时库」的特殊场景（例如手工自检）。

退出码：0 成功；2 参数缺失或被安全规则拒绝。

注意：种子里的 api_key 是**假值**，只用于让配置解析通过，不会发起任何真实调用。
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Sequence
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

import app.models  # noqa: F401,E402  —— 导入以注册全部 ORM 模型
from app.core.db import Base  # noqa: E402
from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider, ProviderStatus  # noqa: E402

FAKE_API_KEY = "test-key-not-real"

PROVIDERS = [
    {"id": "prov-apimart", "name": "apimart"},
    {"id": "prov-deepseek", "name": "deepseek"},
]

MODELS: list[tuple[str, str, ModelCategoryKey, str]] = [
    ("model-deepseek-chat", "deepseek-chat", ModelCategoryKey.text, "prov-deepseek"),
    ("model-gpt-image-2", "gpt-image-2", ModelCategoryKey.image, "prov-apimart"),
    ("model-seedance-2.0-mini", "seedance-2.0-mini", ModelCategoryKey.video, "prov-apimart"),
]

#: 正式库文件名：任何目录下都不允许作为本脚本的目标。
PRODUCTION_DB_NAME = "jellyfish.db"

#: 正式库的固定位置（应用默认 `sqlite+aiosqlite:///./jellyfish.db`，即 backend/jellyfish.db）。
PRODUCTION_DB_PATH = BACKEND_ROOT / PRODUCTION_DB_NAME


class UnsafeTargetError(RuntimeError):
    """目标数据库不安全（已存在 / 是正式库 / 在仓库内），拒绝执行。"""


def resolve_safe_target(raw_target: str | Path) -> Path:
    """校验并返回可安全创建的目标路径；不满足安全规则时抛 `UnsafeTargetError`。

    这是**纯校验**函数：只读文件系统信息（存在性），不做任何创建、删除或写入。
    """
    text = str(raw_target).strip()
    if not text:
        raise UnsafeTargetError("必须显式给出目标数据库路径（例如 /tmp/jf_test/test.db）。")

    target = Path(text).expanduser()
    # 只解析路径，不创建：resolve() 在文件不存在时也不会写盘。
    resolved = target.resolve()

    if target.name == PRODUCTION_DB_NAME:
        raise UnsafeTargetError(
            f"拒绝以 {PRODUCTION_DB_NAME} 命名：这个文件名是正式库，本脚本只允许创建测试库。"
        )
    if resolved == PRODUCTION_DB_PATH.resolve():
        raise UnsafeTargetError(f"拒绝正式库路径：{resolved}（本脚本只允许创建临时测试库）。")
    if REPO_ROOT.resolve() in resolved.parents or resolved == REPO_ROOT.resolve():
        raise UnsafeTargetError(
            f"拒绝仓库工作树内的路径：{resolved}（测试库请放在仓库之外，例如 /tmp/…）。"
        )
    if target.exists():
        raise UnsafeTargetError(
            f"拒绝已存在的目标：{resolved} 已经存在。本脚本只创建新库，不会覆盖、不会删除、也不会改名备份；"
            "请换一个不存在的路径（或先自行确认该文件可以删除）。"
        )
    return target


async def init(db_url: str) -> None:
    """在**由调用方保证是新建**的库上建表并写入配置种子。"""
    engine = create_async_engine(db_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        for spec in PROVIDERS:
            existing = (await db.execute(select(Provider).where(Provider.id == spec["id"]))).scalars().first()
            if existing is None:
                db.add(
                    Provider(
                        id=spec["id"],
                        name=spec["name"],
                        base_url="http://127.0.0.1:9/v1",
                        api_key=FAKE_API_KEY,
                        description="测试库种子（假 api_key，不会发起真实调用）",
                        status=ProviderStatus.active,
                        created_by="init_test_db",
                    )
                )
        for model_id, name, category, provider_id in MODELS:
            existing = (await db.execute(select(Model).where(Model.id == model_id))).scalars().first()
            if existing is None:
                db.add(
                    Model(
                        id=model_id,
                        name=name,
                        category=category,
                        provider_id=provider_id,
                        params={},
                        description="测试库种子",
                        created_by="init_test_db",
                    )
                )
        settings = await db.get(ModelSettings, 1)
        if settings is None:
            settings = ModelSettings(id=1)
            db.add(settings)
        settings.default_text_model_id = "model-deepseek-chat"
        settings.default_image_model_id = "model-gpt-image-2"
        settings.default_video_model_id = "model-seedance-2.0-mini"
        await db.commit()

    await engine.dispose()
    print(f"已初始化测试库：{db_url}")
    print(f"  表数量：{len(Base.metadata.tables)}；供应商 {len(PROVIDERS)}；模型 {len(MODELS)}")


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) < 1:
        print(__doc__)
        return 2

    try:
        target = resolve_safe_target(args[0])
    except UnsafeTargetError as exc:
        # 拒绝发生在任何数据库操作之前：这里没有建表、没有写供应商、没有改默认模型。
        print(f"❌ 拒绝执行：{exc}", file=sys.stderr)
        return 2

    # 目录可以新建（新建目录不等于覆盖既有数据库）；父目录同样先做安全校验。
    target.parent.mkdir(parents=True, exist_ok=True)
    asyncio.run(init(f"sqlite+aiosqlite:///{target}"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
