"""章节时间线导出异步 Runner：校验 chapter→shot→file，拼接 FFmpeg，写入成片与 FileUsage。"""

from __future__ import annotations

import asyncio
import tempfile
import uuid
from pathlib import Path

from sqlalchemy import select

from app.core import storage
from app.core.db import async_session_maker
from app.core.task_manager import SqlAlchemyTaskStore
from app.core.task_manager.types import TaskStatus
from app.models.studio import Chapter, FileItem, FileType, Shot
from app.models.task_links import GenerationTaskLink
from app.models.types import FileUsageKind
from app.schemas.studio.chapter_timeline import ChapterTimelineSegmentRead
from app.services.studio.chapter_timeline import build_timeline_read
from app.services.studio.chapter_timeline_export import (
    EXPORT_RELATION_TYPE,
    EXPORT_RESOURCE_TYPE,
    ensure_timeline_exportable,
)
from app.services.studio.chapter_timeline_media import ffprobe_local_file, probe_duration_and_audio
from app.services.studio.chapter_timeline_trim import (
    is_lossless_compatible_trim,
    source_duration_ms_from_seconds,
    trim_seconds_for_ffmpeg,
)
from app.services.studio.file_usages import upsert_file_usage
from app.services.worker.async_task_support import cancel_if_requested_async
from app.services.worker.task_logging import log_task_event, log_task_failure


def _video_stream_meta(probe: dict) -> dict | None:
    for stream in probe.get("streams") or []:
        if stream.get("codec_type") == "video":
            return stream
    return None


def _collect_lossless_identity(meta: dict) -> tuple[str, int, int, str]:
    """返回用于无损拼接比对的 (codec, width, height, pix_fmt)。"""
    return (
        str(meta.get("codec_name") or ""),
        int(meta.get("width") or 0),
        int(meta.get("height") or 0),
        str(meta.get("pix_fmt") or ""),
    )


def build_uniform_transcode_concat_filter(segments: list[tuple[float, float, bool]]) -> str:
    """构造 concat 的 filter_complex：每段先 trim 再拼接音画。

    ``segments``：每项为 ``(trim_start_s, trim_end_s, has_audio)``；无音轨时用 ``anullsrc`` 补满 ``trim`` 后时长。
    """
    n = len(segments)
    if n == 0:
        raise ValueError("empty segment list for concat filter")
    parts: list[str] = []
    for i, (start_s, end_s, has_audio) in enumerate(segments):
        clip_dur = end_s - start_s
        if clip_dur <= 0:
            raise ValueError(f"invalid trim duration at index {i}: {clip_dur}")
        parts.append(
            f"[{i}:v:0]trim=start={start_s:.6f}:end={end_s:.6f},setpts=PTS-STARTPTS,setsar=1[v{i}]",
        )
        if has_audio:
            parts.append(
                f"[{i}:a:0]atrim=start={start_s:.6f}:end={end_s:.6f},asetpts=PTS-STARTPTS,"
                f"aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a{i}]",
            )
        else:
            parts.append(
                f"anullsrc=channel_layout=stereo:sample_rate=48000,"
                f"atrim=end={clip_dur:.6f},asetpts=PTS-STARTPTS[a{i}]",
            )
    concat_in = "".join(f"[v{i}][a{i}]" for i in range(n))
    parts.append(f"{concat_in}concat=n={n}:v=1:a=1[outv][outa]")
    return ";".join(parts)


async def _ffmpeg_concat_copy(list_file: Path, output: Path) -> None:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_file),
        "-c",
        "copy",
        str(output),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        msg = (stderr or b"").decode("utf-8", errors="replace")[:4000]
        raise RuntimeError(f"ffmpeg concat copy 失败: {msg}")


