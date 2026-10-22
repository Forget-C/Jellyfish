"""接缝依据和底层审查查询；不读取版本或媒体。"""
from sqlalchemy import func, or_, select, tuple_

from app.models.directing import SceneSeamReviewRecord
from app.services.directing.review_basis_key import review_basis_key


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


def seam_review_basis_key(content, left_id, right_id):
    """只索引原接缝两侧的固定依据；整体平移与无关片段不改变适用性。"""
    basis = scene_seam_basis(content, left_id, right_id)
    if basis is None:
        raise ValueError('固定接缝依据无效，请核对原记录')
    return review_basis_key(basis)


async def latest_seam_reviews(db, version_id, inherited, bases):
    """数据库预选每个当前接缝最新和最近适用记录；不展开任何历史时间线。"""
    if not bases:
        return []
    left = SceneSeamReviewRecord.review['left_clip_id'].as_string()
    right = SceneSeamReviewRecord.review['right_clip_id'].as_string()
    scope = (or_(SceneSeamReviewRecord.version_id == version_id, SceneSeamReviewRecord.id.in_(inherited)),
        tuple_(left, right).in_(list(bases)))
    order = (SceneSeamReviewRecord.created_at.desc(), SceneSeamReviewRecord.id.desc())
    candidates = select(SceneSeamReviewRecord.id, SceneSeamReviewRecord.basis_key,
        SceneSeamReviewRecord.created_at, left.label('left_id'), right.label('right_id')).where(*scope).cte()
    ranked_order = (candidates.c.created_at.desc(), candidates.c.id.desc())
    latest = select(candidates.c.id, func.row_number().over(
        partition_by=(candidates.c.left_id, candidates.c.right_id), order_by=ranked_order).label('rank')).subquery()
    matching = select(candidates.c.id, func.row_number().over(
        partition_by=(candidates.c.left_id, candidates.c.right_id), order_by=ranked_order).label('rank')).where(
            candidates.c.basis_key.in_([review_basis_key(basis) for basis in bases.values()])).subquery()
    return (await db.execute(select(SceneSeamReviewRecord.id, SceneSeamReviewRecord.version_id,
        SceneSeamReviewRecord.review, SceneSeamReviewRecord.basis_key).where(or_(
            SceneSeamReviewRecord.id.in_(select(latest.c.id).where(latest.c.rank == 1)),
            SceneSeamReviewRecord.id.in_(select(matching.c.id).where(matching.c.rank == 1)))).order_by(*order))).all()
