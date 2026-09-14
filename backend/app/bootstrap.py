"""应用级供应商能力注册；任务执行不再使用旧 TaskManager 适配器注册表。"""

from __future__ import annotations


def bootstrap_all_registries() -> None:
    """幂等注册供应商能力，API 与独立 Worker 共用相同能力定义。"""
    from app.services.llm.provider_bootstrap import bootstrap_builtin_providers

    bootstrap_builtin_providers()
