"""ArtifactManager：产物路径、校验和与登记的唯一归口。

职责：
- **集中构造输出路径**（供应商不得自行编造路径）；
- 安全创建目录；
- 计算校验和（SHA-256）；
- 登记产物到数据库；
- 校验既有产物（DB 行 + 文件存在 + 校验和一致）；
- 重试时复用仍然有效的既有产物。

路径约定（相对存储根）::

    cas/productions/{project_id}/{episode_id}/{job_id}/
        manifest.json
        shots/{sequence}-{shot_id}/{prompt.json,image/,video/,voice/,subtitle/}
        final/final_video.txt

数据库中保存**相对路径**（POSIX 风格），便于跨平台（含 Windows）迁移与比对。
"""

from __future__ import annotations

import hashlib
import os
import re
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto_animal_studio.production.enums import ArtifactType, Stage
from app.crypto_animal_studio.production.models import CasProductionArtifact, CasProductionJob, CasProductionShot
from app.services.common import create_and_refresh

#: 存储根目录环境变量；未设置时回落到仓库根 ``storage/``。
STORAGE_ROOT_ENV = "CAS_STORAGE_ROOT"
_BACKEND_ROOT = Path(__file__).resolve().parents[4]  # .../backend
_DEFAULT_STORAGE_ROOT = _BACKEND_ROOT.parent / "storage"

_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9._-]+")


def default_storage_root() -> Path:
    """返回默认存储根（可用 ``CAS_STORAGE_ROOT`` 覆盖）。"""
    configured = os.environ.get(STORAGE_ROOT_ENV, "").strip()
    return Path(configured) if configured else _DEFAULT_STORAGE_ROOT


def sanitize_segment(value: str) -> str:
    """把任意标识清洗为安全的单层路径片段（防路径穿越/非法字符）。"""
    cleaned = _SAFE_SEGMENT.sub("-", (value or "").strip()).strip("-._")
    return cleaned or "unnamed"


