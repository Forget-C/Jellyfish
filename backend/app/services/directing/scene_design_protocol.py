"""给模型补充 JSON Schema 未表达的设计规则；实际接收仍由业务契约校验。"""

import json

from app.core.contracts.directing.design_applicability import BACKGROUND_FIELDS, CONSTRAINT_FIELDS, SUBJECT_FIELDS


SUBJECT_PATHS = {
    'direction': ['direction'], 'performance': ['performance'], 'staging': ['staging'],
    'sound': ['sound'], 'prompt': ['prompt'],
    'beat': ['direction', 'beats'], 'shot': ['direction', 'shots'],
    'immutable_fact': ['direction', 'immutable_facts'], 'anchor': ['direction', 'anchors'],
    'blocking': ['direction', 'blocking_states'], 'event': ['events'], 'criterion': ['criteria'],
    'situation': ['performance', 'situations'], 'performance_beat': ['performance', 'beats'],
    'staging_activity': ['staging', 'activities'], 'camera': ['cinematography'],
    'continuity': ['continuity'], 'dialogue': ['sound', 'dialogues'],
}
SINGLE_SUBJECTS = {'direction', 'performance', 'staging', 'sound', 'prompt'}


def scene_design_protocol() -> dict:
    """字段与用途清单复用校验常量，路径用于区分整张工作单与独立行身份。"""
    return {
        'purposes': {
            'background': {'phases': [None], 'condition_allowed': False,
                           'scopes': ['scene', 'shots', 'occurrences']},
            'design': {'phases': [None], 'condition_allowed': False, 'scopes': ['shots', 'occurrences']},
            'constraint': {'phases': ['video', 'sound', 'postproduction'], 'condition_allowed': True,
                           'scopes': ['scene_rule', 'shots', 'occurrences']},
        },
        'global_scope_kinds': {
            'scene': ['direction', 'performance', 'staging', 'prompt', 'sound', 'situation', 'anchor'],
            'scene_rule': ['direction', 'immutable_fact', 'performance', 'prompt', 'sound'],
        },
        'subjects': {kind: {'path': SUBJECT_PATHS[kind], 'id_required': kind not in SINGLE_SUBJECTS,
                           'fields': sorted(fields),
                           'background_fields': sorted(BACKGROUND_FIELDS.get(kind, set())),
                           'constraint_fields': sorted(CONSTRAINT_FIELDS.get(kind, set()))}
                     for kind, fields in SUBJECT_FIELDS.items()},
    }


def scene_design_repair_context(text: str) -> dict:
    """从尚未通过校验的正文提供纠错选项，不修正、采纳或反序列化为有效设计。

    行级结构错误会遮住整份工作单的引用检查，因此同时提供全部适用项的合法
    字段类别和原对象身份；这里只读取字典，损坏的 JSON/字段留给原校验错误报告。
    """
    try:
        output = json.loads(text)
    except ValueError:
        return {}
    if not isinstance(output, dict):
        return {}
    protocol = scene_design_protocol()
    subjects = {}
    for kind, rule in protocol['subjects'].items():
        rows = output
        for name in rule['path']:
            rows = rows.get(name) if isinstance(rows, dict) else None
        if not rule['id_required'] or not isinstance(rows, list):
            continue
        subjects[kind] = {'ids': [], 'missing_id_paths': [], 'relations': []}
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            identity = row.get('id')
            if isinstance(identity, str) and identity.strip():
                subjects[kind]['ids'].append(identity)
            else:
                subjects[kind]['missing_id_paths'].append([*rule['path'], index])
            subjects[kind]['relations'].append({key: row[key] for key in ('id', 'shot_id', 'beat_id')
                                                if isinstance(row.get(key), str)})
    review = []
    rows = output.get('applicability')
    for index, row in enumerate(rows if isinstance(rows, list) else []):
        if not isinstance(row, dict) or not isinstance(row.get('subject'), dict):
            continue
        subject = row['subject']
        kind, name, purpose = subject.get('kind'), subject.get('field'), row.get('purpose')
        if not all(isinstance(value, str) for value in (kind, name, purpose)):
            continue
        rule = protocol['subjects'].get(kind, {})
        purposes = ['design'] if name in rule.get('fields', []) else []
        purposes += [value for value in ('background', 'constraint') if name in rule.get(value + '_fields', [])]
        purpose_rule = protocol['purposes'].get(purpose, {})
        review.append({'path': ['applicability', index], 'subject': subject,
            'field_kinds': [key for key, value in protocol['subjects'].items() if name in value['fields']],
            'allowed_purposes': purposes,
            'allowed_phases': purpose_rule.get('phases', []),
            'condition_allowed': purpose_rule.get('condition_allowed', False),
            'allowed_scopes': [scope for scope in purpose_rule.get('scopes', [])
                               if purpose in purposes and (scope not in protocol['global_scope_kinds']
                                   or kind in protocol['global_scope_kinds'][scope])]})
    return {'subjects': subjects, 'applicability': review}
