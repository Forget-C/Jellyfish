"""生成完成与应用预览共用的场次设计来源边界。"""
import json


class DesignSourceError(ValueError):
    """新增模型内容没有声明本次真实任务来源。"""


def validate_model_sources(original, proposed, task_identity):
    """保留原有 Note 来源，新生成的事实或提议必须指向本次真实模型任务。"""
    def notes(value):
        if isinstance(value, dict):
            if value.get('state') in {'fact', 'proposal'} and 'text' in value:
                yield value
            for child in value.values():
                yield from notes(child)
        elif isinstance(value, list):
            for child in value:
                yield from notes(child)
    known = {json.dumps(note, sort_keys=True) for note in notes(original.model_dump(mode='json'))}
    for note in notes(proposed.model_dump(mode='json')):
        if json.dumps(note, sort_keys=True) not in known and not any(
                source.get('kind') == 'model' and source.get('reference') == task_identity
                and source.get('version') == '1' for source in note.get('sources', [])):
            raise DesignSourceError('结果来源校验未通过：新增内容缺少本次模型任务来源，请重新生成')
