"""APIMart（api.apimart.ai）集成：视频异步任务 + 图片兼容层。

与内置两个供应商的协议差异（实测于 2026-09-17）：
  - 创建视频任务：POST {base_url}/videos/generations
      响应 `{"code":200,"data":[{"status":"submitted","task_id":"task_xxx"}]}`（data 是数组）
  - 查询任务：GET {base_url}/tasks/{task_id}
      响应 `{"code":200,"data":{"status":"processing|completed|failed|cancelled",
              "progress":50,...,"result":{"videos":[...]}}}`
  - 图片走 OpenAI 兼容路径 /images/generations，故 :mod:`app.core.integrations.apimart.images`
    直接委托 OpenAI 实现，仅在能力声明上独立。
"""

from .images import ApimartImageApiAdapter
from .video import ApimartVideoApiAdapter

__all__ = ["ApimartImageApiAdapter", "ApimartVideoApiAdapter"]
