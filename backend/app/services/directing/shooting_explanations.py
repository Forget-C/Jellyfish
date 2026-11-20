"""Read and select chapter shooting explanations independently of scene revisions."""
from hashlib import sha256

from sqlalchemy import select

from app.core.contracts.directing.shooting_preparation import ShootingPreparation, ShootingScope
from app.models.directing import ChapterShootingExplanation, DivisionHead, DivisionVersion
from app.services.directing.store import RevisionConflict


async def source_text(db, chapter, source_version):
    """Resolve actual chapter text, including immutable historical division sources."""
    if sha256(chapter.raw_text.encode()).hexdigest() == source_version:
        return chapter.raw_text
    record = await db.get(ChapterShootingExplanation, (chapter.id, source_version))
    if record is not None:
        return record.raw_text
    version = await db.scalar(select(DivisionVersion).where(DivisionVersion.chapter_id == chapter.id,
        DivisionVersion.source_version == source_version).order_by(DivisionVersion.number.desc()).limit(1))
    if version is None:
        raise RevisionConflict('章节原文依据已变化，请重新选择原文版本')
    return version.snapshot['raw_text']


def unique_range(text, excerpt):
    """Resolve a literal quote only if it appears exactly once."""
    start = text.find(excerpt)
    if not excerpt or start < 0 or text.find(excerpt, start + 1) >= 0:
        return None
    return ShootingScope(start=start, end=start + len(excerpt))


async def inherited_preparation(db, chapter_id, source_version, text, *, locked=False):
    """Project unsaved inheritance from the source used by the current division."""
    def current(query):
        return query.with_for_update() if locked else query

    known_version = await db.scalar(current(select(DivisionVersion.id).where(
        DivisionVersion.chapter_id == chapter_id, DivisionVersion.source_version == source_version).limit(1)))
    if known_version:
        return ShootingPreparation()
    previous_version = await db.scalar(current(select(DivisionVersion.source_version).join(
        DivisionHead, DivisionHead.revision_id == DivisionVersion.id).where(DivisionHead.chapter_id == chapter_id)))
    if previous_version is None:
        previous_version = await db.scalar(current(select(ChapterShootingExplanation.source_version).where(
            ChapterShootingExplanation.chapter_id == chapter_id).order_by(
                ChapterShootingExplanation.created_at.desc(), ChapterShootingExplanation.source_version).limit(1)))
    if not previous_version or previous_version == source_version:
        return ShootingPreparation()
    prior = await db.get(ChapterShootingExplanation, (chapter_id, previous_version),
                         with_for_update=locked, populate_existing=True)
    if prior is None:
        return ShootingPreparation()
    notes = ShootingPreparation.model_validate(prior.preparation).notes
    for note in notes:
        if note.scope:
            scope_text = prior.raw_text[note.scope.start:note.scope.end]
            note.scope = unique_range(text, scope_text)
            if note.scope is None:
                note.previous_scope_text = scope_text
        if note.scope is None or (note.excerpt and (
                unique_range(prior.raw_text, note.excerpt) is None or unique_range(text, note.excerpt) is None)):
            note.choice = 'review'
    return ShootingPreparation(notes=notes)


async def scene_shooting_notes(db, sequence):
    """Select adopted whole-chapter and overlapping local explanations."""
    if sequence.source.get('kind') != 'chapter' or sequence.source.get('reference') != sequence.chapter_id:
        return []
    record = await db.get(ChapterShootingExplanation, (sequence.chapter_id, sequence.source.get('version')),
                          populate_existing=True)
    if record is None:
        return []
    return [note.model_dump(mode='json') for note in ShootingPreparation.model_validate(record.preparation).notes
            if note.choice in ('adopt', 'delegate') and (note.scope is None or (
                sequence.source_start is not None and sequence.source_end is not None
                and note.scope.start < sequence.source_end and sequence.source_start < note.scope.end))]
