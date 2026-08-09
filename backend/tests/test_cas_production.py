"""CAS 生产流水线测试：模型、提示词、产物路径/校验和、Mock 供应商、编排、失败、重试、manifest。

全部离线、确定性；使用内存 SQLite 与临时存储根。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.db import Base
from app.crypto_animal_studio.production.artifact_manager import ArtifactManager, file_checksum, sanitize_segment
from app.crypto_animal_studio.production.enums import ArtifactType, JobStatus, Stage, STAGE_ORDER, stage_index
from app.crypto_animal_studio.production.models import CasProductionArtifact, CasProductionJob, CasProductionShot
from app.crypto_animal_studio.production.orchestrator import retry_production, start_production
from app.crypto_animal_studio.production.prompt_builder import build_all_prompts, build_shot_prompts
from app.crypto_animal_studio.production.providers.mock import build_mock_bundle
from app.crypto_animal_studio.schemas.episode_package import EpisodePackage

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SAMPLE = _REPO_ROOT / "samples" / "cas" / "demo_episode.json"


def _package() -> EpisodePackage:
    return EpisodePackage.model_validate(json.loads(_SAMPLE.read_text(encoding="utf-8")))


async def _make_session():
    engine = create_async_engine("sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    import app.crypto_animal_studio.production.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _count(Session, model) -> int:
    async with Session() as db:
        return int((await db.execute(select(func.count()).select_from(model))).scalar() or 0)


# --------------------------------------------------------------------- #
# 提示词（确定性）
# --------------------------------------------------------------------- #
def test_prompt_builder_is_deterministic() -> None:
    """同一 EpisodePackage 恒等产出相同提示词。"""
    a = [p.to_dict() for p in build_all_prompts(_package())]
    b = [p.to_dict() for p in build_all_prompts(_package())]
    assert a == b


def test_prompt_builder_fields_present_and_ordered() -> None:
    """每镜生成 5 类提示词，且按 sequence 升序。"""
    prompts = build_all_prompts(_package())
    assert [p.sequence for p in prompts] == sorted(p.sequence for p in prompts)
    first = prompts[0]
    assert first.image_prompt and first.negative_prompt and first.video_prompt
    assert first.voice_text and first.subtitle_text
    assert "camera:" in first.image_prompt


def test_prompt_builder_uses_shot_content() -> None:
    """提示词包含镜头动作与对白文本（不调用 LLM，纯拼装）。"""
    pkg = _package()
    shot = sorted(pkg.shots, key=lambda s: s.sequence)[0]
    prompts = build_shot_prompts(pkg, shot)
    assert shot.action in prompts.image_prompt
    assert shot.dialogue[0].text in prompts.subtitle_text


# --------------------------------------------------------------------- #
# 路径 / 校验和
# --------------------------------------------------------------------- #
def test_artifact_paths_follow_convention(tmp_path: Path) -> None:
    """产物路径遵循 storage/cas/productions/{project}/{episode}/{job}/... 约定。"""

    async def _run():
        engine, Session = await _make_session()
        async with Session() as db:
            job = CasProductionJob(id="job-1", project_id="proj-1", episode_id="CAS-E001")
            db.add(job)
            await db.flush()
            m = ArtifactManager(db, job, storage_root=tmp_path)
            assert m.job_relpath == "cas/productions/proj-1/CAS-E001/job-1"
            assert m.artifact_relpath(ArtifactType.manifest).endswith("/manifest.json")
            assert m.artifact_relpath(ArtifactType.final_video).endswith("/final/final_video.txt")
            assert m.artifact_relpath(ArtifactType.image, sequence=1, shot_id="SC01").endswith("/shots/1-SC01/image/image.txt")
            assert m.artifact_relpath(ArtifactType.prompt, sequence=2, shot_id="SC02").endswith("/shots/2-SC02/prompt.json")
        await engine.dispose()

    asyncio.run(_run())


def test_sanitize_segment_blocks_traversal() -> None:
    """路径片段清洗可防止穿越与非法字符。"""
    assert "/" not in sanitize_segment("../../etc/passwd")
    assert sanitize_segment("  ") == "unnamed"


def test_file_checksum_matches_hashlib(tmp_path: Path) -> None:
    """校验和为文件内容的 SHA-256。"""
    import hashlib

    p = tmp_path / "x.txt"
    p.write_text("hello", encoding="utf-8")
    assert file_checksum(p) == hashlib.sha256(b"hello").hexdigest()


# --------------------------------------------------------------------- #
# Mock 供应商真正写文件
# --------------------------------------------------------------------- #
def test_mock_providers_create_real_deterministic_files(tmp_path: Path) -> None:
    """Mock 供应商写出真实文件，且内容确定（两次一致）。"""
    bundle = build_mock_bundle()
    img = tmp_path / "a" / "image.txt"
    r1 = bundle.image.generate_image(target_path=img, prompt="p", negative_prompt="n", context={"shot_id": "SC01", "sequence": 1})
    assert img.is_file() and r1.provider == "mock-image"
    first = img.read_bytes()
    bundle.image.generate_image(target_path=img, prompt="p", negative_prompt="n", context={"shot_id": "SC01", "sequence": 1})
    assert img.read_bytes() == first

    vid = tmp_path / "a" / "video.txt"
    bundle.video.generate_video(target_path=vid, prompt="v", context={"shot_id": "SC01", "sequence": 1, "duration_seconds": 8})
    voice = tmp_path / "a" / "voice.txt"
    bundle.voice.generate_voice(target_path=voice, text="hi", context={"shot_id": "SC01", "sequence": 1})
    final = tmp_path / "final" / "final_video.txt"
    bundle.composer.compose(target_path=final, shot_inputs=[{"sequence": 1, "shot_id": "SC01"}], context={"episode_id": "E"})
    assert vid.is_file() and voice.is_file() and final.is_file()


# --------------------------------------------------------------------- #
# 全流程编排
# --------------------------------------------------------------------- #
def test_full_pipeline_completes_and_creates_artifacts(tmp_path: Path) -> None:
    """有效 EpisodePackage 走完全部阶段，产出各类产物、manifest 与成片。"""

    async def _run():
        engine, Session = await _make_session()
        pkg = _package()
        async with Session() as db:
            job = await start_production(db, project_id="demo-project", package=pkg, providers=build_mock_bundle(), storage_root=tmp_path)
            await db.commit()

        assert job.status == JobStatus.completed.value
        assert job.current_stage == Stage.finalize.value
        assert job.started_at is not None and job.completed_at is not None

        # 每镜 5 类产物 + 任务级 manifest/final_video
        n_shots = len(pkg.shots)
        assert await _count(Session, CasProductionShot) == n_shots
        async with Session() as db:
            rows = list((await db.execute(select(CasProductionArtifact))).scalars().all())
        by_type: dict[str, int] = {}
        for r in rows:
            by_type[r.artifact_type] = by_type.get(r.artifact_type, 0) + 1
        for t in ("prompt", "image", "video", "voice", "subtitle"):
            assert by_type[t] == n_shots, f"{t}={by_type.get(t)}"
        assert by_type["manifest"] == 1 and by_type["final_video"] == 1

        # DB 状态与文件系统一致（存在且校验和匹配）
        for r in rows:
            path = tmp_path / Path(r.file_path)
            assert path.is_file(), r.file_path
            assert file_checksum(path) == r.checksum
        await engine.dispose()

    asyncio.run(_run())


def test_manifest_contents(tmp_path: Path) -> None:
    """manifest 包含全部可追溯字段。"""

    async def _run():
        engine, Session = await _make_session()
        pkg = _package()
        async with Session() as db:
            job = await start_production(db, project_id="demo-project", package=pkg, providers=build_mock_bundle(), storage_root=tmp_path)
            await db.commit()
        manifest_path = tmp_path / Path(f"cas/productions/demo-project/{pkg.episode_id}/{job.id}/manifest.json")
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        for key in (
            "job_id",
            "project_id",
            "episode_id",
            "status",
            "episode_package_hash",
            "started_at",
            "completed_at",
            "shots",
            "artifacts",
            "providers",
            "errors",
            "final_output",
        ):
            assert key in data, key
        assert data["status"] == "completed"
        assert len(data["shots"]) == len(pkg.shots)
        assert data["final_output"].endswith("final/final_video.txt")
        assert data["providers"]["image"]["provider"] == "mock-image"
        assert data["errors"] == []
        await engine.dispose()

    asyncio.run(_run())


def test_new_run_creates_new_job(tmp_path: Path) -> None:
    """再次运行同一 package 会创建新的任务（不复用旧 job）。"""

    async def _run():
        engine, Session = await _make_session()
        pkg = _package()
        async with Session() as db:
            j1 = await start_production(db, project_id="p", package=pkg, providers=build_mock_bundle(), storage_root=tmp_path)
            await db.commit()
        async with Session() as db:
            j2 = await start_production(db, project_id="p", package=pkg, providers=build_mock_bundle(), storage_root=tmp_path)
            await db.commit()
        assert j1.id != j2.id
        assert await _count(Session, CasProductionJob) == 2
        await engine.dispose()

    asyncio.run(_run())


# --------------------------------------------------------------------- #
# 失败与重试
# --------------------------------------------------------------------- #
def test_forced_failure_marks_job_and_shot_failed(tmp_path: Path) -> None:
    """强制 mock 失败：任务与对应镜头标记 failed，已成功产物保留。"""

    async def _run():
        engine, Session = await _make_session()
        pkg = _package()
        async with Session() as db:
            job = await start_production(
                db, project_id="p", package=pkg, providers=build_mock_bundle(video_fail_on_sequence=2), storage_root=tmp_path
            )
            await db.commit()

        assert job.status == JobStatus.failed.value
        assert job.current_stage == Stage.video_generation.value
        assert "mock video failure" in job.error_message

        async with Session() as db:
            shots = list((await db.execute(select(CasProductionShot).order_by(CasProductionShot.sequence))).scalars().all())
            failed = [s for s in shots if s.status == JobStatus.failed.value]
            assert len(failed) == 1 and failed[0].sequence == 2
            arts = list((await db.execute(select(CasProductionArtifact))).scalars().all())
        # 更早阶段（prompt/image）的产物被保留
        kinds = {a.artifact_type for a in arts}
        assert "prompt" in kinds and "image" in kinds
        assert all((tmp_path / Path(a.file_path)).is_file() for a in arts)
        await engine.dispose()

    asyncio.run(_run())


def test_retry_reuses_earlier_artifacts_and_completes(tmp_path: Path) -> None:
    """重试从失败阶段开始：更早产物被复用（内容与校验和不变），最终完成。"""

    async def _run():
        engine, Session = await _make_session()
        pkg = _package()
        async with Session() as db:
            job = await start_production(
                db, project_id="p", package=pkg, providers=build_mock_bundle(video_fail_on_sequence=2), storage_root=tmp_path
            )
            await db.commit()
        assert job.status == JobStatus.failed.value

        # 记录失败前 image 产物的校验和与文件修改时间
        async with Session() as db:
            images = list(
                (await db.execute(select(CasProductionArtifact).where(CasProductionArtifact.artifact_type == "image"))).scalars().all()
            )
            before = {a.id: (a.checksum, (tmp_path / Path(a.file_path)).stat().st_mtime_ns) for a in images}

        async with Session() as db:
            retried = await retry_production(db, job_id=job.id, package=pkg, providers=build_mock_bundle(), storage_root=tmp_path)
            await db.commit()

        assert retried.status == JobStatus.completed.value
        assert retried.id == job.id  # 同一任务续跑

        async with Session() as db:
            images_after = list(
                (await db.execute(select(CasProductionArtifact).where(CasProductionArtifact.artifact_type == "image"))).scalars().all()
            )
        # 未重新生成：校验和一致且文件未被改写
        assert len(images_after) == len(before)
        for a in images_after:
            checksum, mtime = before[a.id]
            assert a.checksum == checksum
            assert (tmp_path / Path(a.file_path)).stat().st_mtime_ns == mtime

        # 失败阶段及之后的产物齐全
        async with Session() as db:
            arts = list((await db.execute(select(CasProductionArtifact))).scalars().all())
        by_type: dict[str, int] = {}
        for a in arts:
            by_type[a.artifact_type] = by_type.get(a.artifact_type, 0) + 1
        n = len(pkg.shots)
        assert by_type["video"] == n and by_type["voice"] == n and by_type["subtitle"] == n
        assert by_type["final_video"] == 1
        await engine.dispose()

    asyncio.run(_run())


def test_retry_rejects_mismatched_package(tmp_path: Path) -> None:
    """重试时 package 与原任务不一致 → 任务标记失败并记录 PackageMismatch。"""

    async def _run():
        engine, Session = await _make_session()
        pkg = _package()
        async with Session() as db:
            job = await start_production(
                db, project_id="p", package=pkg, providers=build_mock_bundle(video_fail_on_sequence=2), storage_root=tmp_path
            )
            await db.commit()
        changed = json.loads(_SAMPLE.read_text(encoding="utf-8"))
        changed["title"] = "Different"
        async with Session() as db:
            result = await retry_production(
                db, job_id=job.id, package=EpisodePackage.model_validate(changed), providers=build_mock_bundle(), storage_root=tmp_path
            )
            await db.commit()
        assert result.status == JobStatus.failed.value
        assert "PackageMismatch" in result.error_message or "does not match" in result.error_message
        await engine.dispose()

    asyncio.run(_run())


# --------------------------------------------------------------------- #
# 枚举与阶段顺序
# --------------------------------------------------------------------- #
def test_stage_order_and_index() -> None:
    """阶段顺序符合流水线定义。"""
    assert STAGE_ORDER[0] is Stage.validate and STAGE_ORDER[-1] is Stage.finalize
    assert stage_index(Stage.image_generation) < stage_index(Stage.composition)
    assert {s.value for s in JobStatus} == {"pending", "running", "completed", "failed", "cancelled"}
    assert {a.value for a in ArtifactType} >= {"prompt", "image", "video", "voice", "subtitle", "manifest", "final_video"}
