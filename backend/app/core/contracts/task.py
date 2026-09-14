"""任务生命周期共享契约，不包含供应商或执行恢复实现。"""

from enum import Enum


class TaskStatus(str, Enum):
    """本地任务唯一主状态；终态不允许重新进入执行。"""

    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


TERMINAL_TASK_STATUSES = frozenset({TaskStatus.succeeded, TaskStatus.failed, TaskStatus.cancelled})


class TaskExecutionMode(str, Enum):
    """区分请求内执行与受理后可继续查询的供应商任务。"""

    direct = "direct"
    remote = "remote"