async def _ffmpeg_concat_reencode(
    inputs: list[Path],
    timeline_segments: list[ChapterTimelineSegmentRead],
    output: Path,
) -> None:
    """统一转码拼接：每段按 trim 裁剪后输出 H.264 + AAC。"""
    if len(inputs) != len(timeline_segments):
        raise RuntimeError("片段文件数与时间线条目数不一致")

    specs: list[tuple[float, float, bool]] = []
    for path, seg in zip(inputs, timeline_segments, strict=True):
        probe = await ffprobe_local_file(path)
        dur_s, has_audio = probe_duration_and_audio(probe)
        if dur_s <= 0:
            raise RuntimeError(f"无法解析片段时长: {path}")
        start_s, end_s = trim_seconds_for_ffmpeg(dur_s, seg.trim_start_ms, seg.trim_end_ms)
        if end_s - start_s <= 0:
            raise RuntimeError(f"裁剪后时长无效: shot_id={seg.shot_id}")
        specs.append((start_s, end_s, has_audio))

    args: list[str] = ["ffmpeg", "-y"]
    for p in inputs:
        args += ["-i", str(p)]
    filt = build_uniform_transcode_concat_filter(specs)
    args += [
        "-filter_complex",
        filt,
        "-map",
        "[outv]",
        "-map",
        "[outa]",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(output),
    ]
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        msg = (stderr or b"").decode("utf-8", errors="replace")[:4000]
        raise RuntimeError(f"ffmpeg 统一转码拼接失败: {msg}")


