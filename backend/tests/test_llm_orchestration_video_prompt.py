"""4.3 视频提示词生成：运镜词库约束、时长归一、非法引用清洗、首尾帧模式、DRY_RUN。"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.schemas.studio.llm_orchestration import VideoPromptPreviewRequest
from app.services.studio.llm_orchestration.registry import (
    ALLOWED_DURATION_SECONDS,
    CAMERA_MOVEMENT_KEYS,
    normalize_camera_movement,
)
from app.services.studio.llm_orchestration.video_prompt import (
    assemble_video_prompt,
    preview_video_prompt,
    resolve_camera_movement,
    snap_duration,
    strip_forbidden_refs,
)
from tests.llm_orchestration_fixtures import (
    build_session,
    make_recording_stub_caller,
    seed_project_chapter_shot,
)

SHOT_TEXT = "姜岁欢跪在庭院中央抬头，秦老夫人拄拐俯视，气氛压迫。"


def _payload(**extra: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "camera_movement": "推",
        "camera_shot": "中景",
        "angle": "仰拍",
        "duration_seconds": 5,
        "action_beats": ["姜岁欢抬头", "秦老夫人俯视"],
        "subject_action": "姜岁欢跪地抬头直视对方",
        "expression_mood": "压抑中带倔强",
        "atmosphere": "青石板庭院，廊柱阴影",
        "first_frame_handling": "从首帧静立状态开始微微抬头",
        "last_frame_handling": "",
        "final_prompt": "姜岁欢跪地抬头直视，镜头缓慢推近，压抑中带倔强，时长约5秒。",
        "negative_prompt": "画面文字",
    }
    payload.update(extra)
    return payload


# ---------------------------------------------------------------------------
# 词库与归一化
# ---------------------------------------------------------------------------


def test_normalize_camera_movement_accepts_vocab_and_aliases() -> None:
    for raw in ("推", "推镜", "push in", "DOLLY_IN", "缓慢推进"):
        spec = normalize_camera_movement(raw)
        assert spec is not None
        assert spec.key == "推"

    assert normalize_camera_movement("环绕").key == "环绕"  # type: ignore[union-attr]
    assert normalize_camera_movement("跟拍").key == "跟"  # type: ignore[union-attr]
    assert normalize_camera_movement("鱼眼镜头旋转") is None


def test_camera_movement_keys_cover_required_vocab() -> None:
    for required in ("推", "拉", "摇", "移", "跟", "环绕"):
        assert required in CAMERA_MOVEMENT_KEYS


def test_snap_duration_only_allows_whitelisted_values() -> None:
    assert snap_duration(5) == 5
    assert snap_duration(7) == 8
    assert snap_duration(11) == 10
    assert snap_duration(0) == 5
    assert snap_duration(None) == 5
    assert snap_duration("6s") == 5
    for value in (1, 3, 6, 7, 9, 11, 13, 30):
        assert snap_duration(value) in ALLOWED_DURATION_SECONDS


def test_resolve_camera_movement_falls_back_when_model_invents_word() -> None:
    warnings: list[str] = []
    resolved, invented = resolve_camera_movement(
        model_value="鱼眼镜头旋转",
        request_value="跟",
        pack_value=None,
        warnings=warnings,
    )

    assert invented == "鱼眼镜头旋转"
    assert resolved.key == "跟"
    assert any("不在标准词库内" in warning for warning in warnings)


def test_resolve_camera_movement_defaults_to_static() -> None:
    warnings: list[str] = []
    resolved, invented = resolve_camera_movement(
        model_value="",
        request_value=None,
        pack_value=None,
        warnings=warnings,
    )

    assert invented == ""
    assert resolved.key == "固定"
    assert resolved.source == "fallback"
    assert resolved.enum_code == "STATIC"
    assert any("固定镜头" in warning for warning in warnings)


def test_strip_forbidden_refs_removes_paths_and_placeholders() -> None:
    cleaned, removed = strip_forbidden_refs(
        "参考图1 与 https://cdn.example.com/a.png 和 /Users/apple/outputs/first_frame.png 都不要出现"
    )

    assert "https://" not in cleaned
    assert "参考图1" not in cleaned
    assert "/Users/" not in cleaned
    assert removed
    assert any("URL" in item for item in removed)


def test_assemble_video_prompt_layers() -> None:
    resolved, _ = resolve_camera_movement(
        model_value="推", request_value=None, pack_value=None, warnings=[]
    )
    text = assemble_video_prompt(
        subject_action="姜岁欢跪地抬头",
        camera=resolved,
        expression_mood="压抑",
        atmosphere="庭院阴影",
        duration_seconds=5,
        style="写实真人短剧",
    )

    assert text.startswith("姜岁欢跪地抬头")
    assert "运镜：推镜（缓慢推近）" in text
    assert "氛围：庭院阴影" in text
    assert "时长约 5 秒" in text
    assert text.endswith("。")


# ---------------------------------------------------------------------------
# 服务层
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preview_video_prompt_success_with_stub() -> None:
    caller, prompts = make_recording_stub_caller(_payload())
    body = VideoPromptPreviewRequest(shot_text=SHOT_TEXT, camera_movement="推")

    db, engine = await build_session()
    async with db:
        result = await preview_video_prompt(db, body=body, llm_caller=caller)

    assert result.meta.llm_called is True
    assert result.camera_movement.key == "推"
    assert result.camera_movement.enum_code == "DOLLY_IN"
    assert result.camera.movement == "推镜（缓慢推近）"
    assert result.camera.duration == 5
    assert result.frame_mode == "single_frame"
    assert result.action_beats == ["姜岁欢抬头", "秦老夫人俯视"]
    assert result.subject_action.startswith("姜岁欢跪地抬头")
    assert result.pack is None
    # 运镜词标准词库进了提示词，且不给模型自由发挥的空间
    assert "不要自己发明运镜词" in prompts[0]
    assert "- 推：" in prompts[0]
    assert "4/5/8/10/12/15" in prompts[0]
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_video_prompt_snaps_duration_and_reports_warning() -> None:
    caller = make_recording_stub_caller(_payload(duration_seconds=7))[0]

    db, engine = await build_session()
    async with db:
        result = await preview_video_prompt(
            db,
            body=VideoPromptPreviewRequest(shot_text=SHOT_TEXT),
            llm_caller=caller,
        )

    assert result.duration_seconds == 8
    assert result.camera.duration == 8
    assert any("不在允许档位" in warning for warning in result.warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_video_prompt_supports_first_last_frame_mode() -> None:
    caller = make_recording_stub_caller(
        _payload(
            camera_movement="环绕",
            last_frame_handling="尾帧停在秦老夫人转身离去的背影",
        )
    )[0]

    db, engine = await build_session()
    async with db:
        result = await preview_video_prompt(
            db,
            body=VideoPromptPreviewRequest(
                shot_text=SHOT_TEXT,
                first_frame_image_ref="oss://frames/head.png",
                last_frame_image_ref="oss://frames/tail.png",
            ),
            llm_caller=caller,
        )

    assert result.frame_mode == "first_last_frame"
    assert result.first_frame_image_ref == "oss://frames/head.png"
    assert result.last_frame_image_ref == "oss://frames/tail.png"
    assert result.last_frame_handling.startswith("尾帧停在")
    assert result.camera_movement.key == "环绕"
    assert result.camera_movement.enum_code is None
    assert result.camera_movement.db_note  # 环绕在 DB 枚举里没有对应值，需人工确认
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_video_prompt_clears_last_frame_handling_in_single_frame_mode() -> None:
    caller = make_recording_stub_caller(_payload(last_frame_handling="不该保留"))[0]

    db, engine = await build_session()
    async with db:
        result = await preview_video_prompt(
            db,
            body=VideoPromptPreviewRequest(shot_text=SHOT_TEXT, frame_mode="single_frame"),
            llm_caller=caller,
        )

    assert result.frame_mode == "single_frame"
    assert result.last_frame_handling == ""
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_video_prompt_sanitizes_final_prompt() -> None:
    caller = make_recording_stub_caller(
        _payload(final_prompt="主体1 参考图2 见 https://x.invalid/a.png 镜头推近")
    )[0]

    db, engine = await build_session()
    async with db:
        result = await preview_video_prompt(
            db,
            body=VideoPromptPreviewRequest(shot_text=SHOT_TEXT),
            llm_caller=caller,
        )

    assert "https://" not in result.final_prompt
    assert "参考图" not in result.final_prompt
    assert "镜头推近" in result.final_prompt
    assert any("不允许的引用" in warning for warning in result.warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_video_prompt_assembles_missing_final_prompt() -> None:
    caller = make_recording_stub_caller(_payload(final_prompt=""))[0]

    db, engine = await build_session()
    async with db:
        result = await preview_video_prompt(
            db,
            body=VideoPromptPreviewRequest(shot_text=SHOT_TEXT),
            llm_caller=caller,
        )

    assert result.final_prompt
    assert "运镜：推镜（缓慢推近）" in result.final_prompt
    assert any("确定性拼装补齐" in warning for warning in result.warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_video_prompt_aligns_with_shot_pack() -> None:
    caller = make_recording_stub_caller(_payload())[0]

    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        result = await preview_video_prompt(
            db,
            body=VideoPromptPreviewRequest(shot_id="shot-1"),
            llm_caller=caller,
        )

    assert result.shot_id == "shot-1"
    assert result.pack is not None
    assert result.pack.shot_id == "shot-1"
    assert result.title == result.pack.title
    assert result.script_excerpt.startswith("姜岁欢在将军府庭院")
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_video_prompt_bad_json_raises_422() -> None:
    caller = make_recording_stub_caller("{} 后面全是废话")[0]

    db, engine = await build_session()
    async with db:
        with pytest.raises(HTTPException) as exc_info:
            await preview_video_prompt(
                db,
                body=VideoPromptPreviewRequest(shot_text=SHOT_TEXT),
                llm_caller=caller,
            )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "llm_json_parse_failed"
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_video_prompt_requires_shot_text() -> None:
    db, engine = await build_session()
    async with db:
        with pytest.raises(HTTPException) as exc_info:
            await preview_video_prompt(
                db,
                body=VideoPromptPreviewRequest(),
                llm_caller=make_recording_stub_caller(_payload())[0],
            )
    assert exc_info.value.status_code == 400
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_video_prompt_dry_run_placeholder(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JELLYFISH_DRY_RUN", "1")

    db, engine = await build_session()
    async with db:
        result = await preview_video_prompt(
            db,
            body=VideoPromptPreviewRequest(shot_text=SHOT_TEXT, camera_movement="推"),
        )

    assert result.meta.dry_run is True
    assert result.meta.llm_called is False
    assert result.camera_movement.key == "推"
    assert result.final_prompt.startswith("[DRY_RUN 占位]")
    assert result.subject_action.startswith("[DRY_RUN 占位]")
    assert any("DRY_RUN" in warning for warning in result.warnings)
    await engine.dispose()
