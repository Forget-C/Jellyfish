"""同一画布输入经两种模型适配入口，核对领域预演、送审与公开回复。"""

import json

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage

from app.schemas.canvas_assistant import CanvasAssistantReadContext
from app.schemas.generation_canvas import CanvasCreate, TextContentCard
from app.services.approval import ApprovalAccess, ApprovalScope
from app.services.generation_canvas.assistant_edits import CanvasAssistantEditDraft
from app.services.generation_canvas.edits import CanvasEditGroup, canvas_edits
from app.services.generation_canvas.lifecycle import free_canvas_lifecycle
from app.services.generation_canvas.planning_tools import CanvasPlanningTools
from tests.directing.test_store import database


def change(card_id, value):
    return {'title': '改正文', 'changes': [
        {'kind': 'edit_field', 'change': {'card_id': card_id, 'target': {'kind': 'card_text'}, 'text': value}},
    ]}


@pytest.mark.asyncio
async def test_native_and_text_models_share_plan_and_immutable_approval(tmp_path):
    from app.services.generation_canvas.model_adapter import CanvasModelAdapter, CanvasModelApprovalScope

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            lifecycle = free_canvas_lifecycle(db)
            canvas = await lifecycle.create_free(CanvasCreate(name='镜头'))
            edits = canvas_edits(db, None)
            baseline = await edits.preview(canvas.id, [CanvasEditGroup(id='seed', cards=[
                TextContentCard(id='one', text='雨夜'), TextContentCard(id='two', text='路灯'),
            ])])
            await edits.submit(baseline, request_id='seed')
            canvas = await lifecycle.read(canvas.id)
        context = CanvasAssistantReadContext(revision=canvas.revision, scope='canvas',
            target_card_ids=['one', 'two'], cards=[card.model_dump(mode='json') for card in canvas.document.cards])
        access = ApprovalAccess(scope=ApprovalScope(kind='canvas', id=canvas.id), actor_id='creator',
                                permissions={'read', 'submit'})

        def adapter(allow_submit, name):
            return CanvasModelAdapter(CanvasPlanningTools(sessions, None, canvas.id, context,
                CanvasAssistantEditDraft(context, canvas.document)), CanvasModelApprovalScope(
                    access=access, object_id=name, version='v1', idempotency_key=f'send-{name}', allow_submit=allow_submit,
                ))

        groups = [change('one', '清晨'), change('two', '窗户'), change('missing', '失效'),
                  {'title': '坏参数', 'changes': [{'kind': 'not_defined'}]}]
        native, text = adapter(False, 'native-plan'), adapter(False, 'text-plan')
        tools = {tool.name: tool for tool in native.native_tools()}
        assert 'submit_canvas_approval' not in tools and 'decide_canvas_approval' not in tools
        page = json.loads(await tools['read_canvas'].ainvoke({'limit': 1}))
        assert (await text.text_reply('{"canvas_read":{"limit":1}}')).canvas_page == page
        input_error = await tools['inspect_canvas_inputs'].ainvoke({'card_id': 'missing'})
        assert input_error in (await text.text_reply('{"input_check":{"card_id":"missing"}}')).reply
        native_preview = json.loads(await tools['preview_canvas_changes'].ainvoke({'groups': groups}))
        text_preview = await text.text_reply(json.dumps({'reply': '建议调整两张卡。', 'groups': groups,
                                                        'submit_for_approval': True}, ensure_ascii=False))
        assert native.latest_preview.plan == text_preview.preview.plan
        assert len(native.latest_preview.plan.groups) == 2 and len(native_preview['issues']) == 2
        assert native.latest_preview.issues == text_preview.preview.issues
        assert '仅允许预演' in text_preview.reply
        assert await native.recover_submission() is None and await text.recover_submission() is None

        native, text = adapter(True, 'native-submit'), adapter(True, 'text-submit')
        tools = {tool.name: tool for tool in native.native_tools()}
        preview = json.loads(await tools['preview_canvas_changes'].ainvoke({'groups': groups}))
        assert await native.recover_submission() is None
        rejected = await tools['submit_canvas_approval'].ainvoke({'preview_id': 'unknown', 'version': 'v1'})
        assert '预演' in rejected
        payload = {'preview_id': preview['preview_id'], 'version': preview['version']}
        accepted = json.loads(await tools['submit_canvas_approval'].ainvoke(payload))
        assert json.loads(await tools['submit_canvas_approval'].ainvoke(payload)) == accepted
        await text.text_reply(json.dumps({'reply': '先预演。', 'groups': groups}, ensure_ascii=False))
        assert await text.recover_submission() is None
        text_result = await text.text_reply(json.dumps({'reply': '请核对两个镜头。', 'groups': groups,
                                                        'submit_for_approval': True}, ensure_ascii=False))
        assert text_result.reply.startswith('请核对两个镜头。')
        assert text_result.request.group_ids == tuple(accepted['group_ids']) == ('1', '2')
        assert text_result.request.version == accepted['version'] == 'v1'
        assert text_result.request.snapshot_ref == accepted['snapshot_ref']
        assert (await adapter(True, 'native-submit').recover_submission()).id == accepted['id']
        assert 'submit_for_approval' not in text_result.reply
        stale = adapter(True, 'stale-preview')
        stale_preview = (await stale.text_reply(json.dumps({'groups': [change('one', '暖色')] }))).preview
        async with sessions() as db:
            reopened = await free_canvas_lifecycle(db).read(canvas.id)
            assert reopened.document == canvas.document and reopened.revision == canvas.revision
        async with sessions.begin() as db:
            await canvas_edits(db, None).submit(native.latest_preview.plan, request_id='changed-elsewhere')
        stale_command = {'preview_id': stale_preview.preview_id, 'version': 'v1'}
        stale_tool = next(tool for tool in stale.native_tools() if tool.name == 'submit_canvas_approval')
        native_error = await stale_tool.ainvoke(stale_command)
        text_error = await stale.text_reply('画布状态有变化。\n\n' + json.dumps({'approval': stale_command}))
        assert native_error in text_error.reply and '重新预演' in native_error
        assert text_error.request is None and await stale.recover_submission() is None
        # 原提交回执不被后续手动写入改写。
        assert json.loads(await tools['submit_canvas_approval'].ainvoke(payload)) == accepted