def file_checksum(path: Path) -> str:
    """计算文件的 SHA-256 十六进制摘要。"""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ArtifactManager:
    """一次生产运行的产物管理器。"""

    def __init__(self, db: AsyncSession, job: CasProductionJob, *, storage_root: Path | None = None) -> None:
        """绑定会话与任务，并解析存储根。"""
        self._db = db
        self._job = job
        self.storage_root = Path(storage_root) if storage_root else default_storage_root()

    # --- 路径构造 ---------------------------------------------------- #
    @property
    def job_relpath(self) -> str:
        """任务输出根（相对存储根，POSIX 风格）。"""
        return "/".join(
            [
                "cas",
                "productions",
                sanitize_segment(self._job.project_id),
                sanitize_segment(self._job.episode_id),
                sanitize_segment(self._job.id),
            ]
        )

    @property
    def job_dir(self) -> Path:
        """任务输出根的绝对路径。"""
        return self.storage_root / Path(self.job_relpath)

    def shot_relpath(self, sequence: int, shot_id: str) -> str:
        """镜头目录（相对存储根）。"""
        return f"{self.job_relpath}/shots/{int(sequence)}-{sanitize_segment(shot_id)}"

    def artifact_relpath(self, artifact_type: ArtifactType, *, sequence: int | None = None, shot_id: str | None = None) -> str:
        """按产物类型返回其相对路径（唯一归口，供应商不得自造）。"""
        if artifact_type is ArtifactType.manifest:
            return f"{self.job_relpath}/manifest.json"
        if artifact_type is ArtifactType.final_video:
            return f"{self.job_relpath}/final/final_video.txt"
        if sequence is None or shot_id is None:
            raise ValueError(f"artifact type {artifact_type.value} requires sequence and shot_id")
        base = self.shot_relpath(sequence, shot_id)
        if artifact_type is ArtifactType.prompt:
            return f"{base}/prompt.json"
        mapping = {
            ArtifactType.image: "image/image.txt",
            ArtifactType.video: "video/video.txt",
            ArtifactType.voice: "voice/voice.txt",
            ArtifactType.subtitle: "subtitle/subtitle.txt",
            ArtifactType.music: "music/music.txt",
            ArtifactType.log: "log/log.txt",
        }
        if artifact_type not in mapping:
            raise ValueError(f"unsupported artifact type: {artifact_type.value}")
        return f"{base}/{mapping[artifact_type]}"

    def abs_path(self, relpath: str) -> Path:
        """把相对路径解析为绝对路径。"""
        return self.storage_root / Path(relpath)

    def ensure_parent(self, relpath: str) -> Path:
        """确保目标文件的父目录存在，返回绝对路径。"""
        target = self.abs_path(relpath)
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    # --- 产物登记 / 校验 / 复用 ---------------------------------------- #
    async def find_existing(self, artifact_type: ArtifactType, *, production_shot_id: str | None = None) -> CasProductionArtifact | None:
        """查找该任务（可选镜头）下指定类型的既有产物记录。"""
        stmt = select(CasProductionArtifact).where(
            CasProductionArtifact.job_id == self._job.id,
            CasProductionArtifact.artifact_type == artifact_type.value,
        )
        stmt = stmt.where(
            CasProductionArtifact.production_shot_id == production_shot_id
            if production_shot_id is not None
            else CasProductionArtifact.production_shot_id.is_(None)
        )
        return (await self._db.execute(stmt)).scalars().first()

    def is_valid(self, artifact: CasProductionArtifact) -> bool:
        """产物是否仍然有效：文件存在且校验和一致。"""
        path = self.abs_path(artifact.file_path)
        if not path.is_file():
            return False
        if not artifact.checksum:
            return False
        return file_checksum(path) == artifact.checksum

    async def find_valid(self, artifact_type: ArtifactType, *, production_shot_id: str | None = None) -> CasProductionArtifact | None:
        """返回仍然有效的既有产物（用于重试复用），否则 None。"""
        existing = await self.find_existing(artifact_type, production_shot_id=production_shot_id)
        if existing is not None and self.is_valid(existing):
            return existing
        return None

    async def register(
        self,
        *,
        artifact_type: ArtifactType,
        stage: Stage,
        relpath: str,
        mime_type: str,
        provider: str = "",
        provider_model: str = "",
        production_shot_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> CasProductionArtifact:
        """登记（或就地更新）一条产物记录，并计算校验和。"""
        checksum = file_checksum(self.abs_path(relpath))
        existing = await self.find_existing(artifact_type, production_shot_id=production_shot_id)
        if existing is not None:
            existing.stage = stage.value
            existing.provider = provider
            existing.provider_model = provider_model
            existing.file_path = relpath
            existing.mime_type = mime_type
            existing.checksum = checksum
            existing.metadata_json = metadata or {}
            await self._db.flush()
            return existing
        artifact = CasProductionArtifact(
            id=str(uuid.uuid4()),
            job_id=self._job.id,
            production_shot_id=production_shot_id,
            artifact_type=artifact_type.value,
            stage=stage.value,
            provider=provider,
            provider_model=provider_model,
            file_path=relpath,
            mime_type=mime_type,
            checksum=checksum,
            metadata_json=metadata or {},
        )
        return await create_and_refresh(self._db, artifact)

    async def write_text_artifact(
        self,
        *,
        artifact_type: ArtifactType,
        stage: Stage,
        content: str,
        shot: CasProductionShot | None = None,
        mime_type: str = "text/plain",
        provider: str = "cas",
        provider_model: str = "deterministic-v0",
        metadata: dict[str, Any] | None = None,
    ) -> CasProductionArtifact:
        """由编排层直接写出的文本产物（如 prompt.json、字幕）并登记。"""
        relpath = self.artifact_relpath(
            artifact_type,
            sequence=shot.sequence if shot else None,
            shot_id=shot.source_shot_id if shot else None,
        )
        target = self.ensure_parent(relpath)
        target.write_text(content, encoding="utf-8", newline="\n")
        return await self.register(
            artifact_type=artifact_type,
            stage=stage,
            relpath=relpath,
            mime_type=mime_type,
            provider=provider,
            provider_model=provider_model,
            production_shot_id=shot.id if shot else None,
            metadata=metadata,
        )


__all__ = ["ArtifactManager", "default_storage_root", "file_checksum", "sanitize_segment", "STORAGE_ROOT_ENV"]
