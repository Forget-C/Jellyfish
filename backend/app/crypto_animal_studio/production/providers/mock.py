"""确定性 Mock 供应商。

用途：在不接入任何真实 AI/FFmpeg 服务的前提下，跑通端到端生产流水线。
Mock 供应商会**真实写文件**（不是仅返回内存成功），且内容确定：相同输入 → 相同字节。

测试可通过 ``fail_on_sequence`` 强制某个镜头失败，以验证失败与重试语义。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.crypto_animal_studio.production.providers.base import (
    Composer,
    GeneratedArtifact,
    ImageProvider,
    VideoProvider,
    VoiceProvider,
)


class MockProviderFailure(RuntimeError):
    """Mock 供应商的受控失败（用于验证失败/重试路径）。"""


def _write(target_path: Path, lines: list[str]) -> None:
    """确定性写入文本文件（LF 换行，UTF-8，不含时间戳等易变内容）。"""
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


class MockImageProvider(ImageProvider):
    """确定性图像 Mock：写出 image.txt。"""

    name = "mock-image"
    model = "mock-image-v0"

    def __init__(self, *, fail_on_sequence: int | None = None) -> None:
        """``fail_on_sequence`` 指定时，对该镜头抛出受控失败。"""
        self._fail_on_sequence = fail_on_sequence

    def generate_image(self, *, target_path: Path, prompt: str, negative_prompt: str, context: dict[str, Any]) -> GeneratedArtifact:
        """生成确定性的图像占位产物。"""
        if self._fail_on_sequence is not None and context.get("sequence") == self._fail_on_sequence:
            raise MockProviderFailure(f"mock image failure at sequence {self._fail_on_sequence}")
        _write(target_path, [f"provider={self.name}", f"model={self.model}", f"shot={context.get('shot_id', '')}", f"prompt={prompt}", f"negative_prompt={negative_prompt}"])
        return GeneratedArtifact(file_path=target_path, mime_type="text/plain", provider=self.name, provider_model=self.model, metadata={"kind": "image"})


class MockVideoProvider(VideoProvider):
    """确定性视频 Mock：写出 video.txt。"""

    name = "mock-video"
    model = "mock-video-v0"

    def __init__(self, *, fail_on_sequence: int | None = None) -> None:
        """``fail_on_sequence`` 指定时，对该镜头抛出受控失败。"""
        self._fail_on_sequence = fail_on_sequence

    def generate_video(self, *, target_path: Path, prompt: str, context: dict[str, Any]) -> GeneratedArtifact:
        """生成确定性的视频占位产物。"""
        if self._fail_on_sequence is not None and context.get("sequence") == self._fail_on_sequence:
            raise MockProviderFailure(f"mock video failure at sequence {self._fail_on_sequence}")
        _write(target_path, [f"provider={self.name}", f"model={self.model}", f"shot={context.get('shot_id', '')}", f"duration_seconds={context.get('duration_seconds', 0)}", f"prompt={prompt}"])
        return GeneratedArtifact(file_path=target_path, mime_type="text/plain", provider=self.name, provider_model=self.model, metadata={"kind": "video"})


class MockVoiceProvider(VoiceProvider):
    """确定性语音 Mock：写出 voice.txt。"""

    name = "mock-voice"
    model = "mock-voice-v0"

    def __init__(self, *, fail_on_sequence: int | None = None) -> None:
        """``fail_on_sequence`` 指定时，对该镜头抛出受控失败。"""
        self._fail_on_sequence = fail_on_sequence

    def generate_voice(self, *, target_path: Path, text: str, context: dict[str, Any]) -> GeneratedArtifact:
        """生成确定性的语音占位产物。"""
        if self._fail_on_sequence is not None and context.get("sequence") == self._fail_on_sequence:
            raise MockProviderFailure(f"mock voice failure at sequence {self._fail_on_sequence}")
        _write(target_path, [f"provider={self.name}", f"model={self.model}", f"shot={context.get('shot_id', '')}", "text:", text])
        return GeneratedArtifact(file_path=target_path, mime_type="text/plain", provider=self.name, provider_model=self.model, metadata={"kind": "voice"})


class MockComposer(Composer):
    """确定性成片 Mock：写出 final_video.txt。"""

    name = "mock-composer"
    model = "mock-composer-v0"

    def __init__(self, *, fail: bool = False) -> None:
        """``fail=True`` 时抛出受控失败（用于验证 composition 阶段失败）。"""
        self._fail = fail

    def compose(self, *, target_path: Path, shot_inputs: list[dict[str, Any]], context: dict[str, Any]) -> GeneratedArtifact:
        """把各镜头产物"合成"为确定性的成片占位文件。"""
        if self._fail:
            raise MockProviderFailure("mock composer failure")
        lines = [f"provider={self.name}", f"model={self.model}", f"episode={context.get('episode_id', '')}", f"shot_count={len(shot_inputs)}"]
        for item in shot_inputs:
            lines.append(f"shot {item['sequence']}:{item['shot_id']} video={item.get('video', '')} voice={item.get('voice', '')}")
        _write(target_path, lines)
        return GeneratedArtifact(file_path=target_path, mime_type="text/plain", provider=self.name, provider_model=self.model, metadata={"kind": "final_video"})


def build_mock_bundle(**kwargs: Any):
    """构造一套 Mock 供应商集合（默认全部成功）。"""
    from app.crypto_animal_studio.production.providers.base import ProviderBundle

    return ProviderBundle(
        image=MockImageProvider(fail_on_sequence=kwargs.get("image_fail_on_sequence")),
        video=MockVideoProvider(fail_on_sequence=kwargs.get("video_fail_on_sequence")),
        voice=MockVoiceProvider(fail_on_sequence=kwargs.get("voice_fail_on_sequence")),
        composer=MockComposer(fail=bool(kwargs.get("composer_fail"))),
    )


__all__ = ["MockImageProvider", "MockVideoProvider", "MockVoiceProvider", "MockComposer", "MockProviderFailure", "build_mock_bundle"]
