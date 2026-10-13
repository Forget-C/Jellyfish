"""将固定单轨真实采用渲染为 MP4；只处理本次临时文件，不发布任务成果。"""
import json
from fractions import Fraction
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from app.core.contracts.directing.scene_version import SceneVersionContent
from app.core.contracts.directing.scene_export import SceneExportProfile, SceneExportClipScale


OUTPUT_SIZES = {'16:9': (1920, 1080), '9:16': (1080, 1920), '1:1': (1080, 1080)}


def export_profile(aspect_ratio: str, size: int = 1080) -> SceneExportProfile:
    """只支持约定的两个尺寸档位，完整尺寸随执行快照固定。"""
    if size not in (1080, 720):
        raise ValueError('仅支持 1080 或 720 档')
    width, height = (value * size // 1080 for value in OUTPUT_SIZES[aspect_ratio])
    return SceneExportProfile(size=size, width=width, height=height)


def _probe(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
        '-show_streams', '-show_format', '-of', 'json', str(path)], capture_output=True, check=True, timeout=30)
    return json.loads(result.stdout)


def inspect_scene_source(clip_id, data, fit, profile, source_out_ms=None, source_in_ms=0, verify_decode=False):
    """读取实际视频流尺寸；填满时按裁切后有效像素判断普通放大。"""
    with TemporaryDirectory(prefix='jellyfish-export-inspect-') as directory:
        path = Path(directory) / 'source.video'
        path.write_bytes(data)
        try:
            info = _probe(path)
            video = next(row for row in info['streams'] if row['codec_type'] == 'video')
            duration = float(video.get('duration') or info['format']['duration'])
            if source_out_ms is not None and source_out_ms > round(duration * 1000):
                raise ValueError('源区间超过真实视频时长')
            sar = video.get('sample_aspect_ratio', '1:1')
            width = float(video['width']) * (float(Fraction(sar.replace(':', '/'))) if sar not in ('N/A', '0:1') else 1)
            height = float(video['height'])
            rotation = next((row.get('rotation', 0) for row in video.get('side_data_list', []) if 'rotation' in row), 0)
            if abs(rotation) % 180 == 90:
                width, height = height, width
            if width <= 0 or height <= 0:
                raise ValueError('媒体尺寸无效')
            if verify_decode:
                length = (source_out_ms - source_in_ms) / 1000 if source_out_ms is not None else duration
                subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-nostdin', '-protocol_whitelist', 'file,pipe',
                    '-ss', str(source_in_ms / 1000), '-i', str(path), '-t', str(length), '-f', 'null', '-'],
                    capture_output=True, check=True, timeout=300)
        except (subprocess.SubprocessError, ValueError, KeyError, StopIteration, ZeroDivisionError) as error:
            raise ValueError(f'片段 {clip_id} 原媒体无法读取或区间无效') from error
    scale = (max if fit == 'cover' else min)(profile.width / width, profile.height / height)
    return SceneExportClipScale(clip_id=clip_id, source_width=width, source_height=height,
        effective_width=profile.width / scale if fit == 'cover' else width,
        effective_height=profile.height / scale if fit == 'cover' else height,
        scale=scale, needs_upscale=scale > 1.000001)


def render_scene_cut(content: SceneVersionContent, sources: dict[str, bytes], profile: SceneExportProfile | None = None) -> bytes:
    """按原区间和时间位置渲染，空白为黑场静音，任何坏媒体使整次失败。

    调用者负责文件授权与任务取消裁决；此函数不会登记或提供半成品。
    """
    clips = sorted(content.timeline.items, key=lambda item: item.timeline_start_ms)
    if not clips:
        raise ValueError('空时间线不能导出')
    if any(clip.kind != 'media' for clip in clips):
        raise ValueError('待拍占位不能导出，请替换为真实素材')
    width, height = (profile.width, profile.height) if profile else OUTPUT_SIZES[content.output_aspect_ratio]
    with TemporaryDirectory(prefix='jellyfish-export-') as directory:
        command = ['ffmpeg', '-v', 'error', '-xerror', '-nostdin']
        filters, segments = [], []
        cursor = 0
        for index, clip in enumerate(clips):
            if clip.timeline_start_ms < cursor:
                raise ValueError(f'片段 {clip.id} 与主轨重叠')
            path = Path(directory) / f'input-{index}.video'
            data = sources.get(clip.file_id)
            if not data:
                raise ValueError(f'片段 {clip.id} 原媒体不可用')
            path.write_bytes(data)
            try:
                info = _probe(path)
                video = next(row for row in info['streams'] if row['codec_type'] == 'video')
                duration = float(video.get('duration') or info['format']['duration'])
                if clip.media_range.source_out_ms > round(duration * 1000):
                    raise ValueError('源区间超过真实视频时长')
            except (subprocess.SubprocessError, ValueError, KeyError, StopIteration) as error:
                raise ValueError(f'片段 {clip.id} 原媒体无法解码或区间无效') from error
            command.extend(['-protocol_whitelist', 'file,pipe', '-i', str(path)])
            gap = (clip.timeline_start_ms - cursor) / 1000
            if gap:
                filters.extend([f'color=c=black:s={width}x{height}:r=30:d={gap}[gv{index}]',
                    f'anullsrc=r=48000:cl=stereo,atrim=duration={gap}[ga{index}]'])
                segments.append(f'[gv{index}][ga{index}]')
            start = clip.media_range.source_in_ms / 1000
            length = (clip.media_range.source_out_ms - clip.media_range.source_in_ms) / 1000
            framing = (f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black'
                if clip.fit == 'contain' else f'scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}')
            filters.append(f'[{index}:v:0]trim=start={start}:duration={length},setpts=PTS-STARTPTS,fps=30:start_time=0,scale=iw*sar:ih,setsar=1,{framing},setsar=1,format=yuv420p[v{index}]')
            audio = (f'[{index}:a:0]atrim=start={start}:duration={length},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration={length}'
                if any(row['codec_type'] == 'audio' for row in info['streams']) else f'anullsrc=r=48000:cl=stereo,atrim=duration={length}')
            filters.append(f'{audio}[a{index}]')
            segments.append(f'[v{index}][a{index}]')
            cursor = clip.timeline_start_ms + clip.media_range.source_out_ms - clip.media_range.source_in_ms
        filters.append(''.join(segments) + f'concat=n={len(segments)}:v=1:a=1[v][a]')
        output = Path(directory) / 'export.mp4'
        command.extend(['-filter_complex', ';'.join(filters), '-map', '[v]', '-map', '[a]', '-t', str(cursor / 1000),
            '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-ar', '48000',
            '-movflags', '+faststart', str(output)])
        try:
            subprocess.run(command, capture_output=True, check=True, timeout=300)
        except subprocess.SubprocessError as error:
            # 编码失败后才逐片段解码定位；正常导出不重复解码整场素材。
            if isinstance(error, subprocess.CalledProcessError):
                for clip in clips:
                    inspect_scene_source(clip.id, sources[clip.file_id], clip.fit,
                        profile or export_profile(content.output_aspect_ratio),
                        clip.media_range.source_out_ms, clip.media_range.source_in_ms, verify_decode=True)
            identities = '、'.join(clip.id for clip in clips)
            raise ValueError(f'导出片段 {identities} 编码失败或超时，未提供成片') from error
        return output.read_bytes()
