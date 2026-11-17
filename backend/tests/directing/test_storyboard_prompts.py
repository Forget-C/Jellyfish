"""Video instructions are generated before a storyboard candidate is reviewed."""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from app.models.llm import Model, Provider
from app.models.studio import Chapter
from app.task_worker import TaskWorker
from tests.directing.test_api import client_for
from tests.directing.test_store import database
from tests.directing.test_storyboard_scope import read_data


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', [None, 'prompt', 'review', 'unbound', 'invalid', 'semantic', 'partial', 'mixed'])
async def test_video_candidate_has_generated_prompt_before_review(tmp_path, monkeypatch, failure, mode='complete'):
    from app.services.llm.provider_bootstrap import bootstrap_builtin_providers
    bootstrap_builtin_providers()
    calls = []

    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            inputs = json.loads(messages[1].content)
            if 'repair_targets' in inputs:
                calls.append('repair')
                result = {'edits': [{**inputs['repair_targets'][0], 'text': '修正后的冷蓝色画面'}]}
            elif 'prompt_unit' in inputs:
                calls.append('prompt')
                if failure == 'prompt' and calls.count('prompt') == 1 or failure == 'partial' and calls.count('prompt') == 2:
                    raise httpx.ReadTimeout('controlled prompt timeout')
                result = {'segments': [{'kind': 'text', 'text': '固定机位捕捉人物停步，保留短暂沉默。'}], 'designs': [{'card_id': row['card']['id'], 'placement': 'before' if row['card']['type'] == 'direction.style' else 'body'} for row in inputs['designs']]}
                if failure == 'unbound' and calls.count('prompt') == 1:
                    result['segments'] = [{'kind': 'text', 'text': '@不存在的人物停步'}]
                if failure == 'invalid' and calls.count('prompt') == 1:
                    result['segments'] = [{'kind': 'reference', 'binding_id': 'invented'}]
            elif 'storyboard_draft' in inputs:
                calls.append('review')
                if failure == 'review' and calls.count('review') == 1:
                    raise httpx.ReadTimeout('controlled review timeout')
                assert inputs['video_prompts'][0]['prompt']['segments'][0]['text'].startswith('固定机位')
                result = {'issues': []}
                if failure in ('semantic', 'mixed') and calls.count('review') == 1:
                    result = {'issues': [{'kind': 'conflict', 'shot_ids': ['stop'], 'requirements': '提示词需要更明确的停步节奏', 'suggestion': '修正提示词', 'prompt_unit_ids': [inputs['video_prompts'][0]['card_id']]}]}
                if failure == 'mixed' and calls.count('review') == 1:
                    result['issues'] = [
                        {'kind': 'conflict', 'shot_ids': ['stop'], 'requirements': '色调需要修正', 'suggestion': '修正风格', 'repair_targets': [{'shot_id': 'stop', 'design_id': 'style', 'field_id': 'colors'}]},
                        {'kind': 'conflict', 'shot_ids': ['dark'], 'requirements': '第二单元提示词需要修正', 'suggestion': '修正正文', 'prompt_unit_ids': [inputs['video_prompts'][1]['card_id']]}]
            else:
                calls.append('extract')
                result = {'shots': [{'id': 'stop', 'excerpt': '人物停步。', 'designs': [{'id': 'style', 'card_type': 'direction.style', 'fields': {'colors': {'state': 'proposal', 'text': '冷蓝色画面'}}}]}]}
                if mode == 'faithful':
                    result['shots'][0].pop('designs', None)
                if failure in ('partial', 'mixed'):
                    result['shots'].append({'id': 'dark', 'excerpt': '灯熄灭。'})
            return SimpleNamespace(content=json.dumps(result, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = '人物停步。灯熄灭。' if failure in ('partial', 'mixed') else '人物停步。'
            db.add_all([Provider(id='prompt-provider', name='openai', base_url='https://fixture.test/v1', api_key='test'), Provider(id='prompt-vidu', name='vidu', base_url='https://fixture.test/v1', api_key='test')])
            await db.flush()
            db.add_all([Model(id='prompt-text', name='text', category='text', provider_id='prompt-provider'),
                        Model(id='prompt-video', name='viduq2', category='video', provider_id='prompt-vidu')])
        chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        source = await read_data(client, 'GET', chapter)
        scene = await read_data(client, 'POST', chapter + '/sequences', {'title': '停步', 'position': 0,
            'source_version': source['source_version'], 'span': {'start': 0, 'end': 9 if failure in ('partial', 'mixed') else 5}})
        path = chapter + '/sequences/' + scene['id'] + '/storyboards'
        task = await read_data(client, 'POST', path, {'request_id': 'prompt', 'text_model_id': 'prompt-text',
                                                     'production_model_id': 'prompt-video', 'mode': mode})
        worker = TaskWorker(sessions)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            done = await read_data(client, 'GET', path + '/' + task['task_id'])
            if failure and failure not in ('semantic', 'mixed'):
                assert done['status'] == 'failed', done
                retry = await read_data(client, 'POST', path + '/' + task['task_id'] + '/retry', {'request_id': 'retry'})
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
                done = await read_data(client, 'GET', path + '/' + retry['task_id'])
            assert done['status'] == 'succeeded', done
            card = next(card for card in done['candidate']['document']['cards'] if card['type'] == 'model.video')
            assert card['prompt']['segments'][0]['text'] == '固定机位捕捉人物停步，保留短暂沉默。'
            assert card['generated_prompt']['version'] == 1
            canvas_path = '/api/v1/studio/generation-canvases/p1/' + task['canvas_id']
            applied = await read_data(client, 'POST', path + '/' + done['task_id'] + '/apply',
                                      {'expected_revision': done['candidate']['base_revision']})
            compiled = await read_data(client, 'GET', canvas_path + '/cards/' + card['id'] + '/compile')
            if mode == 'complete':
                assert compiled['text'].count('冷蓝色画面') == 1
            assert compiled['text'].count('固定机位捕捉人物停步') == 1
            assert '人物停步。' not in compiled['text'], 'source excerpt must not be appended again'
            if mode == 'complete':
                unstacked = {**applied['document'], 'groups': []}
                applied = await read_data(client, 'PUT', canvas_path, {'request_id': 'unstack',
                    'expected_revision': applied['revision'], 'document': unstacked})
                applied = await read_data(client, 'GET', canvas_path)
                changed = applied['document']
                style = next(row for row in changed['cards'] if row['type'] == 'direction.style')
                style['fields']['colors']['text'] = '温暖金色画面'
                await read_data(client, 'PUT', canvas_path, {'request_id': 'edit-style',
                    'expected_revision': applied['revision'], 'document': changed})
                refreshed = await read_data(client, 'GET', canvas_path + '/cards/' + card['id'] + '/compile')
                assert '温暖金色画面' in refreshed['text'] and '冷蓝色画面' not in refreshed['text']
                assert '固定机位捕捉人物停步' in refreshed['text']
            assert calls == (['extract', 'prompt', 'prompt', 'prompt', 'review'] if failure == 'partial' else ['extract', 'prompt', 'prompt', 'review'] if failure in ('prompt', 'unbound', 'invalid') else ['extract', 'prompt', 'review', 'review'] if failure == 'review' else ['extract', 'prompt', 'review', 'prompt', 'review'] if failure == 'semantic' else ['extract', 'prompt', 'prompt', 'review', 'repair', 'prompt', 'review'] if failure == 'mixed' else ['extract', 'prompt', 'review'])
        finally:
            worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
async def test_faithful_candidate_can_repair_generated_prose_without_editing_designs(tmp_path, monkeypatch):
    await test_video_candidate_has_generated_prompt_before_review(tmp_path, monkeypatch, 'semantic', mode='faithful')
