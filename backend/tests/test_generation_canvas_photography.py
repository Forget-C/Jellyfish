"""摄影旧入口退出后，公开契约只允许独立设计整卡采用。"""
from tests.canvas_urls import canvas_url, seed_scene_canvas
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['composition','camera','movement','lighting','focus'])
async def test_independent_design_rejects_old_partial_adoption(canvas_client, kind):
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name':'独立设计'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    document = canvas['document']
    document.update(cards=[{'id':'design','type':'direction.'+kind},{'id':'model','type':'model.text','input_bindings':[{'id':'use','input_port':'text','source':{'canvas_id':canvas['id'],'card_id':'design','port_id':'text','position':0},'photography_scope':['whole']}]}],edges=[{'id':'e','source_card':'design','source_port':'text','target_card':'model','target_port':'text'}])
    saved = await client.put(url,json={'request_id':'old-scope','expected_revision':0,'document':document})
    assert saved.status_code == 422
    assert (await client.get(url)).json()['data']['revision'] == 0


@pytest.mark.asyncio
async def test_retired_photography_candidate_is_rejected(canvas_client):
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p',json={'name':'旧候选'})).json()['data']
    url=canvas_url(f"/canvases/p/{canvas['id']}")
    document=canvas['document']
    document.update(cards=[{'id':'old','type':'direction.photography'},{'id':'model','type':'model.text','prompt':{'segments':[{'id':'text','kind':'text','text':'独立正文'}]}}],edges=[{'id':'e','source_card':'old','source_port':'text','target_card':'model','target_port':'text'}],input_order={'model':{'text':['e']}})
    saved=await client.put(url,json={'request_id':'retire','expected_revision':0,'document':document})
    assert saved.status_code == 422, saved.text
