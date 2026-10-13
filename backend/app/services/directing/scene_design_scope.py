"""设计局部修订仅允许预先选定的已有 Note，身份、引用与结构不能隐式重写。"""


def note_fields(value, path=''):
    """枚举固定输入中的完整 Note 路径，不允许单独改来源或信息状态。"""
    if isinstance(value, dict):
        if 'state' in value and 'sources' in value:
            yield path
        else:
            for key, child in value.items():
                yield from note_fields(child, path + '/' + key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from note_fields(child, path + '/' + str(index))


def changed_paths(before, after, path=''):
    """将 Note 视为原子字段，结构或引用变化同样列为越界位置。"""
    if before == after:
        return []
    if isinstance(before, dict) and isinstance(after, dict) and 'state' not in before:
        return [change for key in before.keys() | after.keys()
                for change in changed_paths(before.get(key), after.get(key), path + '/' + key)]
    if isinstance(before, list) and isinstance(after, list) and len(before) == len(after):
        return [change for index, (old, new) in enumerate(zip(before, after))
                for change in changed_paths(old, new, path + '/' + str(index))]
    return [path or '/']


def validate_design_scope(scope, before, after=None):
    """空范围不代表整场；任何非白名单差异都会拒绝整份结果。"""
    if scope is None:
        return
    allowed = set(note_fields(before))
    if not scope or len(scope) != len(set(scope)) or any(path not in allowed for path in scope):
        raise ValueError('局部修订范围须选择已有完整内容字段，不能修改身份、引用或结构')
    if after is not None:
        outside = sorted(set(changed_paths(before, after)) - set(scope))
        if outside:
            raise ValueError('建议包含范围外修改，整次未应用：' + '、'.join(outside))
