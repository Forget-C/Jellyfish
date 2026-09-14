"""风格候选、适用范围和不可变确认版本的业务验证。"""
from copy import deepcopy
import pytest
from app.core.contracts.directing.style import StyleWrite
from app.services.directing.store import DirectingStore, RevisionConflict
from tests.directing.test_store import database, frozen
from tests.directing.samples import SOURCE, design_sample


@pytest.mark.asyncio
async def test_style_scope_confirmation_and_design_binding(tmp_path):
    """候选和范围不匹配的规则不执行，旧设计始终绑定原确认版本。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store = DirectingStore(db, 'p1')
            sequence = await store.create_sequence(chapter_id='ch1', title='shop', position=0)
            content = {'title': '项目风格', 'sources': [SOURCE], 'rules': [
                {'id': 'r1', 'role': 'performance', 'requirement': '先看后动', 'status': 'confirmed',
                 'sequence_ids': [sequence.id], 'model_names': ['video-model'], 'sources': [SOURCE]},
                {'id': 'r2', 'role': 'cinematography', 'requirement': '固定机位', 'sources': [SOURCE]}]}
            row = await store.save_style(StyleWrite(content=content))
            design = design_sample(); design['style_revision_id'] = row.id
            with pytest.raises(ValueError, match='must be confirmed'):
                await store.save_revision(sequence.id, kind='design', payload=design)
            row = await store.confirm_style(row.id, expected_version=1, actor_id='author')
            saved_design = await frozen(store, sequence.id, 'design', design)
            assert [r.id for r in await store.applicable_style(row.id, sequence.id, 'video-model')] == ['r1']
            assert not await store.applicable_style(row.id, sequence.id, 'different-model')
            other_sequence = await store.create_sequence(chapter_id='ch1', title='other', position=1)
            assert not await store.applicable_style(row.id, other_sequence.id, 'video-model')
            with pytest.raises(RevisionConflict):
                await store.save_style(StyleWrite(content=content, revision_id=row.id, expected_version=row.version))
            changed = deepcopy(content); changed['rules'][0]['requirement'] = '先停再动'
            derived = await store.save_style(StyleWrite(content=changed, parent_id=row.id))
            assert derived.id != row.id
            assert (await store.revision(saved_design.id)).payload['style_revision_id'] == row.id
            assert (await store.applicable_style(row.id, sequence.id, 'video-model'))[0].requirement == '先看后动'
            with pytest.raises(ValueError, match='not found in project'):
                await DirectingStore(db, 'p2').style_revision(row.id)


@pytest.mark.asyncio
async def test_confirmed_style_is_consumed_by_compiler_and_review(tmp_path):
    """相同冻结风格进入最终提示词及审稿，候选要求不会漏入执行。"""
    from app.services.directing.production import ProductionService
    from app.core.contracts.directing.workspace import AIRequest
    from app.models.llm import Model
    from tests.directing.test_production import prepare

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = ProductionService(db, 'p1')
            style = await service.save_style(StyleWrite(content={'title': '风格', 'sources': [SOURCE], 'rules': [
                {'id': 'active', 'role': 'cinematography', 'requirement': '保留灰色柔光', 'status': 'confirmed', 'sources': [SOURCE]},
                {'id': 'candidate', 'role': 'direction', 'requirement': '不能进入提示词的候选', 'sources': [SOURCE]},
                {'id': 'deprecated', 'role': 'direction', 'requirement': '不能进入提示词的弃用规则', 'status': 'deprecated', 'sources': [SOURCE]}]}))
            style = await service.confirm_style(style.id, expected_version=1, actor_id='author')
            payload = design_sample(); payload['style_revision_id'] = style.id
            service, sequence_id, _, prompt_id, _ = await prepare(db, payload)
            prompt = (await service.revision(prompt_id)).payload
            assert '保留灰色柔光' in prompt['text']
            assert '不能进入提示词的候选' not in prompt['text']
            assert '不能进入提示词的弃用规则' not in prompt['text']
            db.add(Model(id='text-style', name='qwen-test', category='text', provider_id='provider1'))
            await db.flush()
            task = await service.submit_review(sequence_id, prompt_id, AIRequest(model_id='text-style'))
            assert [rule['id'] for rule in task.input_snapshot['run_args']['style_rules']] == ['active']


@pytest.mark.asyncio
async def test_style_confirmation_revalidates_chapter_source(tmp_path):
    """保存草稿后原文改变，旧来源不能被确认为新的有效风格证据。"""
    from hashlib import sha256
    from app.models.studio import Chapter

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store = DirectingStore(db, 'p1')
            chapter = await db.get(Chapter, 'ch1')
            source = {'kind': 'chapter', 'reference': chapter.id, 'version': sha256(chapter.raw_text.encode()).hexdigest()}
            style = await store.save_style(StyleWrite(content={'title': '来源验证', 'sources': [source], 'rules': []}))
            chapter.raw_text += '新增内容'
            await db.flush()
            with pytest.raises(ValueError, match='chapter source'):
                await store.confirm_style(style.id, expected_version=1, actor_id='author')
            assert (await store.style_revision(style.id)).confirmed_at is None


@pytest.mark.asyncio
async def test_style_rules_are_frozen_for_design_and_image_requests(tmp_path):
    """文本与图片分别按实际模型选规则，设计模型不能替换冻结风格身份。"""
    from types import SimpleNamespace
    import json
    from app.services.directing.production import ProductionService
    from app.services.directing.ai import generate_directing_result
    from app.core.contracts.directing.workspace import AIRequest, VisualRequest
    from app.models.llm import Model, Provider

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            db.add(Provider(id='style-provider', name='OpenAI', base_url='https://example.invalid/v1', api_key='test'))
            await db.flush()
            db.add_all([Model(id='text-style', name='qwen-test', category='text', provider_id='style-provider'),
                        Model(id='image-style', name='gpt-image-1', category='image', provider_id='style-provider')])
            await db.flush()
            service = ProductionService(db, 'p1')
            sequence = await service.create_sequence(chapter_id='ch1', title='场次', position=0)
            style = await service.save_style(StyleWrite(content={'title': '风格', 'sources': [SOURCE], 'rules': [
                {'id': 'text', 'role': 'direction', 'requirement': '文本规则', 'status': 'confirmed', 'model_names': ['qwen-test'], 'sources': [SOURCE]},
                {'id': 'image', 'role': 'cinematography', 'requirement': '图片规则', 'status': 'confirmed', 'model_names': ['gpt-image-1'], 'sources': [SOURCE]},
                {'id': 'candidate', 'role': 'direction', 'requirement': '候选不发送', 'sources': [SOURCE]}]}))
            style = await service.confirm_style(style.id, expected_version=1, actor_id='author')
            task = await service.submit_ai(kind='directing_design', sequence_id=sequence.id,
                body=AIRequest(model_id='text-style', style_revision_id=style.id))
            args = task.input_snapshot['run_args']
            assert [rule['id'] for rule in args['style_rules']] == ['text']
            payload = design_sample(); payload['style_revision_id'] = 'model-invented-style'
            llm = SimpleNamespace(invoke=lambda messages: SimpleNamespace(content=json.dumps(payload)))
            generated = generate_directing_result('directing_design', llm, args)
            assert generated.style_revision_id == style.id
            design = await frozen(service, sequence.id, 'design', generated.model_dump(mode='json'))
            image = await service.generate_visual(sequence.id, VisualRequest(design_revision_id=design.id,
                model_id='image-style', prompt='画面', purpose='space'))
            assert '图片规则' in image.input_snapshot['execution_prompt']
            assert '文本规则' not in image.input_snapshot['execution_prompt']
            assert '候选不发送' not in image.input_snapshot['execution_prompt']
