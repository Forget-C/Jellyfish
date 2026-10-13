"""真实 FFmpeg 文件验证成片参数、保留空白和媒体裁取，不模拟编码结果。"""
from array import array
import json
import subprocess

import pytest

from app.core.contracts.directing.scene_version import SceneVersionContent
from app.core.contracts.directing.scene_export import SceneExportProfile
from app.services.directing.scene_export_render import render_scene_cut
from tests.directing.samples import design_sample


@pytest.mark.parametrize('tier', [1080, 720])
@pytest.mark.parametrize('rate', [24, 30, 60])
@pytest.mark.parametrize('ratio,size', [('16:9', (1920, 1080)), ('9:16', (1080, 1920)), ('1:1', (1080, 1080))])
@pytest.mark.parametrize('with_audio', [False, True])
def test_export_keeps_leading_gap_and_outputs_fixed_mp4(tmp_path, tier, rate, ratio, size, with_audio):
    size = tuple(value * tier // 1080 for value in size)
    profile = SceneExportProfile(width=size[0], height=size[1], size=tier)
    source = tmp_path / 'red.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'color=red:s=160x90:r={rate}:d=2',
        *(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=2', '-c:a', 'aac', '-shortest'] if with_audio else []),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(source)], check=True)
    content = SceneVersionContent.model_validate({'output_aspect_ratio': ratio, 'basis': {'source': {'kind': 'chapter', 'reference': 'chapter', 'version': '1'},
        'text': '导出', 'start': 0, 'end': 2}, 'design': design_sample(), 'timeline': {'items': [
        {'id': 'clip', 'kind': 'media', 'take_kind': 'scene_video', 'take_id': 'take', 'file_id': 'red',
         'media_range': {'source_in_ms': 500, 'source_out_ms': 1500}, 'timeline_start_ms': 1000, 'fit': 'contain'}]}})
    output = tmp_path / 'export.mp4'
    output.write_bytes(render_scene_cut(content, {'red': source.read_bytes()}, profile=profile))
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(output)]))
    video = next(row for row in probe['streams'] if row['codec_type'] == 'video')
    audio = next(row for row in probe['streams'] if row['codec_type'] == 'audio')
    assert (video['codec_name'], video['width'], video['height'], video['r_frame_rate']) == ('h264', *size, '30/1')
    assert audio['codec_name'] == 'aac'
    assert abs(float(probe['format']['duration']) - 2) < 0.06
    def pixel(at):
        return subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(at), '-i', str(output),
            '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    assert max(pixel(0.5)) < 10
    red, green, blue = pixel(1.5)
    if ratio == '16:9':
        assert red > 220 and green < 20 and blue < 20
    else:
        assert red > 40 and green < 20 and blue < 20
    def audio_peak(at):
        pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(at), '-i', str(output),
            '-t', '0.25', '-vn', '-f', 's16le', '-ac', '1', 'pipe:1'])
        return max(abs(sample) for sample in array('h', pcm))
    assert audio_peak(0.5) < 100
    assert audio_peak(1.5) > 2000 if with_audio else audio_peak(1.5) < 100
    with pytest.raises(ValueError, match='clip'):
        render_scene_cut(content, {'red': b'corrupt video'})


