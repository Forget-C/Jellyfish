"""生产供应商边界（adapters）。

核心编排代码只依赖这些抽象与 ``GeneratedArtifact``，**不得**出现具体供应商的
模型名、SDK 或 API 细节。真实供应商在后续冲刺以适配器形式接入。

约定：供应商**不自行编造文件路径**——目标路径由 ArtifactManager 计算后传入。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class GeneratedArtifact:
    """所有供应商的统一返回结果。"""

    file_path: Path
    mime_type: str
    provider: str
    provider_model: str
    metadata: dict[str, Any] = field(default_factory=dict)


class ImageProvider(ABC):
    """图像生成供应商边界。"""

    name: str = "base-image"
    model: str = "unknown"

    @abstractmethod
    def generate_image(self, *, target_path: Path, prompt: str, negative_prompt: str, context: dict[str, Any]) -> GeneratedArtifact:
        """在 ``target_path`` 生成一张图像产物并返回统一结果。"""
        raise NotImplementedError


class VideoProvider(ABC):
    """视频生成供应商边界。"""

    name: str = "base-video"
    model: str = "unknown"

    @abstractmethod
    def generate_video(self, *, target_path: Path, prompt: str, context: dict[str, Any]) -> GeneratedArtifact:
        """在 ``target_path`` 生成一段视频产物并返回统一结果。"""
        raise NotImplementedError


class VoiceProvider(ABC):
    """语音合成供应商边界。"""

    name: str = "base-voice"
    model: str = "unknown"

    @abstractmethod
    def generate_voice(self, *, target_path: Path, text: str, context: dict[str, Any]) -> GeneratedArtifact:
        """在 ``target_path`` 生成一段语音产物并返回统一结果。"""
        raise NotImplementedError


class Composer(ABC):
    """成片合成边界（后续可接 FFmpeg 等实现）。"""

    name: str = "base-composer"
    model: str = "unknown"

    @abstractmethod
    def compose(self, *, target_path: Path, shot_inputs: list[dict[str, Any]], context: dict[str, Any]) -> GeneratedArtifact:
        """把各镜头产物合成为最终成片并返回统一结果。"""
        raise NotImplementedError


@dataclass(slots=True)
class ProviderBundle:
    """一次生产运行所使用的供应商集合（便于注入与测试）。"""

    image: ImageProvider
    video: VideoProvider
    voice: VoiceProvider
    composer: Composer

    def describe(self) -> dict[str, dict[str, str]]:
        """返回用于 manifest 的供应商描述。"""
        return {
            "image": {"provider": self.image.name, "model": self.image.model},
            "video": {"provider": self.video.name, "model": self.video.model},
            "voice": {"provider": self.voice.name, "model": self.voice.model},
            "composer": {"provider": self.composer.name, "model": self.composer.model},
        }


__all__ = ["GeneratedArtifact", "ImageProvider", "VideoProvider", "VoiceProvider", "Composer", "ProviderBundle"]
