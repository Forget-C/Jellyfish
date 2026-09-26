"""LLM 编排层测试的共享脚手架。

只提供两件事：
1. 内存 SQLite 会话（不碰 jellyfish.db）；
2. 可注入的 stub LLM caller（不联网）。

注意：这里不注册 pytest fixture，纯粹是导入式 helper，避免影响其他测试文件。
"""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


async def build_session() -> tuple[AsyncSession, Any]:
    """建一个内存库会话；调用方负责 ``await engine.dispose()``。"""
    # 导入即注册全部表（Base.metadata 需要模型模块被 import）。
    from app.core.db import Base
    from app.models.studio import Chapter, Project, Shot  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return session_local(), engine


async def seed_project_chapter_shot(
    db: AsyncSession,
    *,
    project_id: str = "proj-1",
    chapter_id: str = "chap-1",
    shot_id: str = "shot-1",
    script_excerpt: str = "姜岁欢在将军府庭院中握紧拐杖，秦老夫人冷声逼问嫁妆下落。",
    chapter_text: str = "将军府庭院内，秦老夫人拄着拐杖逼问姜岁欢嫁妆下落。姜岁欢攥紧手中玉佩，沉默不语。",
) -> None:
    """写入最小项目结构（仅测试库，不接触真实数据）。"""
    from app.models.studio import Chapter, Project, Shot

    db.add(
        Project(
            id=project_id,
            name="测试项目",
            description="",
            style="真人古装",
            visual_style="现实",
        )
    )
    await db.flush()
    db.add(
        Chapter(
            id=chapter_id,
            project_id=project_id,
            index=1,
            title="第一集",
            raw_text=chapter_text,
            condensed_text=chapter_text,
        )
    )
    await db.flush()
    db.add(
        Shot(
            id=shot_id,
            chapter_id=chapter_id,
            index=1,
            title="庭院对峙",
            script_excerpt=script_excerpt,
        )
    )
    await db.flush()


def make_stub_caller(payload: Any) -> Callable[[str], Awaitable[str]]:
    """返回一个固定回包的 stub caller；``payload`` 可以是 dict 或原始字符串。"""
    text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)

    async def _caller(_prompt: str) -> str:
        return text

    return _caller


def make_recording_stub_caller(payload: Any) -> tuple[Callable[[str], Awaitable[str]], list[str]]:
    """返回 stub caller 与它收到的 prompt 列表，便于断言提示词里带了什么。"""
    prompts: list[str] = []
    base = make_stub_caller(payload)

    async def _caller(prompt: str) -> str:
        prompts.append(prompt)
        return await base(prompt)

    return _caller, prompts
