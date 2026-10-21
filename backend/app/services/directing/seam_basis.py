"""接缝依据和底层审查查询；不读取版本或媒体。"""
from sqlalchemy import or_, select

from app.models.directing import SceneSeamReviewRecord


def seam_review_query(version_id, inherited):
    """仅包含当前版本和另存时明确保留的审查身份。"""
    return select(SceneSeamReviewRecord).where(or_(
        SceneSeamReviewRecord.version_id == version_id, SceneSeamReviewRecord.id.in_(inherited))).order_by(
            SceneSeamReviewRecord.created_at, SceneSeamReviewRecord.id)


def scene_seam_bases(content):
    """一次排序保留直接相接的真实采用；绝对位置不进入比较依据。"""
    items = sorted(content.timeline.items, key=lambda item: (item.timeline_start_ms, item.id))
    return {(left.id, right.id): {'output_aspect_ratio': content.output_aspect_ratio,
        'left': left.model_dump(mode='json', exclude={'timeline_start_ms'}),
        'right': right.model_dump(mode='json', exclude={'timeline_start_ms'})}
        for left, right in zip(items, items[1:])
        if left.kind == right.kind == 'media' and left.timeline_start_ms +
        left.media_range.source_out_ms - left.media_range.source_in_ms == right.timeline_start_ms}


def scene_seam_basis(content, left_id, right_id):
    """替换、区间、构图或相接关系变化使原结论待复核，整体平移仍适用。"""
    return scene_seam_bases(content).get((left_id, right_id))
