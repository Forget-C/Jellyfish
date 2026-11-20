"""旧迁移使用的整场验收依据。"""
from app.services.directing.review_basis_key import review_basis_key


def scene_cut_review_basis(content):
    """核对画面、创作依据和覆盖；无关生成参数或指令正文不使画面结论失效。"""
    basis = content.model_dump(mode='json')
    basis['units'] = sorted([{'id': unit.id, 'coverage': [item.model_dump(mode='json') for item in unit.coverage]}
        for unit in content.units], key=lambda unit: unit['id'])
    basis['timeline']['items'].sort(key=lambda item: (item['timeline_start_ms'], item['id']))
    adopted = {(item.take_kind, item.take_id) for item in content.timeline.items if item.kind == 'media'}
    basis['take_judgments'] = sorted([item for item in basis['take_judgments']
        if (item['take_kind'], item['take_id']) in adopted], key=lambda item: (item['take_kind'], item['take_id']))
    return basis


def cut_review_basis_key(content):
    """索引与原画面验收依据共用规范化入口。"""
    return review_basis_key(scene_cut_review_basis(content))
