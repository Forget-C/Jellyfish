"""断点④测试：绑定资产必须能落到**实际文件**（file_id / 地址），并进入交付内容。

用户要求："关联资产名称不算完成，必须明确实际使用的文件。"
"""

from __future__ import annotations

import pytest

from app.models.studio import (
    Character,
    CharacterImage,
    Costume,
    FileItem,
    ProjectCostumeLink,
    ProjectSceneLink,
    Scene,
    SceneImage,
    ShotCharacterLink,
)
from app.services.studio.bound_asset_files import (
    render_bound_file_lines,
    resolve_shot_audio_file,
    resolve_shot_bound_files,
    usable_file_ids,
)
from app.services.studio.prompt_delivery import build_prompt_only_delivery
from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot

OSS_URL = "https://oss.example.com/projects/p/assets/character/CHAR_1/front.png"


async def _seed_bindings(db) -> None:  # type: ignore[no-untyped-def]
    """镜头绑定：一个角色（有定版图，file 为完整 URL）+ 一个场景（无图）。"""
    db.add(Character(id="char-1", project_id="proj-1", name="周法官", description="x", style="真人都市"))
    db.add(Scene(id="scene-1", name="审判庭", description="y", style="真人都市"))
    db.add(FileItem(id="file-1", type="image", name="定版图", storage_key=OSS_URL))
    await db.flush()
    db.add(
        CharacterImage(
            id=1, character_id="char-1", file_id="file-1",
            is_primary=True, view_angle="FRONT", quality_level="HIGH",
        )
    )
    await db.flush()
    db.add(ShotCharacterLink(id=1, shot_id="shot-1", character_id="char-1", index=0, note=""))
    db.add(ProjectSceneLink(id=1, project_id="proj-1", shot_id="shot-1", scene_id="scene-1"))
    await db.flush()


