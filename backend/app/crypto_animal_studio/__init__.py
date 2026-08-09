"""Crypto Animal Studio (CAS) bounded module.

用途：
- 作为 Creative OS(CAS) 与 Jellyfish 之间的**受限边界模块**（bounded context）。
- 本 Sprint（Sprint 2 · CAS Foundation）只建立契约与最小健康端点，
  **不做**数据库落地、Chapter/Shot 导入、Celery、LLM 调用或前端 UI。

分层职责：
- ``schemas``：对外传输 / 校验用的 Pydantic 模型（EpisodePackage v1）。
- ``domain``：常量、枚举、领域辅助函数（不依赖 FastAPI，不重复定义 schemas 模型）。
- ``api``：轻量路由层（薄），仅收参并返回 Jellyfish 统一的 ``ApiResponse`` 壳。
- ``application`` / ``agents`` / ``integrations``：占位分层，后续 Sprint 逐步落地。
"""

from app.crypto_animal_studio.domain.episode_package import SCHEMA_VERSION

__all__ = ["SCHEMA_VERSION"]