@pytest.mark.parametrize('tier', [1080, 720])
@pytest.mark.parametrize('ratio', ['16:9', '9:16', '1:1'])
def test_export_mixed_rates_keeps_gaps_source_ranges_and_per_clip_fit(tmp_path, tier, ratio):
    from app.services.directing.scene_export_render import export_profile
    profile = export_profile(ratio, tier)
    sources = {}
    for name, rate, color in [('slow', 25, 'red'), ('fast', 60, 'blue')]:
        path = tmp_path / f'{name}.mp4'
        dimensions = '160x90' if name == 'slow' else '1920x1080'
        # First second is green; the adopted second must use the other colour.
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'color=green:s={dimensions}:r={rate}:d=1',
            '-f', 'lavfi', '-i', f'color={color}:s={dimensions}:r={rate}:d=1',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
            '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1', '-filter_complex',
            '[0:v][1:v]concat=n=2:v=1:a=0,drawbox=x=0:y=0:w=iw/4:h=ih:color=yellow:t=fill,drawbox=x=3*iw/4:y=0:w=iw/4:h=ih:color=magenta:t=fill[v];[2:a][3:a]concat=n=2:v=0:a=1[a]',
            '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', str(path)], check=True)
        sources[name] = path.read_bytes()
    content = SceneVersionContent.model_validate({'output_aspect_ratio': ratio, 'basis': {
        'source': {'kind': 'chapter', 'reference': 'chapter', 'version': '1'}, 'text': '导出'},
        'design': design_sample(), 'timeline': {'items': [
            {'id': 'slow-clip', 'kind': 'media', 'take_kind': 'scene_video', 'take_id': 'slow-take', 'file_id': 'slow',
             'media_range': {'source_in_ms': 1000, 'source_out_ms': 2000}, 'timeline_start_ms': 500, 'fit': 'contain'},
            {'id': 'fast-clip', 'kind': 'media', 'take_kind': 'scene_video', 'take_id': 'fast-take', 'file_id': 'fast',
             'media_range': {'source_in_ms': 1000, 'source_out_ms': 2000}, 'timeline_start_ms': 2000, 'fit': 'cover'},
        ]}})
    output = tmp_path / 'mixed.mp4'
    output.write_bytes(render_scene_cut(content, sources, profile))
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=duration,nb_read_frames,r_frame_rate', '-of', 'json', str(output)]))['streams'][0]
    assert probe['r_frame_rate'] == '30/1'
    assert int(probe['nb_read_frames']) == 90
    assert abs(float(probe['duration']) - 3) < 0.034
    def sample(at, y, x=None):
        return subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(at), '-i', str(output),
            '-vf', f'crop=2:2:{profile.width // 2 if x is None else x}:{y},scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    assert max(sample(0.25, 540)) < 10
    assert max(sample(1.75, 540)) < 10
    if ratio == '16:9':
        assert sample(0.75, 50)[0] > 220  # same aspect ratio needs no bars
    else:
        assert max(sample(0.75, 50)) < 10  # contain preserves black bars
    red, green, blue = sample(0.75, profile.height // 2)
    assert red > 220 and green < 20 and blue < 20
    red, green, blue = sample(2.25, 50)
    assert blue > 220 and red < 20 and green < 20  # cover fills the frame
    assert max(sample(2.95, profile.height // 2)) > 220
    if ratio == '9:16':
        for x in [0, profile.width - 2]:
            red, green, blue = sample(2.25, 50, x)
            assert blue > 220 and red < 20 and green < 20  # centered cover removes both coloured side bands
    else:
        red, green, blue = sample(2.25, 50, 0)
        assert red > 220 and green > 220 and blue < 20
    for at in [0.75, 2.25]:
        pcm = array('h', subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(at), '-i', str(output),
            '-t', '0.25', '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1']))
        crossings = sum(left <= 0 < right for left, right in zip(pcm, pcm[1:]))
        assert 215 <= crossings <= 225  # Adopted second is 880 Hz, not the first second's 440 Hz.
    gap_audio = array('h', subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', '1.65', '-i', str(output),
        '-t', '0.2', '-vn', '-ac', '1', '-f', 's16le', 'pipe:1']))
    assert max(abs(value) for value in gap_audio) < 100

    assert sources['slow'] == (tmp_path / 'slow.mp4').read_bytes()
    assert sources['fast'] == (tmp_path / 'fast.mp4').read_bytes()


@pytest.mark.parametrize('tier', [1080, 720])
@pytest.mark.parametrize('fit', ['contain', 'cover'])
def test_inspection_measures_actual_landscape_crop_before_portrait_export(tmp_path, tier, fit):
    from app.services.directing.scene_export_render import inspect_scene_source
    source = tmp_path / 'landscape.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=1920x1080:r=24:d=0.2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(source)], check=True)
    profile = SceneExportProfile(size=tier, width=tier, height=tier * 16 // 9)
    result = inspect_scene_source('portrait-clip', source.read_bytes(), fit, profile)
    assert result.source_width == 1920 and result.source_height == 1080
    assert result.needs_upscale is (fit == 'cover')
    if fit == 'cover':
        assert result.effective_width == pytest.approx(607.5)
        assert result.effective_height == 1080
        assert result.scale == pytest.approx(profile.height / 1080)
    else:
        assert result.effective_width == 1920 and result.effective_height == 1080
        assert result.scale == pytest.approx(tier / 1920)


def test_retry_inspection_rejects_truncated_packets_with_readable_header(tmp_path):
    from app.services.directing.scene_export_render import inspect_scene_source, export_profile
    source = tmp_path / 'damaged.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=2',
        '-c:v', 'libx264', '-movflags', '+faststart', str(source)], check=True)
    damaged = source.read_bytes()[:-200]
    profile = export_profile('16:9', 720)
    assert inspect_scene_source('packet-damage', damaged, 'contain', profile).source_width == 160
    with pytest.raises(ValueError, match='packet-damage'):
        inspect_scene_source('packet-damage', damaged, 'contain', profile, 2000, 0, verify_decode=True)


def test_export_identifies_damaged_clip_among_readable_sources(tmp_path):
    from app.services.directing.scene_export_render import export_profile
    source = tmp_path / 'source.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=2',
        '-c:v', 'libx264', '-movflags', '+faststart', str(source)], check=True)
    data = source.read_bytes()
    content = SceneVersionContent.model_validate({'basis': {'source': {'kind': 'chapter', 'reference': 'chapter', 'version': '1'},
        'text': '导出', 'start': 0, 'end': 2}, 'design': design_sample(), 'timeline': {'items': [
        {'id': 'healthy', 'kind': 'media', 'take_kind': 'scene_video', 'take_id': 'take1', 'file_id': 'good',
         'media_range': {'source_in_ms': 0, 'source_out_ms': 1000}, 'timeline_start_ms': 0, 'fit': 'contain'},
        {'id': 'broken', 'kind': 'media', 'take_kind': 'scene_video', 'take_id': 'take2', 'file_id': 'bad',
         'media_range': {'source_in_ms': 0, 'source_out_ms': 2000}, 'timeline_start_ms': 1000, 'fit': 'contain'}]}})
    with pytest.raises(ValueError, match='片段 broken 原媒体'):
        render_scene_cut(content, {'good': data, 'bad': data[:-200]}, export_profile('16:9', 720))
