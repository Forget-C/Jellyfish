"""整章最终快照、基本信息写入与回执共享原子事务。"""

from copy import deepcopy

import pytest
from sqlalchemy import event, func, select

from app.core.contracts.directing.division import DivisionSave
from app.core.contracts.directing.workspace import ChapterSequences, SequenceUpdate
from app.models.directing import DivisionCommit, DivisionHead, DivisionVersion
from app.services.directing.division import DivisionService
from app.services.directing.store import RevisionConflict
from tests.directing.test_division import setup_two, save
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_final_snapshot_single_edits_and_noop_keep_history(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            before = await service.list_sequences('ch1')
            assert before.current_version.number == 2
            original = await db.get(DivisionVersion, before.current_version.id)
            snapshot = deepcopy(original.snapshot)
            draft.members[0].title = '最终人工修改'
            saved, request = await save(service, draft)
            assert saved.chapter.current_version.number == 3
            version = await db.get(DivisionVersion, saved.chapter.current_version.id)
            assert version.snapshot['sequences'][0]['title'] == '最终人工修改'
            assert version.base_revision_id == original.id and version.origin == 'manual'
            assert (await service.division_receipt('ch1', request.request_id)).chapter.current_version.id == version.id
            assert version.mapping['lineage'] == [row.model_dump(mode='json') for row in draft.lineage]
            assert version.snapshot['task_ids'] == []
            assert original.snapshot == snapshot
            assert (await service.save_division('ch1', request)) == saved
            assert await db.scalar(select(func.count()).select_from(DivisionVersion)) == 3
            row = saved.chapter.sequences[0]
            body = SequenceUpdate(title=row.title, position=row.position, source_version=saved.chapter.source_version, expected_version=row.version)
            assert await service.write_sequence('ch1', body, row.id) == row
            assert await db.scalar(select(func.count()).select_from(DivisionVersion)) == 3
            with pytest.raises(RevisionConflict):
                await service.write_sequence('ch1', body.model_copy(update={'expected_version': row.version - 1}), row.id)
            changed = await service.write_sequence('ch1', body.model_copy(update={'title': '详情改名', 'position': 1}), row.id)
            latest = await service.list_sequences('ch1')
            assert latest.current_version.number == 4
            current = await db.get(DivisionVersion, latest.current_version.id)
            assert ChapterSequences.model_validate(current.snapshot).sequences == latest.sequences
            assert changed.source == row.source
            assert current.snapshot['sequences'][1]['title'] == '详情改名'
            assert original.snapshot == snapshot and version.snapshot['sequences'][0]['title'] == '最终人工修改'


@pytest.mark.asyncio
@pytest.mark.parametrize('statement_prefix', ['INSERT INTO directing_division_versions', 'UPDATE directing_division_heads', 'INSERT INTO directing_division_commits'])
async def test_version_head_or_receipt_failure_rolls_back_all(tmp_path, statement_prefix):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            before = await service.list_sequences('ch1')
            draft.members.reverse()
            preview = await service.preview_division('ch1', draft)
            body = DivisionSave(request_id='fail-version', draft=draft, preview_token=preview.preview_token)
            def fail(connection, cursor, statement, parameters, context, executemany):
                if statement.startswith(statement_prefix):
                    raise RuntimeError('version write failed')
            event.listen(db.bind.sync_engine, 'before_cursor_execute', fail)
            try:
                with pytest.raises(RuntimeError, match='version write failed'):
                    await service.save_division('ch1', body)
            finally:
                event.remove(db.bind.sync_engine, 'before_cursor_execute', fail)
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            assert await service.list_sequences('ch1') == before
            assert await db.scalar(select(func.count()).select_from(DivisionVersion)) == 2
            assert (await db.get(DivisionHead, 'ch1')).revision_id == before.current_version.id
            assert await db.get(DivisionCommit, ('ch1', 'fail-version')) is None
            result = await service.save_division('ch1', body)
            assert result.chapter.current_version.number == 3


@pytest.mark.asyncio
async def test_restore_historical_identity_keeps_design_and_advances_versions(tmp_path):
    from app.core.contracts.directing.division import DivisionBaseline, DivisionDraft
    from app.models.directing import Sequence, DirectingRevision
    from tests.directing.test_division import draft_for
    from tests.directing.samples import design_sample

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            original = await setup_two(service)
            chapter = await service.list_sequences('ch1')
            old = original.members[0]
            design = await service.save_revision(old.sequence_id, kind='design', payload=design_sample())
            replacement = original.model_copy(deep=True)
            replacement.members[0] = old.model_copy(update={'key': 'replacement', 'sequence_id': None})
            replacement.exited_sequence_ids = [old.sequence_id]
            replacement.lineage[0].target_keys = ['replacement']
            saved, _ = await save(service, replacement, 'replace', confirmed=True)
            retired = await db.get(Sequence, old.sequence_id, populate_existing=True)
            assert not retired.is_current
            retired_version = retired.version
            current = await draft_for(service)
            new_id = saved.created_sequence_ids['replacement']
            current.members[0] = old
            current.exited_sequence_ids = [new_id]
            current.lineage[0].target_keys = [old.key]
            current.source_revision_id = chapter.current_version.id
            current.restored_baseline = [DivisionBaseline(sequence_id=old.sequence_id, version=retired_version)]
            draft = DivisionDraft.model_validate(current.model_dump())
            stale = draft.model_copy(deep=True)
            stale.restored_baseline[0].version -= 1
            with pytest.raises(RevisionConflict, match='历史场次已变化'):
                await service.preview_division('ch1', stale)
            wrong_source = draft.model_copy(update={'source_revision_id': saved.chapter.current_version.id})
            with pytest.raises(ValueError, match='不在来源划分版本'):
                await service.preview_division('ch1', wrong_source)
            preview = await service.preview_division('ch1', draft)
            assert 'restored' in preview.impacts[0].changes and preview.impacts[0].design_count == 1
            assert preview.identity_confirmation_required
            with pytest.raises(ValueError, match='身份去向'):
                await save(service, draft, 'unconfirmed')
            restored, request = await save(service, draft, 'restore', confirmed=True)
            assert restored.chapter.sequences[0].id == old.sequence_id
            assert restored.chapter.sequences[0].version == retired_version + 1
            assert restored.chapter.current_version.number == saved.chapter.current_version.number + 1
            version = await db.get(DivisionVersion, restored.chapter.current_version.id)
            assert version.origin == 'restore' and version.source_revision_id == chapter.current_version.id
            assert (await db.get(DirectingRevision, design.id)).sequence_id == old.sequence_id
            assert (await service.save_division('ch1', request)) == restored
            assert not (await db.get(Sequence, new_id, populate_existing=True)).is_current
