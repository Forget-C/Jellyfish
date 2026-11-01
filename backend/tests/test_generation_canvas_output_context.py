"""共享结构解析的编译身份、输出视图和草稿隔离回归。"""
from app.schemas.generation_canvas import CanvasDocument, CanvasResolvedOutput, OutputIdentity
from app.services.generation_canvas.compiler import compile_card, resolve_outputs


def test_shared_design_sources_keep_order_and_do_not_expand_candidate_only_inputs():
    doc = CanvasDocument(id='c', project_id='p', name='test', cards=[
        {'id': 'person', 'type': 'reference.character', 'name': 'Alice', 'object_id': 'alice'},
        *[{'id': f'act{i}', 'type': 'direction.performance',
           'objective': {'state': 'proposal', 'purpose': 'design', 'text': f'action{i}'},
           'input_bindings': [{'id': 'person', 'input_port': 'participant',
               'source': {'canvas_id': 'c', 'card_id': 'person', 'port_id': 'object', 'position': 0, 'object_id': 'alice'}}]} for i in range(3)],
        {'id': 'target', 'type': 'model.text', 'input_bindings': [
            {'id': f'input{i}', 'input_port': 'text', 'source': {'canvas_id': 'c', 'card_id': f'act{i}', 'port_id': 'text', 'position': 0}} for i in (1, 0)]}],
        edges=[*[{'id': f'person{i}', 'source_card': 'person', 'source_port': 'object', 'target_card': f'act{i}', 'target_port': 'participant'} for i in range(3)],
               *[{'id': f'act{i}', 'source_card': f'act{i}', 'source_port': 'text', 'target_card': 'target', 'target_port': 'text'} for i in range(3)]],
        input_order={'target': {'text': ['act2', 'act1', 'act0']}})
    candidates = resolve_outputs(doc, 'target')
    assert [item.source.card_id for item in candidates] == ['act2', 'act1', 'act0']
    compiled = compile_card(doc, 'target')
    assert [item.source.card_id for item in compiled.used] == ['act1', 'act0']
    assert compiled.text.index('action1') < compiled.text.index('action0')
    assert 'action2' not in compiled.text and compiled.text.count('Alice') == 2


def test_sequential_output_views_keep_identity_availability_and_freshness():
    doc = CanvasDocument(id='c', project_id='p', name='test', cards=[{'id': 'source', 'type': 'model.text'},
        {'id': 'target', 'type': 'model.text', 'input_bindings': [{'id': 'ref', 'input_port': 'text',
         'source': {'canvas_id': 'c', 'card_id': 'source', 'port_id': 'text', 'position': 1}}]}],
        edges=[{'id': 'edge', 'source_card': 'source', 'source_port': 'text', 'target_card': 'target', 'target_port': 'text'}],
        input_order={'target': {'text': ['edge']}})
    identity = OutputIdentity(canvas_id='c', card_id='source', port_id='text', position=1)
    missing = compile_card(doc, 'target', model_outputs={})
    assert not missing.can_run
    out = CanvasResolvedOutput(source=identity, modality='text', text='first', basis_current=True)
    first = compile_card(doc, 'target', model_outputs={'source': [out]})
    second = compile_card(doc, 'target', model_outputs={'source': [out.model_copy(update={'text': 'second', 'basis_current': False})]})
    assert first.text == 'first' and second.text == 'second'
    assert first.used[0].source == second.used[0].source == identity
    assert first.used[0].basis_current and not second.used[0].basis_current
    assert not compile_card(doc, 'target', model_outputs={}).can_run


def test_context_keeps_draft_modes_and_new_document_separate():
    from app.services.generation_canvas.output_resolution import CanvasOutputContext
    doc = CanvasDocument(id='c', project_id='p', name='draft', cards=[
        {'id': 'person', 'type': 'reference.character', 'name': '', 'object_id': 'alice'}])
    context = CanvasOutputContext(doc)
    assert context.published_outputs('person', model_outputs={}, allow_reference_drafts=True)[0].source.object_id == 'alice'
    assert context.published_outputs('person', model_outputs={}) == []
    named = doc.model_copy(update={'cards': [doc.cards[0].model_copy(update={'name': 'Alice'})]})
    assert CanvasOutputContext(named).published_outputs('person', model_outputs={})[0].payload.name == 'Alice'
    assert context.published_outputs('person', model_outputs={}) == []


def test_context_reads_each_dynamic_output_view_without_retaining_missing_results():
    from app.services.generation_canvas.output_resolution import CanvasOutputContext
    doc = CanvasDocument(id='c', project_id='p', name='views', cards=[{'id': 'source', 'type': 'model.text'}])
    context = CanvasOutputContext(doc)
    assert context.published_outputs('source', model_outputs={}) == []
    out = CanvasResolvedOutput(source=OutputIdentity(canvas_id='c', card_id='source', port_id='text', position=0),
                              modality='text', text='fresh', basis_current=True)
    assert context.published_outputs('source', model_outputs={'source': [out]}) == [out]
    changed = out.model_copy(update={'available': False, 'basis_current': False})
    assert context.published_outputs('source', model_outputs={'source': [changed]}) == [changed]
    assert context.published_outputs('source', model_outputs={}) == []
