"""任务失败时保留的结构化诊断。"""

from app.core.contracts.directing.common import Contract


class DirectingOutputDiagnostics(Contract):
    """失败输出仅供核对，不属于可应用的结果。"""

    output: str
    issues: list[str]
