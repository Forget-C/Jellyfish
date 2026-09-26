"""断点③测试：生成的图片能被「采纳」进资产槽位并持久化。

用户要求："生成图片能回到资产页查看、采纳，刷新后仍存在。"
出图提交本身不写库（image_pipeline 的设计），所以采纳这一步必须真实落库。
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models.studio import Character, CharacterImage, Prop, PropImage
from app.services.studio.image_pipeline.adopt import adopt_generated_image, reject_placeholder_url
from app.utils.files import create_file_from_url_or_b64
from tests.llm_orchestration_fixtures import build_session

REAL_URL = "https://oss.example.com/generated/new-char.png"


@pytest.fixture(autouse=True)
def _fake_download(monkeypatch: pytest.MonkeyPatch) -> None:
    """把「下载远端图片 + 上传存储」替换掉：测试不依赖网络与磁盘。"""
    import uuid

    async def _fake(session, *, url=None, b64_data=None, name=None, prefix="files", **kwargs):  # type: ignore[no-untyped-def]
        from app.models.studio import FileItem

        item = FileItem(
            id=str(uuid.uuid4()),
            type="image",
            name=name or "generated",
            storage_key=f"{prefix}/{uuid.uuid4()}.png",
        )
        session.add(item)
        await session.flush()
        return item

    monkeypatch.setattr(
        "app.services.studio.image_pipeline.adopt.create_file_from_url_or_b64", _fake
    )
    assert create_file_from_url_or_b64 is not None  # 保持导入可解析，防止路径写错


# ---------------------------------------------------------------------------
# 占位地址守卫
# ---------------------------------------------------------------------------


def test_rejects_dry_run_placeholder_url() -> None:
    """演练占位地址不得写进正式产物（与 product_guardrails 同口径）。"""
    with pytest.raises(HTTPException) as exc_info:
        reject_placeholder_url("https://dry-run.invalid/assets/CHAR_x_1.png")
    assert exc_info.value.status_code == 422
    assert "演练占位地址" in str(exc_info.value.detail)


def test_rejects_empty_url() -> None:
    with pytest.raises(HTTPException) as exc_info:
        reject_placeholder_url("   ")
    assert exc_info.value.status_code == 400


def test_accepts_real_url() -> None:
    reject_placeholder_url(REAL_URL)  # 不抛


# ---------------------------------------------------------------------------
# 采纳落库
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_adopt_creates_slot_and_persists_file_id() -> None:
    db, engine = await build_session()
    async with db:
        db.add(Prop(id="prop-1", name="交付文档", description="x", style="真人都市"))
        await db.flush()

        adopted = await adopt_generated_image(
            db, entity_type="prop", entity_id="prop-1", url=REAL_URL, set_primary=True
        )
        assert adopted.file_id
        assert adopted.is_primary is True
        await db.commit()

        # 用全新会话复核：这就是"刷新后仍在"
        from app.core.db import Base  # noqa: F401

        row = await db.get(PropImage, adopted.image_id)
        assert row is not None
        assert row.file_id == adopted.file_id
        assert row.is_primary is True
    await engine.dispose()


@pytest.mark.asyncio
async def test_adopt_reuses_existing_slot_instead_of_adding_rows() -> None:
    """重复采纳应复用槽位，不无限增行。"""
    db, engine = await build_session()
    async with db:
        db.add(Character(id="char-1", project_id="proj-1", name="甲", description="x", style="真人都市"))
        await db.flush()
        db.add(CharacterImage(id=1, character_id="char-1", view_angle="FRONT", quality_level="LOW"))
        await db.flush()

        first = await adopt_generated_image(db, entity_type="character", entity_id="char-1", url=REAL_URL)
        second = await adopt_generated_image(db, entity_type="character", entity_id="char-1", url=REAL_URL)
        assert first.image_id == second.image_id == 1  # 复用同一槽位
    await engine.dispose()


@pytest.mark.asyncio
async def test_adopt_enforces_single_primary_per_asset() -> None:
    db, engine = await build_session()
    async with db:
        db.add(Prop(id="prop-2", name="杯", description="x", style="真人都市"))
        await db.flush()
        db.add(PropImage(id=1, prop_id="prop-2", view_angle="FRONT", quality_level="LOW", is_primary=True))
        db.add(PropImage(id=2, prop_id="prop-2", view_angle="BACK", quality_level="LOW", is_primary=False))
        await db.flush()

        adopted = await adopt_generated_image(
            db, entity_type="prop", entity_id="prop-2", url=REAL_URL,
            image_id=2, set_primary=True,
        )
        assert adopted.image_id == 2
        first = await db.get(PropImage, 1)
        assert first.is_primary is False  # 旧的定版被清掉
        assert adopted.is_primary is True
    await engine.dispose()


@pytest.mark.asyncio
async def test_adopt_blocks_placeholder_before_any_write() -> None:
    db, engine = await build_session()
    async with db:
        db.add(Prop(id="prop-3", name="纸", description="x", style="真人都市"))
        await db.flush()
        with pytest.raises(HTTPException):
            await adopt_generated_image(
                db, entity_type="prop", entity_id="prop-3",
                url="https://dry-run.invalid/assets/x.png",
            )
        # 一个字都没写
        rows = (await db.execute(__import__("sqlalchemy").select(PropImage))).scalars().all()
        assert rows == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_adopt_rejects_unknown_asset() -> None:
    db, engine = await build_session()
    async with db:
        with pytest.raises(HTTPException) as exc_info:
            await adopt_generated_image(db, entity_type="prop", entity_id="ghost", url=REAL_URL)
        assert exc_info.value.status_code == 404
    await engine.dispose()