async def run_chapter_timeline_export_task(task_id: str, run_args: dict) -> None:
    """执行章节时间线导出：不信任 run_args 中的 file_id，仅使用 chapter_id / encode_mode。"""
    chapter_id = str(run_args.get("chapter_id") or "").strip()
    encode_mode = str(run_args.get("encode_mode") or "uniform_transcode").strip()
    if not chapter_id:
        raise RuntimeError("run_args 缺少 chapter_id")
    if encode_mode not in {"uniform_transcode", "lossless_concat_only"}:
        raise RuntimeError(f"不支持的 encode_mode: {encode_mode}")

    async with async_session_maker() as session:
        try:
            store = SqlAlchemyTaskStore(session)
            await store.set_status(task_id, TaskStatus.running)
            await store.set_progress(task_id, 5)
            await session.commit()
            log_task_event("chapter_timeline_export", task_id, "running")

            if await cancel_if_requested_async(store=store, task_id=task_id, session=session):
                log_task_event("chapter_timeline_export", task_id, "cancelled", stage="before_execute")
                return

            read = await build_timeline_read(session, chapter_id)
            ensure_timeline_exportable(read)
            chapter = await session.get(Chapter, chapter_id)
            if chapter is None:
                raise RuntimeError(f"章节不存在: {chapter_id}")
            project_id = chapter.project_id

            ordered_files: list[tuple[Shot, FileItem]] = []
            for seg in read.segments:
                shot = await session.get(Shot, seg.shot_id)
                if shot is None or shot.chapter_id != chapter_id:
                    raise RuntimeError(f"镜头不属于该章节: {seg.shot_id}")
                fid = shot.generated_video_file_id
                if not fid:
                    raise RuntimeError(f"镜头缺少成片文件: {seg.shot_id}")
                file_obj = await session.get(FileItem, fid)
                if file_obj is None or file_obj.type != FileType.video or not file_obj.storage_key:
                    raise RuntimeError(f"镜头成片文件无效: {seg.shot_id}")
                ordered_files.append((shot, file_obj))

            if not ordered_files:
                raise RuntimeError("时间线为空，无法导出")

            await store.set_progress(task_id, 20)
            await session.commit()

            with tempfile.TemporaryDirectory(prefix=f"jf-ch-export-{task_id}-") as tmp:
                tmp_path = Path(tmp)
                local_inputs: list[Path] = []
                for idx, (_shot, file_obj) in enumerate(ordered_files):
                    data = await storage.download_file(key=file_obj.storage_key)
                    if not data:
                        raise RuntimeError(f"无法下载镜头成片: {file_obj.id}")
                    dest = tmp_path / f"clip_{idx:04d}.mp4"
                    dest.write_bytes(data)
                    local_inputs.append(dest)

                out_file = tmp_path / "master.mp4"

                if encode_mode == "lossless_concat_only":
                    for seg, p in zip(read.segments, local_inputs, strict=True):
                        probe = await ffprobe_local_file(p)
                        dur_s, _ = probe_duration_and_audio(probe)
                        dur_ms = source_duration_ms_from_seconds(dur_s)
                        if not is_lossless_compatible_trim(dur_ms, seg.trim_start_ms, seg.trim_end_ms):
                            raise RuntimeError(
                                "lossless_concat_only 不支持裁剪片段，请改用 uniform_transcode",
                            )
                    identities: list[tuple[str, int, int, str]] = []
                    for p in local_inputs:
                        probe = await ffprobe_local_file(p)
                        vmeta = _video_stream_meta(probe)
                        if vmeta is None:
                            raise RuntimeError("lossless_concat_only：输入缺少视频流")
                        identities.append(_collect_lossless_identity(vmeta))
                    first = identities[0]
                    if any(x != first for x in identities):
                        raise RuntimeError(
                            "lossless_concat_only：片段视频编码/分辨率/像素格式不一致，无法无损拼接",
                        )
                    list_file = tmp_path / "concat.txt"
                    lines: list[str] = []
                    for p in local_inputs:
                        escaped = str(p).replace("'", "'\\''")
                        lines.append(f"file '{escaped}'")
                    list_file.write_text("\n".join(lines), encoding="utf-8")
                    await _ffmpeg_concat_copy(list_file, out_file)
                else:
                    await _ffmpeg_concat_reencode(local_inputs, read.segments, out_file)

                master_bytes = out_file.read_bytes()
                if not master_bytes:
                    raise RuntimeError("导出结果为空文件")

            out_key = f"generated-videos/chapters/{chapter_id}/timeline/{uuid.uuid4().hex}.mp4"
            info = await storage.upload_file(
                key=out_key,
                data=master_bytes,
                content_type="video/mp4",
                extra_args={"ACL": "public-read"},
            )

            new_file_id = str(uuid.uuid4())
            session.add(
                FileItem(
                    id=new_file_id,
                    type=FileType.video,
                    name=f"chapter-{chapter_id}-timeline-master",
                    thumbnail=info.url,
                    tags=[],
                    storage_key=out_key,
                ),
            )

            link_stmt = (
                select(GenerationTaskLink)
                .where(
                    GenerationTaskLink.task_id == task_id,
                    GenerationTaskLink.resource_type == EXPORT_RESOURCE_TYPE,
                    GenerationTaskLink.relation_type == EXPORT_RELATION_TYPE,
                    GenerationTaskLink.relation_entity_id == chapter_id,
                )
                .limit(1)
            )
            link_row = (await session.execute(link_stmt)).scalars().first()
            if link_row is not None:
                link_row.file_id = new_file_id

            await upsert_file_usage(
                session,
                file_id=new_file_id,
                project_id=project_id,
                chapter_id=chapter_id,
                shot_id=None,
                usage_kind=FileUsageKind.chapter_master_video,
                source_ref=f"chapter:{chapter_id}:timeline_export:{task_id}",
            )

            await store.set_result(
                task_id,
                {
                    "file_id": new_file_id,
                    "chapter_id": chapter_id,
                    "encode_mode": encode_mode,
                },
            )
            if await cancel_if_requested_async(store=store, task_id=task_id, session=session):
                log_task_event("chapter_timeline_export", task_id, "cancelled", stage="after_persist")
                return
            await store.set_progress(task_id, 100)
            await store.set_status(task_id, TaskStatus.succeeded)
            await session.commit()
            log_task_event("chapter_timeline_export", task_id, "succeeded")
        except Exception as exc:  # noqa: BLE001
            await session.rollback()
            async with async_session_maker() as s2:
                store = SqlAlchemyTaskStore(s2)
                await store.set_error(task_id, str(exc))
                await store.set_status(task_id, TaskStatus.failed)
                await s2.commit()
            log_task_failure("chapter_timeline_export", task_id, str(exc))
