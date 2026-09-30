"""历史恢复重新校验依赖、任务与原文，不倒退既有成果。"""

from copy import deepcopy
from hashlib import sha256

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.core.contracts.directing.division import DivisionBaseline, DivisionDraft, DivisionSave
from app.core.contracts.directing.workspace import SequenceCreate, SourceSpan
from app.models.directing import CutTakeReference, RevisionDependency, Take
from app.models.studio import Chapter
from app.models.task import Task
from app.services.directing.division import DivisionService
from app.services.directing.store import RevisionConflict
from tests.directing.samples import SOURCE, design_sample, plan_sample
from tests.directing.test_division import setup_two, save
from tests.directing.test_store import database, frozen, output


async def retired_pair(service, media_reference=False):
    original = await setup_two(service)
    source = await service.list_sequences('ch1')
    designs = [await service.save_revision(member.sequence_id, kind='design', payload=design_sample()) for member in original.members]
    if media_reference:
        design = await service.confirm_revision(designs[0].id, expected_version=designs[0].version, actor_id='author')
        plan = await frozen(service, design.sequence_id, 'plan', plan_sample(design.id))
        prompt = await frozen(service, design.sequence_id, 'prompt', {
            'plan_revision_id': plan.id, 'unit_id': 'u1', 'format_version': 'fixture-1', 'text': '保留原素材。',
            'sources': [SOURCE], 'decisions': [{'section_path': '/direction/viewpoint', 'disposition': 'text',
                'explanation': '保留视点', 'text_excerpt': '保留原素材'}],
        })
        await output(service.db, prompt.id)
        take = await service.register_take(prompt_revision_id=prompt.id, task_id='task1', output_ordinal=0)
        cut = await service.save_revision(designs[1].sequence_id, kind='cut', payload={'items': []})
        # 模拟旧数据保留的跨场素材索引；当前恢复必须检查它，不能因两场已退出而忽略。
        service.db.add(CutTakeReference(revision_id=cut.id, take_id=take.id))
        await service.db.flush()
    removed = original.model_copy(deep=True)
    removed.members = []
    removed.exited_sequence_ids = [row.sequence_id for row in original.members]
    for row in removed.lineage:
        row.target_keys = []
    await save(service, removed, 'remove-all', confirmed=True)
    historical = await service.historical_sequences('ch1')
    draft = DivisionDraft(source_version=source.source_version, source_revision_id=source.current_version.id,
        baseline=[], members=original.members, exited_sequence_ids=[], lineage=[],
        restored_baseline=[DivisionBaseline(sequence_id=row.id, version=row.version) for row in historical])
    return draft, designs


@pytest.mark.asyncio
@pytest.mark.parametrize('media_reference', [False, True])
async def test_restore_dependencies_and_pending_delivery_are_rechecked(tmp_path, media_reference):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft, designs = await retired_pair(service, media_reference)
            left, right = designs
            takes_before = [(row.id, row.sequence_id, row.version, deepcopy(row.annotation)) for row in await db.scalars(select(Take))]
            if not media_reference:
                db.add(RevisionDependency(revision_id=right.id, dependency_id=left.id))
            await db.flush()
            partial = draft.model_copy(deep=True)
            partial.members = [draft.members[1]]
            partial.restored_baseline = [row for row in draft.restored_baseline if row.sequence_id == right.sequence_id]
            preview = await service.preview_division('ch1', partial)
            assert any(left.sequence_id in reason and '最终当前集合' in reason for reason in preview.blockers)
            with pytest.raises(RevisionConflict, match='最终当前集合'):
                await save(service, partial, 'partial', confirmed=True)
            task = Task(id='delivery', project_id='p1', kind='image_generation', target_type='directing_image',
                target_id=left.id, status='running')
            db.add(task)
            await db.flush()
            preview = await service.preview_division('ch1', draft)
            assert any('delivery' in reason and '恢复' in reason for reason in preview.blockers)
            task.status = 'succeeded'
            await db.flush()
            preview = await service.preview_division('ch1', draft)
            assert not preview.blockers
            body = DivisionSave(request_id='restore', draft=draft, preview_token=preview.preview_token, identity_changes_confirmed=True)
            # 模拟既有在途成果在预览后交付；旧预览不能假装仍是同一影响集合。
            original_payload = deepcopy(left.payload)
            left.version += 1
            await db.flush()
            with pytest.raises(RevisionConflict, match='成果已变化'):
                await service.save_division('ch1', body)
            restored, _ = await save(service, draft, 'restore-new-preview', confirmed=True)
            assert [row.id for row in restored.chapter.sequences] == [row.sequence_id for row in draft.members]
            assert left.payload == original_payload
            if media_reference:
                assert await db.scalar(select(CutTakeReference.take_id)) == takes_before[0][0]
                assert [(row.id, row.sequence_id, row.version, row.annotation) for row in await db.scalars(select(Take))] == takes_before
            else:
                assert await db.get(RevisionDependency, (right.id, left.id)) is not None


