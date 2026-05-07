"""阿里云相关出站适配（DashScope 等）。"""

from __future__ import annotations

from app.core.integrations.aliyun.dashscope_images import DashScopeImageApiAdapter
from app.core.integrations.aliyun.dashscope_videos import DashScopeVideoApiAdapter

__all__ = ["DashScopeImageApiAdapter", "DashScopeVideoApiAdapter"]
