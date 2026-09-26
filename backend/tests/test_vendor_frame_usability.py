"""参考帧「供应商是否真的取得到」的回归测试（2026-09-19 真实提交暴露的判定错误）。

背景：``shot_frame_images`` 有 ``file_id`` 只代表"已上传/已绑定"。本机存储驱动是 local 时，
帧文件只能被解析成 base64 data URL，而 APIMart 只接受 ``http(s)://`` / ``asset://``。
此前计划预检和集级就绪接口都拿"有没有 file_id"当可用 → 页面显示"可生成"并放开按钮，
真实提交才被供应商 400。这里锁住修复后的口径：

1. 本地文件（有 file_id，只能变 data URL）→ **供应商不可用**，计划/就绪都判阻断；
2. 公网 http(s) 文件 → 可用；
3. ``asset://`` 引用 → 可用；
4. ``text_only`` → 不受参考帧限制（缺帧/不可用都不阻断）。

判定只有一份实现（``app.utils.files.resolve_vendor_image_ref``），计划预检、集级就绪、
提交前校验都用它；测试同时覆盖这三个使用方，防止任何一处再退回"有 file_id 就算可用"。
"""

from __future__ import annotations

import pytest

from app.schemas.studio.image_pipeline import VideoSubmitPlanRequest
from app.services.studio.image_pipeline import video_submit
from app.utils.files import (
    VENDOR_ACCEPTING_ANY,
    is_vendor_accepted_ref,
    resolve_vendor_image_ref,
    vendor_accepts_data_url,
)
from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot

# 1×1 透明 PNG：本地存储分支要真的"读得出内容"，用最小合法 PNG 即可。
_TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c6300010000050001od".replace("od", "0d")
    + "0a2db40000000049454e44ae426082"
)

LOCAL_KEY = "files/frame_local.png"
PUBLIC_KEY = "https://oss.example.com/projects/p/frames/frame_public.png"
ASSET_KEY = "asset://project-1/frame-asset-1"


@pytest.fixture(autouse=True)
def _fake_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    """把存储明确钉成"本地驱动 + 无公网基址"，再替换读取实现。

    为什么要显式钉：本机运行环境可能带有真的 S3/OSS 配置（例如验收用的
    ``backend/.env``）。那种情况下相对 storage_key 会（正确地）解析成公网地址，
    本文件里"本地帧对供应商不可用"的用例前提就不成立了 —— 用例要测的是
    **本地分支**的行为，所以先把环境钉死，不依赖 ambient 配置。
    """
    from app.config import settings
    from app.core.storage import StoredFileInfo

    monkeypatch.setattr(settings, "storage_driver", "local", raising=False)
    monkeypatch.setattr(settings, "s3_bucket_name", None, raising=False)
    monkeypatch.setattr(settings, "s3_public_base_url", "", raising=False)

    async def _fake_download_file(*, key: str) -> bytes:
        return _TINY_PNG

    async def _fake_get_file_info(*, key: str) -> StoredFileInfo:
        return StoredFileInfo(key=key, url=f"https://oss.example.com/{key.lstrip('/')}", content_type="image/png")

    monkeypatch.setattr("app.core.storage.download_file", _fake_download_file)
    monkeypatch.setattr("app.core.storage.get_file_info", _fake_get_file_info)


async def _seed_frames(db, *, frame_keys: dict[str, str]) -> None:
    """种一个镜头 + 细节行 + 帧槽位（key: frame_type → storage_key / None=无 file_id）。"""
    from app.models.studio import FileItem, ShotDetail, ShotFrameImage

    await seed_project_chapter_shot(db)
    db.add(
        ShotDetail(
            id="shot-1",
            camera_shot="MS",
            angle="EYE_LEVEL",
            movement="STATIC",
            duration=5,
        )
    )
    await db.flush()

    for index, (frame_type, storage_key) in enumerate(frame_keys.items(), start=1):
        file_id = ""
        if storage_key:
            file_id = f"file-{frame_type}"
            db.add(FileItem(id=file_id, type="image", name=f"{frame_type}.png", storage_key=storage_key))
            await db.flush()
        db.add(
            ShotFrameImage(
                id=index,
                shot_detail_id="shot-1",
                frame_type=frame_type,
                file_id=file_id or None,
            )
        )
    await db.flush()


