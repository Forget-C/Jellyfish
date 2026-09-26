"""资产级声音绑定：**接口级**契约与不变式（需求清单第 6 条 + 评审附带条件①）。

背景（用户口径）
================

声音从"逐镜绑"改为"**直接绑在资产上**"：角色/场景/道具/服装 各有一个声音，
镜头绑定了带声音的资产时，视频生成自动带出它的声音（B2b），
工作室不再需要一处一处地给每个镜头配声音。

本文件证明两件事
================

1. **接口对外长什么样**：4 个端点（列出 / 读一个 / 绑定 / 解绑）的真实 HTTP 形状、
   错误信封、以及"没绑定时如实返回 ``bound=false``"；
2. **不变式①（评审要求，独立断言）**：**一个资产在同一时刻只有一个生效声音**。
   当心这里的坑：库上的唯一约束是 ``(file_id, usage_kind, source_ref)`` **三元组**，
   所以"同一资产挂两个不同音频"在**约束层是允许的** —— 不变式只能由应用层保证，
   必须有测试钉住，否则它随时会悄悄退化。

全部零出网、零付费：不调模型、不触图、不触视频。
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app
from app.models.studio_file_usages import FileUsage
from app.models.types import FileUsageKind

PROJECT_ID = "proj-voice"
CHARACTER_ID = "char-voice-1"
CHARACTER_2 = "char-voice-2"
SCENE_ID = "scene-voice-1"
AUDIO_1 = "file-audio-1"
AUDIO_2 = "file-audio-2"
IMAGE_1 = "file-image-1"

BASE = "/api/v1/studio/asset-voices"


def _build_harness() -> tuple[async_sessionmaker[AsyncSession], Any]:
    from app.core.db import Base
    from app.models.studio import Chapter, Project  # noqa: F401  (触发建表)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _create() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_create())
    return factory, engine


def _override(factory: async_sessionmaker[AsyncSession]):
    async def override_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    return override_db


def _seed(factory: async_sessionmaker[AsyncSession]) -> None:
    from app.models.studio import Character, Project, ProjectSceneLink, Scene
    from app.models.types import FileType
    from app.models.studio import FileItem

    async def run() -> None:
        async with factory() as db:
            db.add(Project(id=PROJECT_ID, name="声音绑定测试", description="", style="真人古装", visual_style="现实"))
            db.add(
                Character(
                    id=CHARACTER_ID,
                    project_id=PROJECT_ID,
                    name="苏晚棠",
                    description="素白襦裙",
                    style="真人古装",
                    visual_style="现实",
                )
            )
            db.add(
                Character(
                    id=CHARACTER_2,
                    project_id=PROJECT_ID,
                    name="叶老夫人",
                    description="银灰高髻",
                    style="真人古装",
                    visual_style="现实",
                )
            )
            # 场景是**全局资产**：项目归属靠关联表（测试这一条是因为"项目从哪来"分两种形态）
            db.add(Scene(id=SCENE_ID, name="南安侯府大堂", description="青砖地面", style="真人古装", view_count=1, tags=[]))
            db.add(ProjectSceneLink(id=1, project_id=PROJECT_ID, scene_id=SCENE_ID))
            # 两个音频 + 一个图片（图片用来证明"只能绑音频"）
            db.add(FileItem(id=AUDIO_1, type=FileType.audio, name="晚棠配音.mp3", storage_key="files/a1.mp3"))
            db.add(FileItem(id=AUDIO_2, type=FileType.audio, name="晚棠配音-备用.mp3", storage_key="files/a2.mp3"))
            db.add(FileItem(id=IMAGE_1, type=FileType.image, name="定版图.png", storage_key="files/i1.png"))
            await db.flush()
            # 种子的会话必须**提交**：否则关闭时回滚，接口层一个资产都查不到
            await db.commit()

    asyncio.run(run())


@pytest.fixture
def voice_client() -> Any:
    factory, engine = _build_harness()
    _seed(factory)
    app.dependency_overrides[get_db] = _override(factory)
    try:
        yield TestClient(app), factory
    finally:
        app.dependency_overrides.pop(get_db, None)
        asyncio.run(engine.dispose())


def _count_asset_voice_rows(factory: async_sessionmaker[AsyncSession], source_ref: str) -> int:
    """直接数库里的 asset_voice 行 —— 不变式必须**在库里**成立，不能只看接口返回。"""

    async def run() -> int:
        async with factory() as db:
            rows = (
                await db.execute(
                    select(FileUsage).where(
                        FileUsage.usage_kind == FileUsageKind.asset_voice.value,
                        FileUsage.source_ref == source_ref,
                    )
                )
            ).scalars().all()
            return len(rows)

    return asyncio.run(run())


# ---------------------------------------------------------------------------
# 1) 接口形状
# ---------------------------------------------------------------------------


def test_unbound_asset_reads_back_as_honest_false(voice_client: Any) -> None:
    """没绑过就如实说没绑（``bound=false``），不编一个空文件名糊过去。"""
    client, _factory = voice_client
    response = client.get(f"{BASE}/character/{CHARACTER_ID}")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["bound"] is False
    assert data["file_id"] == ""
    assert data["file_name"] == ""
    assert data["asset_label"] == "角色"


def test_bind_then_read_and_list(voice_client: Any) -> None:
    """绑定后可读、可列出，且地址/文件名如实带回来。"""
    client, _factory = voice_client
    bound = client.put(f"{BASE}/character/{CHARACTER_ID}", json={"file_id": AUDIO_1})
    assert bound.status_code == 200
    data = bound.json()["data"]
    assert data["bound"] is True
    assert data["file_id"] == AUDIO_1
    assert data["file_name"] == "晚棠配音.mp3"
    assert data["url"] == "files/a1.mp3"

    assert client.get(f"{BASE}/character/{CHARACTER_ID}").json()["data"]["file_id"] == AUDIO_1

    listed = client.get(BASE, params={"project_id": PROJECT_ID}).json()["data"]
    assert [(row["asset_type"], row["asset_id"], row["file_id"]) for row in listed] == [
        ("character", CHARACTER_ID, AUDIO_1)
    ]


def test_global_asset_resolves_its_project_from_the_link(voice_client: Any) -> None:
    """场景这类**全局资产**不在行上带 project_id，项目归属必须从关联表解析出来。"""
    client, _factory = voice_client
    response = client.put(f"{BASE}/scene/{SCENE_ID}", json={"file_id": AUDIO_1})
    assert response.status_code == 200
    assert response.json()["data"]["asset_label"] == "场景"
    assert client.get(f"{BASE}/character/{CHARACTER_ID}").json()["data"]["bound"] is False


def test_bind_rejects_non_audio_file(voice_client: Any) -> None:
    """只能绑音频：给图片文件必须被结构化拒绝（否则视频生成会拿到一张图当声音）。"""
    client, _factory = voice_client
    response = client.put(f"{BASE}/character/{CHARACTER_ID}", json={"file_id": IMAGE_1})
    assert response.status_code == 400
    body = response.json()
    # 结构化明细走 meta.error（不是全局处理器压出来的一行 dict 字面量）
    assert body["meta"]["error"]["code"] == "not_an_audio_file"
    assert "音频" in body["message"], "主区那句必须是产品写的中文结论，不是原始结构体"


def test_bind_rejects_unknown_file_and_asset(voice_client: Any) -> None:
    client, _factory = voice_client
    assert client.put(f"{BASE}/character/{CHARACTER_ID}", json={"file_id": "nope"}).status_code == 404
    assert client.put(f"{BASE}/character/not-there", json={"file_id": AUDIO_1}).status_code == 404


def test_bind_rejects_unsupported_asset_type(voice_client: Any) -> None:
    """``product``（商品）在类型表里，但**不是**资产声音支持的类型 —— 不能静默放行。"""
    client, _factory = voice_client
    response = client.put(f"{BASE}/product/whatever", json={"file_id": AUDIO_1})
    assert response.status_code == 400
    assert response.json()["meta"]["error"]["code"] == "unsupported_asset_type"


def test_unbind_removes_the_binding(voice_client: Any) -> None:
    client, _factory = voice_client
    client.put(f"{BASE}/character/{CHARACTER_ID}", json={"file_id": AUDIO_1})
    removed = client.delete(f"{BASE}/character/{CHARACTER_ID}")
    assert removed.status_code == 200
    assert removed.json()["data"]["removed"] == 1
    assert client.get(f"{BASE}/character/{CHARACTER_ID}").json()["data"]["bound"] is False
    # 再解一次是 0，不是报错（幂等）
    assert client.delete(f"{BASE}/character/{CHARACTER_ID}").json()["data"]["removed"] == 0


# ---------------------------------------------------------------------------
# 2) 不变式①：一个资产同一时刻只有一个生效声音
# ---------------------------------------------------------------------------


def test_rebinding_replaces_old_voice_instead_of_stacking(voice_client: Any) -> None:
    """**评审附带条件①**：换绑不是"再加一条"，而是替换 —— 库里只能剩一行。

    为什么必须独立断言：唯一约束是 ``(file_id, usage_kind, source_ref)`` 三元组，
    两个**不同**音频文件都能插进去，约束层不会拦。不变式只有应用层保证，
    一旦有人把 bind 改成"直接 upsert 不清旧"，这里就会变成 2 行而无人察觉。
    """
    client, factory = voice_client
    assert client.put(f"{BASE}/character/{CHARACTER_ID}", json={"file_id": AUDIO_1}).status_code == 200
    assert client.put(f"{BASE}/character/{CHARACTER_ID}", json={"file_id": AUDIO_2}).status_code == 200

    source_ref = f"character:{CHARACTER_ID}"
    assert _count_asset_voice_rows(factory, source_ref) == 1, "换绑后库里的 asset_voice 行必须只有 1 行"

    latest = client.get(f"{BASE}/character/{CHARACTER_ID}").json()["data"]
    assert latest["file_id"] == AUDIO_2, "生效声音必须是**最新一次**绑定的那个"


def test_binding_is_per_asset_not_per_file(voice_client: Any) -> None:
    """同一个音频可以绑给多个资产（同一把声音配两个角色）；各资产互不影响。"""
    client, factory = voice_client
    client.put(f"{BASE}/character/{CHARACTER_ID}", json={"file_id": AUDIO_1})
    client.put(f"{BASE}/character/{CHARACTER_2}", json={"file_id": AUDIO_1})
    assert _count_asset_voice_rows(factory, f"character:{CHARACTER_ID}") == 1
    assert _count_asset_voice_rows(factory, f"character:{CHARACTER_2}") == 1
    listed = client.get(BASE, params={"project_id": PROJECT_ID}).json()["data"]
    assert len(listed) == 2
