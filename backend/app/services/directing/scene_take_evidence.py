"""固定素材复核的共享比较与有界查询；调用方提供已鉴权快照。"""
from sqlalchemy import func, or_, select, tuple_
from app.services.directing.review_basis_key import review_basis_key

from app.core.contracts.directing.scene_timeline import SceneTimeline
from app.models.directing import SceneCopyOrigin, SceneTakeReviewRecord


def take_review_matches(fixed, current, take_kind, take_id):
    """保持原复核语义：忽略剪辑，仅保留所审素材的当前判断。"""
    current = current.model_copy(update={'take_judgments': [item for item in current.take_judgments
        if (item.take_kind, item.take_id) == (take_kind, take_id)], 'timeline': SceneTimeline()})
    return fixed.model_copy(update={'timeline': SceneTimeline()}) == current


def take_review_basis_key(content, take_kind=None, take_id=None):
    """固定内容仅有一个判断；当前内容按指定复合身份过滤，忽略剪辑。"""
    judgments = content.take_judgments if take_kind is None else [item for item in content.take_judgments
        if (item.take_kind, item.take_id) == (take_kind, take_id)]
    return review_basis_key(content.model_copy(update={'timeline': SceneTimeline(), 'take_judgments': judgments}).model_dump(mode='json'))


async def latest_take_reviews(db, version_id, current):
    """索引先选每个素材的最新及最近适用记录，至多展开两份固定正文。"""
    origin = await db.get(SceneCopyOrigin, version_id)
    inherited = origin.review_ids.get('take', []) if origin else []
    scope = or_(SceneTakeReviewRecord.version_id == version_id, SceneTakeReviewRecord.id.in_(inherited))
    identities = (await db.execute(select(SceneTakeReviewRecord.take_kind, SceneTakeReviewRecord.take_id).where(scope).distinct())).all()
    if not identities:
        return {}
    keys = [(kind, take_id, take_review_basis_key(current, kind, take_id)) for kind, take_id in identities]
    order = (SceneTakeReviewRecord.created_at.desc(), SceneTakeReviewRecord.id.desc())
    latest = select(SceneTakeReviewRecord.id, func.row_number().over(
        partition_by=(SceneTakeReviewRecord.take_kind, SceneTakeReviewRecord.take_id), order_by=order).label('rank')).where(scope).subquery()
    matching = select(SceneTakeReviewRecord.id, func.row_number().over(
        partition_by=(SceneTakeReviewRecord.take_kind, SceneTakeReviewRecord.take_id), order_by=order).label('rank')).where(scope,
            tuple_(SceneTakeReviewRecord.take_kind, SceneTakeReviewRecord.take_id, SceneTakeReviewRecord.basis_key).in_(keys)).subquery()
    rows = await db.scalars(select(SceneTakeReviewRecord).where(or_(
        SceneTakeReviewRecord.id.in_(select(latest.c.id).where(latest.c.rank == 1)),
        SceneTakeReviewRecord.id.in_(select(matching.c.id).where(matching.c.rank == 1)))).order_by(*order))
    expected = {(kind, take_id): key for kind, take_id, key in keys}
    result = {}
    for row in rows:
        key = (row.take_kind, row.take_id)
        result.setdefault(key, []).append((row, row.basis_key == expected[key]))
    return result