@pytest.mark.asyncio
async def test_historical_source_requires_explicit_relocation(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft, _ = await retired_pair(service)
            chapter = await db.get(Chapter, 'ch1')
            chapter.raw_text = '新增。' + chapter.raw_text
            await db.flush()
            draft.source_version = sha256(chapter.raw_text.encode()).hexdigest()
            with pytest.raises(ValueError, match='重新定位'):
                await service.preview_division('ch1', draft)
            draft.history_reconfirmed = True
            with pytest.raises(ValueError, match='重新定位'):
                await service.preview_division('ch1', draft)
            for row in draft.members:
                row.reconfirm_source = True
                row.span.start += 3
                row.span.end += 3
            saved, _ = await save(service, draft, 'rebase', confirmed=True)
            assert saved.chapter.raw_text == chapter.raw_text
            assert [row.source_text for row in saved.chapter.sequences] == ['兄弟在', '店中交谈']
            assert all(row.source.version == draft.source_version for row in saved.chapter.sequences)


@pytest.mark.asyncio
async def test_old_ai_rebase_preserves_provenance_and_requires_complete_source(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            original = await service.list_sequences('ch1')
            task = Task(id='old-ai', project_id='p1', target_type='directing_chapter', target_id='ch1', kind='directing_divide', status='succeeded',
                input_snapshot={'run_args': {'script_text': original.raw_text, 'source_version': original.source_version,
                    'division_baseline': {row.sequence_id: row.version for row in draft.baseline}}},
                result={'scenes': [{'title': '原始分析', 'excerpt': original.raw_text, 'purpose': '叙事'}]})
            db.add(task)
            chapter = await db.get(Chapter, 'ch1')
            chapter.raw_text = '序。' + original.raw_text
            await db.flush()
            draft.source_task_id = task.id
            draft.source_version = sha256(chapter.raw_text.encode()).hexdigest()
            with pytest.raises(RevisionConflict, match='手动核对'):
                await service.preview_division('ch1', draft)
            draft.history_reconfirmed = True
            with pytest.raises(ValueError, match='重新定位'):
                await service.preview_division('ch1', draft)
            for row in draft.members:
                row.reconfirm_source = True
                row.span.start += 2
                row.span.end += 2
            saved, _ = await save(service, draft, 'ai-rebase')
            from app.models.directing import DivisionVersion
            version = await db.get(DivisionVersion, saved.chapter.current_version.id)
            assert version.source_task_id == task.id and version.origin == 'ai'
            assert version.mapping['history_reconfirmed']
            assert task.result['scenes'][0]['title'] == '原始分析'
            assert saved.chapter.sequences[0].title != '原始分析'
            # 缺失旧原文无法凭 history_reconfirmed 伪装成已核对的历史来源。
            from tests.directing.test_division import draft_for
            invalid = await draft_for(service)
            invalid.source_task_id = task.id
            invalid.history_reconfirmed = True
            task.input_snapshot = {'run_args': {'source_version': original.source_version}}
            await db.flush()
            with pytest.raises(ValueError, match='资料不完整'):
                await service.preview_division('ch1', invalid)


@pytest.mark.parametrize('fields', [
    {'source_revision_id': 'v1', 'source_task_id': 'ai1'},
    {'history_reconfirmed': True},
    {'restored_baseline': [{'sequence_id': 's1', 'version': 1}]},
    {'source_revision_id': 'v1', 'restored_baseline': [{'sequence_id': 's1', 'version': 1}]},
    {'source_revision_id': 'v1', 'baseline': [{'sequence_id': 's1', 'version': 1}],
     'restored_baseline': [{'sequence_id': 's1', 'version': 1}]},
])
def test_restore_contract_rejects_ambiguous_or_incomplete_identity(fields):
    value = {'source_version': 'raw-v1', 'baseline': [], 'members': [], 'exited_sequence_ids': [], 'lineage': [], **fields}
    with pytest.raises(ValidationError):
        DivisionDraft.model_validate(value)


@pytest.mark.asyncio
@pytest.mark.parametrize('target_project', ['p1', 'p2'])
async def test_restore_checks_cross_chapter_reference_ownership_and_membership(tmp_path, target_project):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft, designs = await retired_pair(service)
            db.add(Chapter(id='reference-chapter', project_id=target_project, index=2, title='引用章', raw_text='引用原文'))
            await db.flush()
            target_service = DivisionService(db, target_project)
            target_chapter = await target_service.list_sequences('reference-chapter')
            target = await target_service.write_sequence('reference-chapter', SequenceCreate(
                title='被引用场次', position=0, source_version=target_chapter.source_version, span=SourceSpan(start=0, end=4)))
            dependency = await target_service.save_revision(target.id, kind='design', payload=design_sample())
            db.add(RevisionDependency(revision_id=designs[0].id, dependency_id=dependency.id))
            await db.flush()
            preview = await service.preview_division('ch1', draft)
            if target_project != 'p1':
                assert any('不属于当前项目' in reason for reason in preview.blockers)
                with pytest.raises(RevisionConflict, match='不属于当前项目'):
                    await save(service, draft, 'foreign-reference', confirmed=True)
                return
            assert not preview.blockers
            old_request = DivisionSave(request_id='restore-before-exit', draft=draft,
                preview_token=preview.preview_token, identity_changes_confirmed=True)
            target_draft = DivisionDraft(source_version=target_chapter.source_version,
                baseline=[DivisionBaseline(sequence_id=target.id, version=target.version)], members=[],
                exited_sequence_ids=[target.id], lineage=[{'sequence_id': target.id, 'target_keys': []}])
            target_preview = await target_service.preview_division('reference-chapter', target_draft)
            await target_service.save_division('reference-chapter', DivisionSave(request_id='exit-reference',
                draft=target_draft, preview_token=target_preview.preview_token, identity_changes_confirmed=True))
            with pytest.raises(RevisionConflict):
                await service.save_division('ch1', old_request)
            preview = await service.preview_division('ch1', draft)
            assert any(target.id in reason and '最终当前集合' in reason for reason in preview.blockers)
            assert await db.get(RevisionDependency, (designs[0].id, dependency.id)) is not None
