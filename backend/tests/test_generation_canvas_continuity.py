"""连续性与事实在公开 HTTP 中完整采用，证据不成为隐式媒体输入。"""
from tests.canvas_urls import canvas_url, seed_scene_canvas
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401

@pytest.mark.asyncio
@pytest.mark.parametrize('kind,fields', [
    ('space_rule', {'spatial_basis': '门位于北侧', 'shootable_area': '仅大厅', 'axis': '东西轴线', 'scale': '门高两米'}),
    ('continuity', {'before': '手里没有钥匙', 'change': '拿起钥匙', 'after': '右手握住钥匙', 'following_constraints': '继续握住'}),
    ('fact', {'fact': '左手始终戴表', 'source_basis': '原作第三段'}),
])
async def test_constraint_cards_publish_complete_own_fields_and_frame_states(canvas_client, kind, fields):
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '连续性'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    doc = canvas['document']
    doc['cards'] = [{'id': 'design', 'type': 'direction.' + kind, **{key: {'state': 'fact', 'text': value} for key, value in fields.items()}, 'scope': {'description': '本段', 'condition': '开门之后'}}]
    response = await canvas_client.put(url, json={'request_id': 'first', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    output = (await canvas_client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]['payload']
    assert output['adoption'] == 'whole_card'
    assert all(output['fields'][key]['text'] == value for key, value in fields.items())
    if kind == 'continuity':
        assert output['frame_states'] == [{'id': 'field:before', 'label': '前态'}, {'id': 'field:after', 'label': '后态'}]
        assert output['requires_frame_target'] is True
    assert (await canvas_client.get(url)).json()['data']['document']['cards'][0]['scope']['description'] == '本段'

@pytest.mark.asyncio
@pytest.mark.parametrize('port,source_type,category,valid', [('space','content.place','place',True),('space','content.character','character',False),('participant','content.costume','costume',True),('participant','content.place','place',False),('related_event','direction.event','event',True)])
async def test_constraint_relationships_only_adopt_eligible_direct_identity(canvas_client, port, source_type, category, valid):
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '明确关系'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    output_port = 'event' if category == 'event' else 'object'
    source = {'canvas_id': canvas['id'], 'card_id': 'source', 'port_id': output_port, 'position': 0, 'object_id': 'identity'}
    origin = {'id': 'source', 'type': source_type, 'name': '直接名称', **({'event_id':'identity','action_change':{'state':'fact','text':'不得跨级'}} if category=='event' else {'object_id':'identity','text':'不得跨级', **({'category':category} if source_type=='content.object' else {})})}
    design = {'id':'design','type':'direction.space_rule' if port=='space' else 'direction.continuity', 'input_bindings':[{'id':'adopt','input_port':port,'source':source}]}
    doc = canvas['document']; doc.update(cards=[origin,design], edges=[{'id':'edge','source_card':'source','source_port':output_port,'target_card':'design','target_port':port}],input_order={'design':{port:['edge']}})
    response = await canvas_client.put(url,json={'request_id':'save','expected_revision':0,'document':doc})
    assert response.status_code == (200 if valid else 422), response.text
    if valid:
        text = (await canvas_client.get(url+'/cards/design/outputs')).json()['data']['outputs'][0]['text']
        assert '直接名称' in text and '不得跨级' not in text
    else:
        assert response.json()['detail']['code'] == 'INVALID_CONSTRAINT_CATEGORY'

@pytest.mark.asyncio
async def test_retired_continuity_evidence_is_rejected(canvas_client):
    files = [(await canvas_client.post('/files/upload',data={'project_id':'p','usage_kind':'generation_upload'},files={'file':(f'{i}.png', b'image', 'image/png')})).json()['data']['id'] for i in range(2)]
    canvas=(await seed_scene_canvas(canvas_client, '/canvases/p',json={'name':'固定证据'})).json()['data'];url=canvas_url(f"/canvases/p/{canvas['id']}");doc=canvas['document']
    source={'canvas_id':canvas['id'],'card_id':'image','port_id':'image','position':0}
    doc.update(cards=[{'id':'image','type':'content.image','file_id':files[0]},{'id':'design','type':'direction.continuity','before':{'text':'空手','state':'fact'},'after':{'text':'握住钥匙','state':'fact'},'examples':[{'id':'evidence','file_id':files[0],'source':source,'purpose':'before','field_id':'before'}]}],edges=[{'id':'edge','source_card':'image','source_port':'image','target_card':'design','target_port':'image_example'}],input_order={'design':{'image_example':['edge']}})
    response = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422, response.text

@pytest.mark.asyncio
async def test_continuity_image_target_keeps_whole_design_and_rejects_field_mismatch(canvas_client):
    canvas=(await seed_scene_canvas(canvas_client, '/canvases/p',json={'name':'前后态'})).json()['data'];url=canvas_url(f"/canvases/p/{canvas['id']}");doc=canvas['document']
    source={'canvas_id':canvas['id'],'card_id':'design','port_id':'text','position':0}
    doc.update(cards=[{'id':'design','type':'direction.continuity','before':{'text':'空手','state':'fact'},'change':{'text':'拿钥匙','state':'proposal'},'after':{'text':'握钥匙','state':'fact'}},{'id':'image','type':'model.image','input_bindings':[{'id':'use','input_port':'text','source':source}]}],edges=[{'id':'edge','source_card':'design','source_port':'text','target_card':'image','target_port':'text'}],input_order={'image':{'text':['edge']}})
    assert (await canvas_client.put(url,json={'request_id':'save','expected_revision':0,'document':doc})).status_code==200
    compiled=(await canvas_client.get(url+'/cards/image/compile')).json()['data']
    assert 'FRAME_TARGET_REQUIRED' in [d['code'] for d in compiled['diagnostics']]
    doc['cards'][1]['frame_targets']=[{'binding_id':'use','state_id':'field:after'}]
    assert (await canvas_client.put(url,json={'request_id':'target','expected_revision':1,'document':doc})).status_code==200
    compiled=(await canvas_client.get(url+'/cards/image/compile')).json()['data']
    assert all(value in compiled['text'] for value in ['空手','拿钥匙','握钥匙'])
    assert not compiled['media']
    assert 'FRAME_TARGET_REQUIRED' not in [d['code'] for d in compiled['diagnostics']]


from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401

@pytest.mark.asyncio
@pytest.mark.parametrize('modality', ['text', 'image', 'video'])
async def test_actual_worker_receives_whole_continuity_with_explicit_ancestors_without_evidence(runtime, image_storage, monkeypatch, modality):
    import asyncio
    import json
    from types import SimpleNamespace
    import httpx
    from app.models.llm import Model, Provider
    from app.task_worker import TaskWorker
    from app.services.task_service import utcnow
    from datetime import timedelta
    async with runtime.sessions.begin() as db:
        if modality == 'image':
            model = await db.get(Model, runtime.model_id)
            model.name, model.category, model.params = 'image-model', 'image', {}
        if modality == 'video':
            model = await db.get(Model, runtime.model_id)
            model.name, model.category, model.params = 'doubao-seedance', 'video', {}
            provider = await db.get(Provider, runtime.provider_id)
            provider.provider_key = 'volcengine'
    source = lambda card, port, **extra: {'canvas_id': runtime.canvas_id, 'card_id': card, 'port_id': port, 'position': 0, **extra}
    doc = runtime.document
    doc.update(cards=[{'id': 'person', 'type': 'direction.event', 'event_id': 'alice', 'name': '钟响', 'action_change': {'state': 'fact', 'text': '秘密事件正文'}},
                     {'id': 'act', 'type': 'direction.continuity', 'before': {'state': 'fact', 'text': '空手'}, 'change': {'state': 'proposal', 'text': '拿钥匙'}, 'after': {'state': 'fact', 'text': '握住钥匙'},
                      'input_bindings': [{'id': 'p', 'source': source('person', 'event', object_id='alice'), 'input_port': 'related_event'}]},
                     {'id': 'consumer', 'type': 'model.' + modality, 'model_id': runtime.model_id, 'config': {'ratio': '16:9', 'seconds': 5} if modality == 'video' else {}, 'frame_targets': [{'binding_id': 'whole', 'state_id': 'field:after'}] if modality == 'image' else [],
                      'input_bindings': [{'id': 'whole', 'source': source('act', 'text'), 'input_port': 'text'}]}],
               edges=[{'id': 'p', 'source_card': 'person', 'source_port': 'event', 'target_card': 'act', 'target_port': 'related_event'}, {'id': 'd', 'source_card': 'act', 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'}],
               input_order={'act': {'related_event': ['p']}, 'consumer': {'text': ['d']}})
    if modality != 'image':
        doc['cards'][-1].pop('frame_targets')
    saved = await runtime.client.put(runtime.url, json={'request_id': 'direction', 'expected_revision': 1, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert preview['can_run'], preview
    assert not preview['input']['media'] and '秘密事件正文' in preview['input']['text']
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'run', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200
    received = []
    class ProviderText:
        def __init__(self, **kwargs):
            pass
        async def astream(self, messages):
            received.append(messages[0].content)
            yield SimpleNamespace(content='完整空间分析')
    monkeypatch.setattr('app.task_worker.build_langchain_chat', ProviderText)
    def provider_http(request):
        if request.method == 'POST':
            body = json.loads(request.content)
            if modality == 'image':
                received.append(body['prompt'])
                return httpx.Response(200, json={'data': [{'b64_json': 'eA=='}]})
            received.append(body['content'][0]['text'])
            return httpx.Response(200, json={'id': 'performance-video'})
        if request.url.host == 'media.test':
            return httpx.Response(200, content=b'whole-performance-video', headers={'Content-Type': 'video/mp4'})
        return httpx.Response(200, json={'status': 'succeeded', 'content': {'video_url': 'https://media.test/video.mp4'}})
    clock = [utcnow()]
    monkeypatch.setattr('app.task_worker.utcnow', lambda: clock[0])
    monkeypatch.setattr('app.services.task_service.utcnow', lambda: clock[0])
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider_http)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        for _ in range(3):
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            await asyncio.sleep(0)
            clock[0] += timedelta(seconds=10)
        worker.text_pool.shutdown(wait=False)
    assert received == [preview['input']['text']]
    assert '拿钥匙' in received[0] and '握住钥匙' in received[0] and '钟响' in received[0]
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    assert node['status'] == 'succeeded', node
    assert node['result_set_id'] and node['current_output_updated']


    reopened = (await runtime.client.get(runtime.url)).json()['data']['document']
    assert reopened['cards'][1]['after']['state'] == 'fact'

@pytest.mark.asyncio
async def test_fact_retired_object_binding_is_rejected(canvas_client):
    canvas=(await seed_scene_canvas(canvas_client, '/canvases/p',json={'name':'锚点事实'})).json()['data'];url=canvas_url(f"/canvases/p/{canvas['id']}");doc=canvas['document']
    doc.update(cards=[{'id':'anchor','type':'direction.anchor','anchor_id':'door','name':'门边','position':{'state':'fact','text':'不穿透锚点正文'}},{'id':'fact','type':'direction.fact','fact':{'state':'fact','text':'不可移动'},'input_bindings':[{'id':'object','input_port':'effect_object','source':{'canvas_id':canvas['id'],'card_id':'anchor','port_id':'anchor','position':0,'object_id':'door'}}]}],edges=[{'id':'edge','source_card':'anchor','source_port':'anchor','target_card':'fact','target_port':'effect_object'}],input_order={'fact':{'effect_object':['edge']}})
    result=await canvas_client.put(url,json={'request_id':'save','expected_revision':0,'document':doc})
    assert result.status_code == 422, result.text

@pytest.mark.asyncio
@pytest.mark.parametrize('case,code',[('count','CONSTRAINT_RELATION_COUNT'),('direct','INVALID_CONSTRAINT_BINDING')])
async def test_constraint_structural_errors_are_located_without_text_correction(canvas_client,case,code):
    canvas=(await seed_scene_canvas(canvas_client, '/canvases/p',json={'name':'结构边界'})).json()['data'];url=canvas_url(f"/canvases/p/{canvas['id']}");doc=canvas['document']
    doc.update(cards=[{'id':'one','type':'content.place','object_id':'one','name':'一号'},{'id':'two','type':'content.place','object_id':'two','name':'二号'},{'id':'rule','type':'direction.space_rule','axis':{'state':'proposal','text':'随意矛盾纯文本不纠错'},'input_bindings':[{'id':'one','input_port':'space','source':{'canvas_id':canvas['id'],'card_id':'one','port_id':'object','object_id':'one','position':0}}]}],edges=[{'id':'one','source_card':'one','source_port':'object','target_card':'rule','target_port':'space'}],input_order={'rule':{'space':['one']}})
    if case=='count':
        doc['cards'][-1]['input_bindings'].append({'id':'two','input_port':'space','source':{'canvas_id':canvas['id'],'card_id':'two','port_id':'object','object_id':'two','position':0}})
        doc['edges'].append({'id':'two','source_card':'two','source_port':'object','target_card':'rule','target_port':'space'});doc['input_order']['rule']['space'].append('two')
    elif case=='field':
        doc['cards'][-1]['examples']=[{'id':'wrong','source':{'canvas_id':canvas['id'],'card_id':'x','port_id':'image','position':0},'file_id':'x','purpose':'before','field_id':'before'}]
    else:
        doc.update(edges=[],input_order={})
    response=await canvas_client.put(url,json={'request_id':'save','expected_revision':0,'document':doc})
    assert response.status_code==422 and response.json()['detail']['code']==code,response.text
    assert response.json()['detail']['target']['card_id']=='rule'
