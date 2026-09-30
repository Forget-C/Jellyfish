"""旧记录接入不覆盖当前成员，重复执行不重复创建版本。"""
from copy import deepcopy

import pytest
from sqlalchemy import delete, func, select, text

from app.core.contracts.directing.workspace import SequenceUpdate
from app.models.directing import DivisionCommit, DivisionHead, DivisionVersion
from app.services.directing.division import DivisionService
from app.services.directing.division_import import DivisionImportService
from tests.directing.test_division import save, setup_two
from tests.directing.test_store import database


async def remove_tracking(db):
    await db.execute(delete(DivisionHead))
    for row in await db.scalars(select(DivisionVersion).order_by(DivisionVersion.number.desc())):
        await db.delete(row)
        await db.flush()


@pytest.mark.asyncio
async def test_import_final_receipt_and_later_actual_baseline(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            draft.members[0].title = '旧回执'
            saved, _ = await save(service, draft)
            receipt = await db.get(DivisionCommit, ('ch1', 'save-1'))
            original = deepcopy(receipt.response)
            first = saved.chapter.sequences[0]
            await service.write_sequence('ch1', SequenceUpdate(title='后来改名', position=first.position,
                source_version=saved.chapter.source_version, expected_version=first.version), first.id)
            await remove_tracking(db)
            db.add(DivisionCommit(chapter_id='ch1', request_id='broken', request_hash='x', response={}))
            await db.flush()
            importer = DivisionImportService(db, 'p1')
            result = await importer.import_history('ch1')
            assert result['imported'] == 1 and result['baseline_created']
            assert result['issues'][0]['request_id'] == 'broken'
            versions = list(await db.scalars(select(DivisionVersion).order_by(DivisionVersion.number)))
            assert [row.origin for row in versions] == ['imported', 'baseline']
            assert versions[0].snapshot['sequences'][0]['title'] == '旧回执'
            assert versions[1].snapshot['sequences'][0]['title'] == '后来改名'
            assert versions[0].base_revision_id is None and versions[0].source_task_id is None
            assert versions[0].created_at == receipt.created_at
            assert versions[0].mapping['source_task_unknown']
            assert (await db.get(DivisionHead, 'ch1')).revision_id == versions[1].id
            assert receipt.response == original
            again = await importer.import_history('ch1')
            assert again['imported'] == 0 and again['skipped'] == 1 and not again['baseline_created']
            assert await db.scalar(select(func.count()).select_from(DivisionVersion)) == 2


@pytest.mark.asyncio
async def test_matching_receipt_becomes_current_without_duplicate(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            draft.members[0].title = '最终保存'
            saved, _ = await save(service, draft)
            await remove_tracking(db)
            result = await DivisionImportService(db, 'p1').import_history('ch1')
            assert result['imported'] == 1 and not result['baseline_created']
            current = await service.list_sequences('ch1')
            assert current.current_version.number == 1 and current.sequences == saved.chapter.sequences
            assert await db.scalar(select(func.count()).select_from(DivisionVersion)) == 1


@pytest.mark.asyncio
async def test_dry_run_rollback_empty_chapter_and_project_isolation(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            await setup_two(DivisionService(db, 'p1'))
            await remove_tracking(db)
        async with sessions() as db:
            # SQLite legacy transaction control 的 SELECT 不启动实际事务，需在保存点前显式 BEGIN。
            await db.execute(text('BEGIN'))
            result = await DivisionImportService(db, 'p1').import_history('ch1')
            assert result['baseline_created']
            await db.rollback()
        async with sessions.begin() as db:
            assert await db.scalar(select(func.count()).select_from(DivisionVersion)) == 0
            result = await DivisionImportService(db, 'p2').import_history('ch2')
            assert not result['baseline_created'] and result['imported'] == 0
            with pytest.raises(ValueError, match='章节不属于'):
                await DivisionImportService(db, 'p2').import_history('ch1')


@pytest.mark.asyncio
async def test_existing_head_is_not_replaced_by_import(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            draft.members[0].title = '现有版本'
            saved, _ = await save(service, draft)
            receipt = await db.get(DivisionCommit, ('ch1', 'save-1'))
            payload = deepcopy(receipt.response)
            payload['request_id'] = 'legacy'
            db.add(DivisionCommit(chapter_id='ch1', request_id='legacy', request_hash='x', response=payload))
            await db.flush()
            result = await DivisionImportService(db, 'p1').import_history('ch1')
            assert result['imported'] == 1 and not result['baseline_created']
            assert (await db.get(DivisionHead, 'ch1')).revision_id == saved.chapter.current_version.id


@pytest.mark.asyncio
async def test_incomplete_receipt_remains_visible_and_read_only(tmp_path):
    from app.services.directing.division_history import DivisionHistoryService
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            db.add(DivisionCommit(chapter_id='ch1', request_id='incomplete', request_hash='x', response={'private': 'not exposed'}))
            await db.flush()
            history = DivisionHistoryService(db, 'p1')
            page = await history.history('ch1')
            assert page.total == 1 and page.items[0].kind == 'receipt'
            detail = await history.receipt_detail('ch1', 'incomplete')
            assert detail.chapter is None and detail.issues == ['历史回执资料不完整或格式不正确']
            assert 'not exposed' not in detail.model_dump_json()
            assert await db.scalar(select(func.count()).select_from(DivisionVersion)) == 0
            assert await db.get(DivisionHead, 'ch1') is None


@pytest.mark.asyncio
@pytest.mark.parametrize('corrupt', [
    lambda value: value['chapter'].update(chapter_id='ch2'),
    lambda value: value['chapter'].update(raw_text='缺失的原文'),
    lambda value: value['chapter']['sequences'][0].update(project_id='p2'),
    lambda value: value['chapter']['sequences'][0].update(id='missing'),
    lambda value: value['chapter']['sequences'][0].update(position=5),
    lambda value: value.update(created_sequence_ids={'x': 'missing'}),
])
async def test_corrupt_receipt_is_reported_without_inventing_history(tmp_path, corrupt):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            draft.members[0].title = '旧记录'
            await save(service, draft)
            receipt = await db.get(DivisionCommit, ('ch1', 'save-1'))
            payload = deepcopy(receipt.response)
            corrupt(payload)
            receipt.response = payload
            await db.flush()
            await remove_tracking(db)
            result = await DivisionImportService(db, 'p1').import_history('ch1')
            assert result['imported'] == 0 and len(result['issues']) == 1
            assert result['baseline_created']
            assert receipt.response == payload
            versions = list(await db.scalars(select(DivisionVersion)))
            assert len(versions) == 1 and versions[0].origin == 'baseline'