@pytest.mark.asyncio
async def test_resolves_bound_assets_to_actual_files() -> None:
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        await _seed_bindings(db)
        files = await resolve_shot_bound_files(db, shot_id="shot-1")

    by_name = {f.asset_name: f for f in files}
    # 有定版图的角色 → 落到具体 file_id，并走 URL 形态的 storage_key
    judge = by_name["周法官"]
    assert judge.file_id == "file-1"
    assert judge.url == OSS_URL
    assert judge.is_primary is True
    assert judge.resolved_from == "is_primary"
    assert judge.usable is True
    # 没有图的场景 → 名称在、文件为空，且如实给出 warning（不是静默通过）
    court = by_name["审判庭"]
    assert court.file_id == ""
    assert court.usable is False
    assert any("还没有图片" in w for w in court.warnings)
    # 只有真正拿到文件的才进参考图列表
    assert usable_file_ids(files) == ["file-1"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_delivery_text_contains_actual_files_section() -> None:
    """交付内容里必须有明确的 file_id，而不只是资产名。"""
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        await _seed_bindings(db)
        from app.models.studio import ShotDetail

        db.add(
            ShotDetail(
                id="shot-1",
                camera_shot="MEDIUM",
                angle="EYE_LEVEL",
                movement="STATIC",
                duration=5,
                video_prompt="镜头缓慢推近。",
                video_prompt_source="llm",
            )
        )
        await db.flush()
        payload = await build_prompt_only_delivery(
            db, project_id="proj-1", scope="episode", sources=["llm"], include_bindings=True
        )

    text = payload["text"]
    assert "镜头缓慢推近。" in text
    assert "【绑定资产】" in text
    assert "【绑定素材·实际文件】" in text
    assert "file_id=file-1" in text          # 定版角色落到具体文件
    assert "周法官[定版]" in text
    assert "审判庭[非定版] 无可用文件" in text  # 无图如实标注，不假装有文件
    row = payload["rows"][0]
    assert len(row["bound_files"]) == 2
    assert row["bound_file_lines"]
    await engine.dispose()


def test_render_lines_are_grouped_by_slot() -> None:
    from app.services.studio.bound_asset_files import BoundAssetFile

    files = [
        BoundAssetFile(slot="characters", asset_id="c1", asset_type="character",
                       asset_name="甲", file_id="f1", is_primary=True, resolved_from="is_primary"),
        BoundAssetFile(slot="props", asset_id="p1", asset_type="prop",
                       asset_name="杯", file_id="f2", resolved_from="fallback"),
    ]
    lines = render_bound_file_lines(files)
    assert lines[0].startswith("角色：甲[定版] file_id=f1")
    assert lines[1].startswith("道具：杯[fallback] file_id=f2")
    # 没有绑定 → 空列表（交付文本里不出现空段）
    assert render_bound_file_lines([]) == []


@pytest.mark.asyncio
async def test_missing_image_records_do_not_crash() -> None:
    """绑定了一个不存在的资产 id 也不能抛异常。"""
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        db.add(ProjectCostumeLink(id=1, project_id="proj-1", shot_id="shot-1", costume_id="ghost-costume"))
        await db.flush()
        files = await resolve_shot_bound_files(db, shot_id="shot-1")

    assert files == []  # join 不到名称 → 不产生条目，也不抛
    await engine.dispose()


@pytest.mark.asyncio
async def test_converts_bound_files_to_frame_reference_items() -> None:
    """帧图参考图入参需要 ShotLinkedAssetItem（带 file_id），不是字符串列表。

    回归：早先直接传 file_id 字符串列表会让 build_frame_context 抛
    AttributeError: 'str' object has no attribute 'file_id'。
    """
    from app.services.studio.bound_asset_files import to_shot_linked_asset_items

    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        await _seed_bindings(db)
        files = await resolve_shot_bound_files(db, shot_id="shot-1")

    items = to_shot_linked_asset_items(files)
    # 只有真正有文件的才会进参考图（场景没图 → 不进）
    assert len(items) == 1
    item = items[0]
    assert item.file_id == "file-1"
    assert item.id == "char-1"
    assert item.name == "周法官"
    assert item.type == "character"
    assert item.thumbnail == OSS_URL
    # 每个条目都必须带 file_id（frame.build_context 依赖它）
    assert all(i.file_id for i in items)
    await engine.dispose()


def test_converter_skips_unusable_entries() -> None:
    from app.services.studio.bound_asset_files import BoundAssetFile, to_shot_linked_asset_items

    files = [
        BoundAssetFile(slot="characters", asset_id="c1", asset_type="character", asset_name="有图", file_id="f1"),
        BoundAssetFile(slot="scene", asset_id="s1", asset_type="scene", asset_name="无图"),
    ]
    items = to_shot_linked_asset_items(files)
    assert [i.id for i in items] == ["c1"]
    assert to_shot_linked_asset_items([]) == []


# ---------------------------------------------------------------------------
# 声音绑定（FileType.audio + shot_details.audio_file_id）
# ---------------------------------------------------------------------------


def test_file_type_has_audio_member() -> None:
    from app.models.types import FileType

    assert FileType.audio.value == "audio"
    # 枚举是 String 列，新增成员不需要改表；这里确认三个成员齐全
    assert {t.value for t in FileType} >= {"image", "video", "audio"}


@pytest.mark.asyncio
async def test_resolves_shot_audio_file() -> None:
    """声音绑定落在 shot_details.audio_file_id，且能解析成可访问地址。"""
    from app.models.studio import FileItem, ShotDetail

    AUDIO_URL = "https://oss.example.com/projects/p/audio/shot1.mp3"

    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        db.add(FileItem(id="audio-1", type="audio", name="镜头1配音", storage_key=AUDIO_URL))
        await db.flush()
        db.add(
            ShotDetail(
                id="shot-1", camera_shot="MEDIUM", angle="EYE_LEVEL", movement="STATIC",
                duration=5, audio_file_id="audio-1",
            )
        )
        await db.flush()
        audio = await resolve_shot_audio_file(db, shot_id="shot-1")

    assert audio is not None
    assert audio.slot == "audio"
    assert audio.asset_type == "audio"
    assert audio.file_id == "audio-1"
    assert audio.url == AUDIO_URL
    assert audio.asset_name == "镜头1配音"
    assert audio.resolved_from == "shot_detail.audio_file_id"
    assert audio.usable is True
    assert audio.warnings == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_audio_not_bound_produces_no_entry() -> None:
    from app.models.studio import ShotDetail

    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        db.add(
            ShotDetail(
                id="shot-1", camera_shot="MEDIUM", angle="EYE_LEVEL", movement="STATIC", duration=5
            )
        )
        await db.flush()
        assert await resolve_shot_audio_file(db, shot_id="shot-1") is None
        # 也不影响图片绑定的解析
        assert await resolve_shot_bound_files(db, shot_id="shot-1") == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_audio_warns_when_file_is_not_audio_type() -> None:
    """绑错了类型要如实告警，而不是静默接受。"""
    from app.models.studio import FileItem, ShotDetail

    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        db.add(FileItem(id="img-1", type="image", name="其实是图", storage_key="a/b.png"))
        await db.flush()
        db.add(
            ShotDetail(
                id="shot-1", camera_shot="MEDIUM", angle="EYE_LEVEL", movement="STATIC",
                duration=5, audio_file_id="img-1",
            )
        )
        await db.flush()
        audio = await resolve_shot_audio_file(db, shot_id="shot-1")

    assert audio is not None
    assert any("不是 audio" in w for w in audio.warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_audio_appears_in_delivery_actual_files_section() -> None:
    """声音也要进交付的「绑定素材·实际文件」段（用户要求：明确实际使用的文件）。"""
    from app.models.studio import FileItem, ShotDetail

    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        await _seed_bindings(db)
        db.add(FileItem(id="audio-1", type="audio", name="镜头1配音", storage_key="s/1.mp3"))
        await db.flush()
        db.add(
            ShotDetail(
                id="shot-1", camera_shot="MEDIUM", angle="EYE_LEVEL", movement="STATIC",
                duration=5, video_prompt="镜头缓慢推近。", video_prompt_source="llm",
                audio_file_id="audio-1",
            )
        )
        await db.flush()
        payload = await build_prompt_only_delivery(
            db, project_id="proj-1", scope="episode", sources=["llm"], include_bindings=True
        )

    text = payload["text"]
    assert "【绑定素材·实际文件】" in text
    assert "声音：" in text
    assert "file_id=audio-1" in text
    assert "镜头1配音" in text
    await engine.dispose()


@pytest.mark.asyncio
async def test_missing_audio_file_row_warns_not_crashes() -> None:
    from app.models.studio import ShotDetail

    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        db.add(
            ShotDetail(
                id="shot-1", camera_shot="MEDIUM", angle="EYE_LEVEL", movement="STATIC",
                duration=5, audio_file_id="ghost-audio",
            )
        )
        await db.flush()
        audio = await resolve_shot_audio_file(db, shot_id="shot-1")

    assert audio is not None
    assert audio.usable is False
    assert any("找不到" in w for w in audio.warnings)
    await engine.dispose()


def test_to_shot_linked_asset_items_excludes_audio() -> None:
    """音频不是画面参考图，必须被排除。

    实点验收发现：绑上声音（``shot_details.audio_file_id``）之后，帧图生成接口
    直接 500 —— ``resolve_shot_bound_files`` 把音频也放进结果，而
    ``ShotLinkedAssetItem.type`` 只认 character/prop/scene/costume，
    pydantic Literal 校验失败。这里锁住过滤逻辑。
    """
    from app.services.studio.bound_asset_files import (
        BoundAssetFile,
        to_shot_linked_asset_items,
        usable_file_ids,
    )

    files = [
        BoundAssetFile(
            slot="characters",
            asset_id="char-1",
            asset_type="character",
            asset_name="韩虹",
            file_id="file-char",
            url="https://example.com/c.png",
        ),
        BoundAssetFile(
            slot="audio",
            asset_id="shot-1",
            asset_type="audio",
            asset_name="韩虹台词配音",
            file_id="file-audio",
            url="https://example.com/a.mp3",
        ),
    ]

    items = to_shot_linked_asset_items(files)
    assert [item.type for item in items] == ["character"]

    # 交付/生成侧的 file_id 清单仍然要包含声音（那是另一条口径）
    assert usable_file_ids(files) == ["file-char", "file-audio"]
