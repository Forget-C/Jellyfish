"""分镜与导演任务共享的执行错误。"""

from app.core.contracts.directing.diagnostics import DirectingOutputDiagnostics


class DirectingOutputError(ValueError):
    """任务错误摘要可直接展示，技术诊断详情可展示对应阶段的模型响应。"""

    def __init__(self, message: str, diagnostics: DirectingOutputDiagnostics | None = None):
        """诊断保留失败响应，结构纠错另存恢复所需的草案与问题。"""
        super().__init__(message)
        self.diagnostics = diagnostics
        self.storyboard_structure: dict | None = None
