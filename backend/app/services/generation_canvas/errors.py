"""画布领域诊断的统一 HTTP 边界。"""
from fastapi import HTTPException


def diagnostic(code: str, message: str, target: dict, *, status: int = 422) -> HTTPException:
    """所有画布领域错误提供稳定代号、结构定位与阻止动作。"""
    return HTTPException(status, detail={'code': code, 'severity': 'error', 'message': message,
                                        'target': target, 'blocks': ['save']})