async def _seed_video_model(db) -> None:
    """种 provider + 固定视频模型 + ModelSettings，让计划能解析出 apimart 供应商。"""
    from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider

    db.add(Provider(id="prov-1", name="APIMart", base_url="https://api.apimart.test", api_key="k"))
    db.add(
        Model(
            id="model-mini",
            name=video_submit.PINNED_VIDEO_MODEL,
            category=ModelCategoryKey.video,
            provider_id="prov-1",
        )
    )
    db.add(ModelSettings(id=1, default_video_model_id="model-mini"))
    await db.flush()


# ---------------------------------------------------------------------------
# 1) 判定本身（唯一实现）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_local_file_with_file_id_is_not_vendor_usable() -> None:
    """本地文件有 file_id，但只能解析成本机 data URL → 供应商不可用，且原因说清是什么。"""
    db, engine = await build_session()
    async with db:
        await _seed_frames(db, frame_keys={"first": LOCAL_KEY})

        outcome = await resolve_vendor_image_ref(db, file_id="file-first", vendor="apimart")

        assert outcome.file_id == "file-first"
        assert outcome.kind == "local_data_url"
        assert outcome.ref.startswith("data:image/")  # 地址解得出来
        assert outcome.vendor_usable is False  # 但供应商用不了
        assert "供应商无法访问" in outcome.reason
        assert "data URL" in outcome.reason
    await engine.dispose()


@pytest.mark.asyncio
async def test_public_http_and_asset_refs_are_vendor_usable() -> None:
    """公网 http(s) 与 asset:// 引用都可用（这正是跑通 first 模式的前提）。"""
    db, engine = await build_session()
    async with db:
        await _seed_frames(db, frame_keys={"first": PUBLIC_KEY, "last": ASSET_KEY})

        public = await resolve_vendor_image_ref(db, file_id="file-first", vendor="apimart")
        asset = await resolve_vendor_image_ref(db, file_id="file-last", vendor="apimart")

        assert (public.kind, public.ref, public.vendor_usable, public.reason) == ("public", PUBLIC_KEY, True, "")
        assert (asset.kind, asset.ref, asset.vendor_usable, asset.reason) == ("public", ASSET_KEY, True, "")
        assert is_vendor_accepted_ref(PUBLIC_KEY) and is_vendor_accepted_ref(ASSET_KEY)
    await engine.dispose()


@pytest.mark.asyncio
async def test_missing_and_unknown_file_ids_are_reported_with_reasons() -> None:
    """槽位没 file_id（missing）与 file_id 查不到（not_found）都要有具体原因。"""
    db, engine = await build_session()
    async with db:
        await _seed_frames(db, frame_keys={"first": None})

        empty = await resolve_vendor_image_ref(db, file_id="", vendor="apimart")
        ghost = await resolve_vendor_image_ref(db, file_id="file-does-not-exist", vendor="apimart")

        assert empty.kind == "missing" and empty.vendor_usable is False and empty.reason
        assert ghost.kind == "not_found" and ghost.vendor_usable is False and ghost.reason
    await engine.dispose()


def test_vendor_data_url_support_table_is_conservative() -> None:
    """data URL 只有明确支持它的供应商才算可用；未知供应商按不支持处理（收敛不放松）。"""
    assert vendor_accepts_data_url("apimart") is False
    assert vendor_accepts_data_url("openai") is True
    assert vendor_accepts_data_url("some-new-vendor") is False
    assert vendor_accepts_data_url(VENDOR_ACCEPTING_ANY) is True  # 只用于"要个能打开的地址"


