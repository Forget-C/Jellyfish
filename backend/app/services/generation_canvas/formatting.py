"""导演设计共同范围与来源的提交文本格式。"""
from app.core.contracts.generation_canvas import DesignField, DesignScope


def scope_source_lines(scope: DesignScope, source_locator: str) -> list[str]:
    """保持固定标签和顺序，未填写的范围与来源不生成要求。"""
    return [f'{label}：{value}' for label, value in [
        ('适用范围', scope.description), ('制作阶段', scope.phase),
        ('适用条件', scope.condition), ('来源', source_locator),
    ] if value]


STATE_LABELS = {'absent': '明确没有', 'undecided': '待确定', 'proposal': '提议', 'fact': '事实'}
PURPOSE_LABELS = {'background': '背景', 'design': '设计', 'constraint': '约束'}


def design_field_line(label: str, field: DesignField, text: str | None = None, *, source: bool = True) -> str:
    """用户设定省略内部默认标签；提取和历史字段保留既有编译含义与格式。"""
    body = field.text if text is None else text
    if field.extraction_context:
        state = STATE_LABELS.get(field.state) or {'empty': '未填写', 'not_applicable': '不适用'}[field.state]
        return f'{PURPOSE_LABELS[field.purpose]} / {label} [{state}]：{body}' + (
            f'（来源：{field.source_locator}）' if source and field.source_locator else '')
    if field.authorship == 'user':
        return f'{label}：{body}'
    if field.authorship == 'model':
        metadata = field.metadata_fields or []
        purpose = PURPOSE_LABELS[field.purpose] + ' / ' if 'purpose' in metadata else ''
        state = f' [{STATE_LABELS[field.state]}]' if 'state' in metadata else ''
        return f'{purpose}{label}{state}：{body}' + (f'（来源：{field.source_locator}）' if 'source_locator' in metadata and field.source_locator else '')
    return f'{PURPOSE_LABELS[field.purpose]} / {label} [{STATE_LABELS[field.state]}]：{body}' + (
        f'（来源：{field.source_locator}）' if source and field.source_locator else '')
