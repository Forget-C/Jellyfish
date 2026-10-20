"""场次设计的模型来源校验与完整工作单内容遍历。"""
import json

from app.core.contracts.directing.common import Contract, Note, Source


class DesignSourceError(ValueError):
    """新增模型内容没有声明本次真实任务来源。"""


def design_note_fields(design) -> dict[tuple[str, ...], Note]:
    """遍历整份工作单的 Note，包含不参与范围投影的待确定问题。

    列表优先按稳定行 ID 定位，重排不等于删除；历史无身份行按原位置核对。
    返回原 Note 供正文与理由分别检查，不推断或改写其语义。
    """
    result = {}

    def visit(value, path):
        if isinstance(value, Note):
            result[path] = value
        elif isinstance(value, Contract):
            for name in type(value).model_fields:
                visit(getattr(value, name), (*path, name))
        elif isinstance(value, list):
            for index, row in enumerate(value):
                identity = getattr(row, 'id', None)
                key = f'[id:{identity}]' if identity is not None else f'[index:{index}]'
                visit(row, (*path, key))

    visit(design, ())
    return result


def _notes(value):
    """遍历设计中有正文的事实与提议。"""
    if isinstance(value, dict):
        if value.get('state') in {'fact', 'proposal'} and 'text' in value:
            yield value
        for child in value.values():
            yield from _notes(child)
    elif isinstance(value, list):
        for child in value:
            yield from _notes(child)


def validate_model_sources(original, proposed, task_identity):
    """保留原有 Note 来源，新生成的事实或提议必须指向本次真实模型任务。"""
    known = {json.dumps(note, sort_keys=True) for note in _notes(original.model_dump(mode='json'))}
    for note in _notes(proposed.model_dump(mode='json')):
        if json.dumps(note, sort_keys=True) not in known and not any(
                source.get('kind') == 'model' and source.get('reference') == task_identity
                and source.get('version') == '1' for source in note.get('sources', [])):
            raise DesignSourceError('结果来源校验未通过：新增内容缺少本次模型任务来源，请重新生成')


def record_chapter_generation_source(original, proposed, task_identity, chapter_source):
    """仅在生成边界补记真实任务；不改历史结果，不替换模型声明的其他来源。"""
    if not chapter_source:
        return proposed
    chapter = Source.model_validate(chapter_source).model_dump(mode='json')
    if chapter['kind'] != 'chapter':
        return proposed
    known = {json.dumps(note, sort_keys=True) for note in _notes(original.model_dump(mode='json'))}
    data = proposed.model_dump(mode='json')
    for note in _notes(data):
        if json.dumps(note, sort_keys=True) not in known and note['sources'] and all(
                source == chapter for source in note['sources']):
            note['sources'].append({'kind': 'model', 'reference': task_identity, 'version': '1'})
    return type(proposed).model_validate(data)