@pytest.mark.asyncio
@pytest.mark.parametrize('native', [False, True])
async def test_adapter_stream_hides_partial_and_final_control_json(native):
    from app.services.generation_canvas.assistant_stream import invoke_with_reply
    from app.services.generation_canvas.model_adapter import public_canvas_reply

    fragments = ['我会保留现有镜头。', '\n\n```json\n', '{"appro', 'val":{"preview_id":"hidden","version":"v1"}}', '\n```']
    opaque = json.dumps({'preview_id': 'hidden', 'version': 'v1'})
    final = AIMessage(content=''.join(fragments))

    class ModelStream:
        async def astream(self, *args, **kwargs):
            for text in fragments:
                yield 'messages', (AIMessageChunk(id='model', content=text), {'langgraph_node': 'model'})
            if native:
                yield 'messages', (ToolMessage(content=opaque, tool_call_id='submit'), {'langgraph_node': 'tools'})
            yield 'values', {'messages': [final]}

    shown = []
    phases = []

    async def publish(text):
        shown.append(text)

    async def phase(status):
        phases.append(status)

    state = await invoke_with_reply(ModelStream(), {}, None, publish, on_phase=phase)
    assert shown[0] == '我会保留现有镜头。'
    assert all('hidden' not in item and 'approval' not in item and '{' not in item for item in shown)
    assert phases == ['generating_proposal']
    assert public_canvas_reply(state['messages'][-1].text) == '我会保留现有镜头。'