# ---------------------------------------------------------------------------
# 2) 计划预检（页面按钮据此禁用）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_plan_blocks_generation_when_frame_is_local_only() -> None:
    """本地首帧 → 帧"存在"但 unusable，generation_blocked=True 且给出具体原因。"""
    db, engine = await build_session()
    async with db:
        await _seed_frames(db, frame_keys={"first": LOCAL_KEY})
        await _seed_video_model(db)

        plan = await video_submit.build_video_submit_plan(
            db, body=VideoSubmitPlanRequest(shot_id="shot-1", reference_mode="first", prompt="p")
        )

        assert plan.reference_mode == "first"
        assert plan.frames[0].file_id == "file-first"  # 帧确实存在
        assert plan.frames[0].usable is False  # 但供应商口径不可用
        assert plan.frames[0].ref_kind == "local_data_url"
        assert plan.frames[0].reason
        assert plan.missing_frame_types == []  # 不是"缺帧"
        assert plan.unusable_frame_types == ["first"]  # 而是"帧存在但供应商取不到"
        assert plan.generation_blocked is True
        assert "first" in plan.blocked_reason
        assert any("不可用" in warning for warning in plan.warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_plan_allows_generation_when_frame_is_public() -> None:
    """公网首帧 → 可用、不阻断（first 模式在配好公网存储后应能生成）。"""
    db, engine = await build_session()
    async with db:
        await _seed_frames(db, frame_keys={"first": PUBLIC_KEY})
        await _seed_video_model(db)

        plan = await video_submit.build_video_submit_plan(
            db, body=VideoSubmitPlanRequest(shot_id="shot-1", reference_mode="first", prompt="p")
        )

        assert plan.frames[0].usable is True
        assert plan.frames[0].ref_kind == "public"
        assert plan.unusable_frame_types == []
        assert plan.missing_frame_types == []
        assert plan.generation_blocked is False
    await engine.dispose()


@pytest.mark.asyncio
async def test_plan_text_only_ignores_missing_and_unusable_frames() -> None:
    """text_only 不需要参考帧：缺帧、不可用帧都不阻断。"""
    db, engine = await build_session()
    async with db:
        # 故意只留一个本地帧（甚至可以是缺的）：text_only 都不该被它影响
        await _seed_frames(db, frame_keys={"first": LOCAL_KEY})
        await _seed_video_model(db)

        plan = await video_submit.build_video_submit_plan(
            db, body=VideoSubmitPlanRequest(shot_id="shot-1", reference_mode="text_only", prompt="p")
        )

        assert plan.required_frame_types == []
        assert plan.unusable_frame_types == []
        assert plan.missing_frame_types == []
        assert plan.generation_blocked is False
        assert plan.blocked_reason == ""
    await engine.dispose()


@pytest.mark.asyncio
async def test_submit_never_reaches_provider_when_frame_is_local_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """提交端第二层兜底：本地帧必须被拦在 provider 之前（不创建任务、不发请求）。"""
    from app.services.studio.llm_orchestration.dry_run import CONFIRM_ENV, DRY_RUN_ENV

    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    created: list[str] = []

    def _factory(**kwargs):  # type: ignore[no-untyped-def]
        created.append("task")
        raise AssertionError("帧供应商不可用时不得创建生成任务")

    db, engine = await build_session()
    async with db:
        await _seed_frames(db, frame_keys={"first": LOCAL_KEY})
        await _seed_video_model(db)

        result = await video_submit.submit_video(
            db,
            body=VideoSubmitPlanRequest(shot_id="shot-1", reference_mode="first", prompt="p"),
            task_factory=_factory,
        )

    assert created == []
    assert result.status == "rejected_before_submit"
    assert "first" in result.error
    await engine.dispose()


# ---------------------------------------------------------------------------
# 3) 集级就绪接口（同一个镜头，两种模式）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_readiness_marks_local_frame_unusable_and_blocks_generation() -> None:
    """集级就绪：usable_frame_types 不含本地帧，unusable_frame_types 含它，并给出原因。"""
    from app.services.studio.prompt_board import load_readiness
    from app.models.studio import ShotDetail

    db, engine = await build_session()
    async with db:
        await _seed_frames(db, frame_keys={"first": LOCAL_KEY})
        await _seed_video_model(db)
        detail = await db.get(ShotDetail, "shot-1")
        detail.video_prompt = "雨夜咖啡店，林小满推门进来"
        detail.video_prompt_source = "external_import"
        await db.flush()

        readiness = await load_readiness(db, chapter_id="chap-1", reference_mode="first")
        row = readiness["rows"][0]

        assert row["required_frame_types"] == ["first"]
        assert "first" not in row["usable_frame_types"]  # 有 file_id ≠ 可用
        assert row["unusable_frame_types"] == ["first"]
        assert row["missing_frame_types"] == []  # 不是"没上传"
        assert row["generation_blocked"] is True
        assert any("供应商无法访问" in reason for reason in row["frame_block_reasons"])
        assert readiness["summary"]["frames_ready"] == 0
        assert readiness["summary"]["frames_unusable"] == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_readiness_accepts_public_frame_and_text_only() -> None:
    """公网帧 → 就绪；text_only → 不受帧限制（同一份数据两种模式结论不同）。"""
    from app.services.studio.prompt_board import load_readiness
    from app.models.studio import ShotDetail

    db, engine = await build_session()
    async with db:
        await _seed_frames(db, frame_keys={"first": PUBLIC_KEY})
        await _seed_video_model(db)
        detail = await db.get(ShotDetail, "shot-1")
        detail.video_prompt = "雨夜咖啡店，林小满推门进来"
        detail.video_prompt_source = "external_import"
        await db.flush()

        with_frame = await load_readiness(db, chapter_id="chap-1", reference_mode="first")
        text_only = await load_readiness(db, chapter_id="chap-1", reference_mode="text_only")

        assert with_frame["rows"][0]["usable_frame_types"] == ["first"]
        assert with_frame["rows"][0]["unusable_frame_types"] == []
        assert with_frame["rows"][0]["generation_blocked"] is False
        assert with_frame["summary"]["frames_ready"] == 1

        assert text_only["rows"][0]["required_frame_types"] == []
        assert text_only["rows"][0]["generation_blocked"] is False
    await engine.dispose()


# ---------------------------------------------------------------------------
# 4) 提交前校验与供应商适配器同口径
# ---------------------------------------------------------------------------


def test_submit_side_guard_shares_the_same_predicate() -> None:
    """提交前的兜底断言与适配器判定同源：data URL 被拦，http/asset:// 放行。"""
    from fastapi import HTTPException

    from app.services.film.generated_video import _assert_frames_vendor_acceptable
    from app.models.types import ShotFrameType

    # data URL（本地帧的形态）→ 必须拦下
    with pytest.raises(HTTPException) as exc_info:
        _assert_frames_vendor_acceptable(
            provider="apimart",
            frame_map={ShotFrameType.first: "data:image/png;base64,AAAA"},
        )
    assert exc_info.value.status_code == 400
    assert "first" in str(exc_info.value.detail)
    assert "供应商无法访问" in str(exc_info.value.detail)

    # 公网 / asset:// → 放行
    _assert_frames_vendor_acceptable(
        provider="apimart",
        frame_map={ShotFrameType.first: PUBLIC_KEY, ShotFrameType.last: ASSET_KEY},
    )

    # 接受 data URL 的供应商不受这条限制
    _assert_frames_vendor_acceptable(
        provider="openai",
        frame_map={ShotFrameType.first: "data:image/png;base64,AAAA"},
    )
