"""身份主体的新输入约束和存量原始分组分类；固定历史不应用新约束。"""
from collections import defaultdict


def is_identity_subject(binding):
    """仅身份用途的主体位置属于本规则，帧和其他用途保持原语义。"""
    return binding.purpose == 'identity' and binding.input_role == 'subject'


def source_key(binding):
    """资产名称是快照；人工文件与上传属于同一人工来源类型。"""
    return (binding.asset_origin.kind, binding.asset_origin.id) if binding.asset_origin else None


def identity_classification(references, participant_ids):
    """按执行器真实分组先分类完整原始输入，返回非法组和需裁剪的对象。"""
    groups = defaultdict(list)
    for binding in references:
        if is_identity_subject(binding):
            groups[binding.subject_group_id or binding.id].append(binding)
    invalid = set()
    owners = defaultdict(list)
    for key, group in groups.items():
        assignments = {tuple(binding.participant_ids) for binding in group}
        for binding in group:
            for owner in binding.participant_ids:
                owners[owner].append(binding)
        if (len(assignments) != 1 or len(group[0].participant_ids) != 1
                or group[0].participant_ids[0] not in participant_ids):
            invalid.add(key)
    conflicts = {owner for owner, bindings in owners.items()
                 if len({binding.subject_group_id or binding.id for binding in bindings}) > 1
                 or len({source_key(binding) for binding in bindings}) > 1}
    return groups, invalid, conflicts


def validate_identity_references(units, participant_ids):
    """新提交明确拒绝非法主体；绝不将请求输入作为存量裁剪。"""
    for unit in units:
        _, invalid, conflicts = identity_classification(unit.references, participant_ids)
        if invalid:
            raise ValueError('身份主体组必须恰好对应一个存在的人物或物件')
        if conflicts:
            raise ValueError('同一人物或物件只能使用一个身份主体组及单一素材来源，请更换整组来源')
