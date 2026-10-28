"""导演设计共同范围与来源的提交文本格式。"""
from app.core.contracts.generation_canvas import DesignScope


def scope_source_lines(scope: DesignScope, source_locator: str) -> list[str]:
    """保持固定标签和顺序，未填写的范围与来源不生成要求。"""
    return [f'{label}：{value}' for label, value in [
        ('适用范围', scope.description), ('制作阶段', scope.phase),
        ('适用条件', scope.condition), ('来源', source_locator),
    ] if value]
