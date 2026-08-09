"""导入响应模型（schemas 层）。

导入结果的传输结构就是 application 层的 ``ImportResult``；此处 re-export 以保持
「api 依赖 schemas」的分层习惯，避免重复定义模型。
"""

from __future__ import annotations

from app.crypto_animal_studio.application.import_result import ImportCounts, ImportResult

# API 语义别名（响应 data 即 ImportResult）。
ImportEpisodeResponse = ImportResult

__all__ = ["ImportEpisodeResponse", "ImportResult", "ImportCounts"]
