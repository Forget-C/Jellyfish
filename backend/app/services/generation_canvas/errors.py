"""画布领域诊断的统一 HTTP 边界。"""
from fastapi import HTTPException


class CanvasDomainError(HTTPException):
    """需要在统一响应 data 中保留结构化定位的画布领域失败。"""


def diagnostic(code: str, message: str, target: dict, *, status: int = 422,
               blocks: list[str] | None = None) -> CanvasDomainError:
    """所有画布领域错误提供稳定代号、结构定位与阻止动作。"""
    return CanvasDomainError(status, detail={'code': code, 'severity': 'error', 'message': message,
                                        'target': target, 'blocks': blocks if blocks is not None else ['save']})

