"""复杂分镜的正式任务、保存和编译使用同一共同画布。"""

from tests.canvas_urls import append_canvas_path, canvas_url
import asyncio
import json
from types import SimpleNamespace

from tests.directing.storyboard_prompt_fixture import video_prompt_response

import pytest

from app.models.llm import Model, Provider
from app.models.studio import Chapter, Character, CharacterImage, ProjectPropLink, Prop, PropImage
from app.task_worker import TaskWorker
from tests.directing.storyboard_scope_fixture import START, END, SCRIPT, complex_design
from tests.directing.test_api import client_for
from tests.directing.test_store import database


async def read_data(client, method, path, body=None):
    response = await client.request(method, path, json=body)
    assert response.status_code == 200, response.text
    return response.json()['data']


def verify_all_design_fields(document, fixture):
    cards = {card['id']: card for card in document['cards']}
    storyboard = document['storyboard']
    shot_ids = {item['id']: row['shot_id'] for item, row in zip(fixture['shots'], storyboard['shots'])}
    checked = scoped = 0
    for design in fixture['designs']:
        prefix = f"scene:design:{design['id']}"
        items = [(cards[key], origin) for key, origin in storyboard['origins'].items()
                 if origin['semantic_key'] == prefix or origin['semantic_key'].startswith(prefix + ':scope:')]
        fields = list(design['fields'].items()) + [('phase:' + row['id'], row['frame']) for row in design.get('phases', [])]
        for field, original in fields:
            if field.startswith('phase:'):
                phase_name = next(row['name'] for row in design['phases'] if 'phase:' + row['id'] == field)
                matches = [(phase['frame'], origin, 'phase:' + phase['id']) for card, origin in items for phase in card['phases']
                           if phase['name'] == phase_name]
            else:
                matches = [(values[field], origin, field) for card, origin in items
                           if (values := card.get('fields', card)) and values[field].get('extraction_context') == 'storyboard']
            [(actual, origin, actual_field)] = matches
            assert (actual['state'], actual['purpose'], actual['text'], actual['source_locator'], actual['extraction_reason']) == (
                original['state'], original['purpose'], original['text'], original['excerpt'], original['reason'])
            evidence = next(item for item in origin['sources'] if item['field_id'] == actual_field)
            assert SCRIPT[evidence['start']:evidence['end']] == original['excerpt']
            assert evidence['source_version'] == storyboard['source_version']
            checked += 1
            if applies := original.get('scope'):
                stored = origin['applicability']
                assert actual_field in stored['fields']
                assert stored['shot_ids'] == [shot_ids[key] for key in applies['shot_ids']]
                assert stored['phase'] == applies['phase'] and stored['condition_id'] == applies['condition_id']
                assert stored['occurrence_ids'] == applies['occurrence_ids']
                scoped += 1
    assert (checked, scoped) == (129, 122)


