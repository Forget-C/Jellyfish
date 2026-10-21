"""固定整场验收的共享比较与快照查询；不读取完整版本。"""
from sqlalchemy import or_, select
from app.models.directing import SceneCutReviewRecord


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


def cut_review_query(version_id, inherited):
    """只消费当前版本与明确复制的记录，不追随源版本后来记录。"""
    return select(SceneCutReviewRecord).where(or_(SceneCutReviewRecord.version_id == version_id,
        SceneCutReviewRecord.id.in_(inherited))).order_by(SceneCutReviewRecord.created_at.desc(), SceneCutReviewRecord.id.desc())


def scene_frame_basis(clip):
    """原素材落幅不受时间线位置或输出构图影响，身份和源区间必须相同。"""
    if clip is None or clip.kind != 'media':
        return None
    return clip.model_dump(mode='json', exclude={'timeline_start_ms', 'fit'})
