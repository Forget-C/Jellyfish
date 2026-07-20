"""对象存储连接配置测试。"""

from app.config import settings
from app.core.storage import _resolve_s3_addressing_style


def test_local_s3_endpoint_uses_path_addressing(monkeypatch) -> None:
    """本地 MinIO 不依赖 bucket 子域名，自动模式应使用 path 寻址。"""
    monkeypatch.setattr(settings, "s3_addressing_style", "auto")
    monkeypatch.setattr(settings, "s3_endpoint_url", "http://127.0.0.1:9000")

    assert _resolve_s3_addressing_style() == "path"


def test_explicit_s3_addressing_style_overrides_auto_detection(monkeypatch) -> None:
    """供应商已知寻址要求时，显式配置必须优先于 endpoint 推断。"""
    monkeypatch.setattr(settings, "s3_addressing_style", "virtual")
    monkeypatch.setattr(settings, "s3_endpoint_url", "http://127.0.0.1:9000")

    assert _resolve_s3_addressing_style() == "virtual"