@pytest.mark.asyncio
async def test_complex_scope_reaches_real_compiler_without_expanding_dependencies(tmp_path, monkeypatch):
    calls = []
    outputs = []

    class ControlledModel:
        """替换供应商输出，保留任务、验证、保存及真实编译。"""

        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            if response := video_prompt_response(messages):
                return response
            if 'storyboard_draft' in json.loads(messages[1].content):
                return SimpleNamespace(content='{"issues": []}')
            args = json.loads(messages[1].content)
            if 'organization_inputs' in args:
                calls.append('organization')
                assert [item['id'] for item in args['organization_inputs']] == ['rear']
                segments = [{'id': 'take-out', 'excerpt': START, 'seconds': 9, 'ratio': '16:9'},
                            {'id': 'lift', 'excerpt': END, 'seconds': 9, 'ratio': '16:9'}]
                if len(messages) == 2:
                    segments[0]['ratio'] = '4:5'
                output = {'shots': [{'id': 'rear', 'segments': segments}]}
            elif 'mode' in args:
                calls.append('storyboard')
                output = complex_design(args['objects'][0]['id'])
                if len(calls) == 2:
                    output['designs'][1]['fields']['position']['dependencies'][0]['field_id'] = 'orientation'
                else:
                    outputs.append(output)
            else:
                calls.append('objects')
                output = {'objects': [{'kind': 'character', 'name': '林舟', 'description': '码头勘查者',
                                       'excerpt': '林舟在码头', 'asset_id': 'scope-character'}]}
            return SimpleNamespace(content=json.dumps(output, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = SCRIPT
            db.add_all([Provider(id='scope-openai', provider_key='openai', name='openai', base_url='https://fixture.test/v1', api_key='test'),
                        Provider(id='scope-vidu', provider_key='vidu', name='vidu', base_url='https://fixture.test/v1', api_key='test'),
                        Character(id='scope-character', project_id='p1', name='林舟', style='真人都市')])
            await db.flush()
            db.add_all([Model(id='scope-text', name='fixture-text', category='text', provider_id='scope-openai'),
                        Model(id='scope-image', name='gpt-image-1', category='image', provider_id='scope-openai'),
                        Model(id='scope-video', name='viduq2', category='video', provider_id='scope-vidu'),
                        CharacterImage(character_id='scope-character', file_id='image1', is_primary=True)])
        chapter_path = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = await read_data(client, 'GET', chapter_path)
        scene = await read_data(client, 'POST', chapter_path + '/sequences', {'title': '码头', 'position': 0,
            'source_version': chapter['source_version'], 'span': {'start': 0, 'end': len(SCRIPT)}})
        endpoint = chapter_path + '/sequences/' + scene['id']
        worker = TaskWorker(sessions)
        try:
            async def work():
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())

            await read_data(client, 'POST', endpoint + '/objects/extractions', {'request_id': 'objects', 'model_id': 'scope-text'})
            await work()
            prepared = await read_data(client, 'GET', endpoint + '/objects')
            await read_data(client, 'PUT', endpoint + '/objects/' + prepared['objects'][0]['id'],
                            {'expected_revision': prepared['revision'], 'asset_id': 'scope-character'})

            async def build(model):
                task = await read_data(client, 'POST', endpoint + '/storyboards',
                    {'request_id': model, 'text_model_id': 'scope-text', 'production_model_id': model})
                await work()
                finished = await read_data(client, 'GET', endpoint + '/storyboards/' + task['task_id'])
                assert finished['status'] == 'succeeded', finished
                candidate = finished['candidate']
                path = canvas_url('/api/v1/studio/generation-canvases/p1/') + task['canvas_id']
                await read_data(client, 'PUT', path, {'request_id': 'storyboard:' + task['task_id'],
                    'expected_revision': candidate['base_revision'], 'document': candidate['document']})
                return path, await read_data(client, 'GET', path)

            image_path, image = await build('scope-image')
            assert calls == ['objects', 'storyboard', 'storyboard']
            verify_all_design_fields(image['document'], outputs[0])
            image_story = image['document']['storyboard']
            first_model = image_story['shots'][0]['model_card_ids'][0]
            compiled = await read_data(client, 'GET', append_canvas_path(image_path, f'/cards/{first_model}/compile'))
            used_cards = {item['source']['card_id'] for item in compiled['used']}
            origins = image_story['origins']
            adopted_anchor = [key for key in used_cards if origins.get(key, {}).get('semantic_key', '').startswith('scene:design:anchor')]
            [anchor_id] = adopted_anchor
            assert origins[anchor_id]['applicability']['fields'] == ['position']
            assert all(text in compiled['text'] for text in ('合用前段锚点', '开启画面定位', '前镜调度选择'))
            assert all(text not in compiled['text'] for text in ('排除后镜锚点', '排除候选锚点', '排除另一镜头画面', '仅声音阶段风声'))
            assert any(item['payload'].get('frame_target_state', {}).get('label') == '开启画面'
                       for item in compiled['used'] if item.get('payload'))
            composition = next(item for item in image['document']['cards'] if item['type'] == 'direction.composition')
            assert any(edge['source_card'] == composition['frame_target']['card_id']
                       and edge['target_card'] == composition['id'] and edge['source_port'] == edge['target_port'] == 'text'
                       for edge in image['document']['edges'])
            image_model = next(item for item in image['document']['cards'] if item['id'] == first_model)
            assert anchor_id not in {item['source']['card_id'] for item in image_model['input_bindings']}
            assert image_model['frame_targets'][0]['binding_id'] in {item['id'] for item in image_model['input_bindings']}
            checked = await read_data(client, 'POST', image_path + '/precheck', {'card_id': first_model})
            assert checked['can_run'], checked['diagnostics']
            assert [item['file_id'] for item in checked['input']['media']] == ['image1']

            video_path, video = await build('scope-video')
            assert calls == ['objects', 'storyboard', 'storyboard', 'storyboard', 'organization', 'organization']
            verify_all_design_fields(video['document'], outputs[1])
            data = video['document']
            first, second = data['storyboard']['shots']
            models = {card['id']: card for card in data['cards'] if card['type'] == 'model.video'}
            assert [models[key]['config']['seconds'] for key in first['model_card_ids']] == [5]
            assert [models[key]['config']['seconds'] for key in second['model_card_ids']] == [9, 9]
            assert [len(segment['object_ids']) for segment in second['segments']] == [1, 2]
            assert [(use['model_card_id'], use['active']) for use in second['reference_uses']] == [
                (second['model_card_ids'][0], True), (second['model_card_ids'][1], True), (second['model_card_ids'][1], False)]
            assert len([card for card in data['cards'] if card['type'] == 'direction.shot']) == 2
            assert len([card for card in data['cards'] if card['type'] == 'direction.beat']) == 2
            assert len({item for shot in (first, second) for item in shot['object_ids']}) == 2
            for model_id, include, exclude in zip(second['model_card_ids'],
                    ['分段动作取出', '分段动作举高'], ['分段动作举高', '分段动作取出']):
                checked = await read_data(client, 'POST', video_path + '/precheck', {'card_id': model_id})
                assert checked['can_run'], checked['diagnostics']
                assert include in checked['input']['text'] and exclude not in checked['input']['text']
                assert '仅声音阶段风声' not in checked['input']['text'] and '未满足条件不降灯' not in checked['input']['text']
                assert checked['input']['media'][0]['file_id'] == 'image1'
            assert not (await read_data(client, 'GET', video_path + '/runtime'))['runs']

            card = next(item for item in data['cards'] if item['id'] == second['model_card_ids'][1])
            specific = next(key for key, origin in data['storyboard']['origins'].items()
                            if origin['semantic_key'].startswith('scene:design:continuity') and
                            origin.get('applicability', {}).get('fields') == ['after'])
            card['input_bindings'] = [item for item in card['input_bindings'] if item['source']['card_id'] != specific]
            detached = {edge['id'] for edge in data['edges'] if edge['source_card'] == specific and edge['target_card'] == card['id']}
            data['edges'] = [edge for edge in data['edges'] if edge['id'] not in detached]
            data['input_order'][card['id']]['text'] = [key for key in data['input_order'][card['id']]['text'] if key not in detached]
            ungrouped = first['model_card_ids'][0]
            data['groups'] = [group for group in data['groups'] if group['kind'] != 'stack']
            for group in data['groups']:
                group['card_ids'] = [key for key in group['card_ids'] if key not in (card['id'], ungrouped)]
            data['groups'].append({'id': 'manual-model-group', 'name': '人工制作组', 'card_ids': [card['id']]})
            await read_data(client, 'PUT', video_path, {'request_id': 'manual', 'expected_revision': video['revision'], 'document': data})
            edited = await read_data(client, 'GET', append_canvas_path(video_path, f"/cards/{card['id']}/compile"))
            assert '分段动作举高' not in edited['text']
            before_reextract = await read_data(client, 'GET', video_path)
            rerun = await read_data(client, 'POST', endpoint + canvas_url('/canvases/') + video['id'] + '/storyboards',
                {'request_id': 'repeat-segmented', 'text_model_id': 'scope-text', 'production_model_id': 'scope-video'})
            await work()
            application = endpoint + '/storyboards/' + rerun['task_id']
            candidate = await read_data(client, 'GET', application)
            assert candidate['pending_application'] and candidate['status'] == 'succeeded', candidate
            choice = {'expected_revision': before_reextract['revision']}
            diff = await read_data(client, 'POST', application + '/diff', choice)
            assert any(item['id'] == card['id'] and item['manually_edited'] for item in diff['modified'])
            merged = await read_data(client, 'POST', application + '/apply', choice)
            assert merged['document']['storyboard']['shots'][1]['segments'] == second['segments']
            groups = merged['document']['groups']
            assert [group['id'] for group in groups if card['id'] in group['card_ids']] == ['manual-model-group']
            assert all(ungrouped not in group['card_ids'] for group in groups)
            assert merged['document']['storyboard']['origins'][specific]['applicability'] == data['storyboard']['origins'][specific]['applicability']
            after = await read_data(client, 'GET', append_canvas_path(video_path, f"/cards/{card['id']}/compile"))
            assert '分段动作举高' not in after['text']
            assert [item['file_id'] for item in after['media']] == ['image1']
            undo = await read_data(client, 'POST', application + '/restore',
                {'request_id': 'undo-segmented', 'expected_revision': merged['revision'], 'direction': 'undo',
                 'document': before_reextract['document']})
            assert undo['document'] == before_reextract['document']

        finally:
            worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
async def test_parked_van_still_informs_the_offscreen_detail_shot(tmp_path, monkeypatch):
    """The van remains a reference in the detail shot without becoming a visible participant."""
    alley = '雨夜，白色面包车停在胡同里。'
    wait = '张三站在车旁等候。'
    detail = '他右手握着甩棍。'
    original = alley + wait + detail
    state = '张三保持在车旁，白色面包车留在画外'

    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            if response := video_prompt_response(messages):
                return response
            if 'storyboard_draft' in json.loads(messages[1].content):
                return SimpleNamespace(content='{"issues": []}')
            args = json.loads(messages[1].content)
            if 'mode' not in args:
                output = {'objects': [{'kind': 'prop', 'name': '白色面包车', 'description': '停在胡同的车',
                                       'excerpt': '白色面包车停在胡同里', 'asset_id': 'parked-van'}]}
            else:
                van = args['objects'][0]['id']
                output = {'missed_objects': [{'id': 'person', 'kind': 'character', 'name': '张三', 'excerpt': wait}],
                          'shots': [{'id': 'alley', 'excerpt': alley, 'object_ids': [van]},
                                    {'id': 'wait', 'excerpt': wait, 'object_ids': ['person', van]},
                                    {'id': 'detail', 'excerpt': detail, 'object_ids': ['person']}],
                          'designs': [{'id': 'parked-van', 'card_type': 'direction.continuity', 'object_id': van,
                                       'fields': {'before': {'state': 'fact', 'text': '白色面包车停在胡同里',
                                                             'excerpt': alley, 'scope': {'shot_ids': ['detail']}},
                                                  'following_constraints': {'state': 'proposal', 'text': state,
                                                                            'scope': {'shot_ids': ['detail']}}}}]}
            return SimpleNamespace(content=json.dumps(output, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = original
            db.add_all([Provider(id='rain-text', provider_key='openai', name='openai', base_url='https://fixture.test/v1', api_key='test'),
                        Provider(id='rain-video', provider_key='vidu', name='vidu', base_url='https://fixture.test/v1', api_key='test'),
                        Prop(id='parked-van', project_id='p1', name='白色面包车', style='真人都市')])
            await db.flush()
            db.add_all([Model(id='rain-text-model', name='text', category='text', provider_id='rain-text'),
                        Model(id='rain-video-model', name='viduq2', category='video', provider_id='rain-video'),
                        ProjectPropLink(project_id='p1', prop_id='parked-van'),
                        PropImage(prop_id='parked-van', file_id='image1', is_primary=True)])
        chapter_path = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = await read_data(client, 'GET', chapter_path)
        scene = await read_data(client, 'POST', chapter_path + '/sequences', {'title': '车旁等候', 'position': 0,
            'source_version': chapter['source_version'], 'span': {'start': 0, 'end': len(original)}})
        endpoint = chapter_path + '/sequences/' + scene['id']
        worker = TaskWorker(sessions)
        try:
            await read_data(client, 'POST', endpoint + '/objects/extractions', {'request_id': 'rain-objects', 'model_id': 'rain-text-model'})
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            objects = await read_data(client, 'GET', endpoint + '/objects')
            await read_data(client, 'PUT', endpoint + '/objects/' + objects['objects'][0]['id'],
                            {'expected_revision': objects['revision'], 'asset_id': 'parked-van'})
            task = await read_data(client, 'POST', endpoint + '/storyboards', {'request_id': 'rain-storyboard',
                'text_model_id': 'rain-text-model', 'production_model_id': 'rain-video-model'})
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            finished = await read_data(client, 'GET', endpoint + '/storyboards/' + task['task_id'])
            assert finished['status'] == 'succeeded', finished
            candidate = finished['candidate']
            path = canvas_url('/api/v1/studio/generation-canvases/p1/') + task['canvas_id']
            await read_data(client, 'PUT', path, {'request_id': 'storyboard:' + task['task_id'],
                'expected_revision': candidate['base_revision'], 'document': candidate['document']})
            document = (await read_data(client, 'GET', path))['document']
            story = document['storyboard']
            van = next(row for row in story['objects'] if row['origin'] == 'prepared')
            for index, shot in enumerate(story['shots']):
                check = await read_data(client, 'POST', path + '/precheck', {'card_id': shot['model_card_ids'][0]})
                assert check['can_run'], check['diagnostics']
                assert [item['file_id'] for item in check['input']['media']] == ['image1']
                assert (state in check['input']['text']) == (index == 2)
            assert not any(edge['source_card'] == van['description_card_id'] and edge['target_card'] == story['shots'][2]['card_id']
                           for edge in document['edges'])
        finally:
            worker.text_pool.shutdown(wait=False)
