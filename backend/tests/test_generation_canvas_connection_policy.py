"""Public policies and destructive cleanup have one explicit, repeatable boundary."""
from copy import deepcopy

import pytest

from app.services.generation_canvas.catalog import canvas_catalog
from app.services.generation_canvas.connection_cleanup import clean_connection_document


def test_only_unique_whitelisted_pairs_connect_directly():
    catalog = canvas_catalog()
    policies = catalog.connection_policies
    for policy in policies:
        pair = [p for p in policies if (p.source_type, p.target_type) == (policy.source_type, policy.target_type)]
        if policy.connect != 'candidate':
            assert len(pair) == 1
            assert policy.cancel == 'remove_connection'
            assert policy.disconnect == 'release'
            assert policy.connect == 'adopt_design' and policy.source_type.startswith('direction.') and policy.target_type.startswith('model.') or policy.connect == 'associate_acceptance' and policy.source_type == 'direction.criterion'
        else:
            assert policy.cancel == 'keep_connection'
    assert any(p.connect == 'adopt_design' and p.source_type == 'direction.sound' for p in policies)
    assert any(p.disconnect == 'confirm_frame' and p.source_type == 'direction.movement' and p.target_type == 'direction.composition' for p in policies)
    assert all(p.connect == 'candidate' for p in policies if p.source_type.startswith(('content.', 'reference.', 'model.')))


def test_cleanup_restores_adoption_but_never_invents_it():
    document = {'id': 'canvas', 'cards': [
        {'id': 'design', 'type': 'direction.sound'},
        {'id': 'model', 'type': 'model.video', 'input_bindings': [{'id': 'chosen', 'input_port': 'text', 'source': {'canvas_id': 'canvas', 'card_id': 'design', 'port_id': 'text', 'position': 0}}]},
        {'id': 'empty', 'type': 'model.text', 'input_bindings': []},
    ], 'edges': [{'id': 'old-candidate', 'source_card': 'design', 'source_port': 'text', 'target_card': 'empty', 'target_port': 'text'}]}
    original = deepcopy(document)
    cleaned = clean_connection_document(document)
    assert document == original
    assert len(cleaned['edges']) == 1 and cleaned['edges'][0]['target_card'] == 'model'
    assert cleaned['cards'][1]['input_bindings'][0]['prompt_owned'] is False
    assert cleaned['cards'][2]['input_bindings'] == []
    assert clean_connection_document(cleaned) == cleaned


def test_cleanup_conflicts_and_owned_references_without_deleting_other_uses():
    source = lambda card: {'canvas_id': 'canvas', 'card_id': card, 'port_id': 'object', 'object_id': card, 'position': 0}
    document = {'id': 'canvas', 'cards': [
        {'id': 'a', 'type': 'content.character', 'object_id': 'a'},
        {'id': 'b', 'type': 'content.character', 'object_id': 'b'},
        {'id': 'design', 'type': 'direction.performance', 'input_bindings': [
            {'id': 'one', 'input_port': 'participant', 'source': source('a')},
            {'id': 'two', 'input_port': 'participant', 'source': source('b')}]},
        {'id': 'model', 'type': 'model.video', 'input_bindings': [
            {'id': 'invalid', 'input_port': 'key_frame', 'source': source('a')},
            {'id': 'valid', 'input_port': 'text', 'source': {**source('a'), 'port_id': 'text', 'object_id': None}}],
         'frame_targets': [{'binding_id': 'invalid'}], 'prompt': {'segments': [
             {'id': 'text', 'kind': 'text', 'text': 'keep'},
             {'id': 'ref', 'kind': 'reference', 'binding_id': 'invalid'},
             {'id': 'instruction', 'kind': 'instruction', 'references': [{'id': 'invalid-instruction-ref', 'binding_id': 'invalid'}, {'binding_id': 'valid'}]}]}}
    ], 'edges': []}
    cleaned = clean_connection_document(document)
    assert cleaned['cards'][2]['input_bindings'] == []
    model = cleaned['cards'][3]
    assert [b['id'] for b in model['input_bindings']] == ['valid']
    assert model['frame_targets'] == []
    assert model['prompt']['segments'][0]['text'] == 'keep'
    assert '引用失效' in model['prompt']['segments'][1]['text']
    assert model['prompt']['segments'][2]['references'] == [{'binding_id': 'valid'}]
    assert '引用失效' in model['prompt']['segments'][3]['text']
    assert len(cleaned['edges']) == 1
    assert clean_connection_document(cleaned) == cleaned


def test_object_candidates_and_accepted_criterion_survive_cleanup():
    document = {'id': 'canvas', 'cards': [
        {'id': 'person', 'type': 'content.character', 'object_id': 'person'},
        {'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'rule'},
        {'id': 'design', 'type': 'direction.performance', 'input_bindings': [
            {'id': 'accepted', 'input_port': 'acceptance_basis', 'source': {'canvas_id': 'canvas', 'card_id': 'criterion', 'port_id': 'criterion', 'object_id': 'rule', 'position': 0}}]}],
        'edges': [{'id': 'candidate', 'source_card': 'person', 'source_port': 'object', 'target_card': 'design', 'target_port': 'participant'}]}
    cleaned = clean_connection_document(document)
    assert {edge['target_port'] for edge in cleaned['edges']} == {'participant', 'acceptance_basis', 'text'}
    assert cleaned['cards'][2]['input_bindings'][0]['id'] == 'accepted'
    assert clean_connection_document(cleaned) == cleaned


def test_wrong_business_category_is_cleared_without_removing_candidate():
    document = {'id': 'canvas', 'cards': [
        {'id': 'place', 'type': 'content.place', 'object_id': 'place'},
        {'id': 'dialogue', 'type': 'direction.dialogue', 'input_bindings': [{'id': 'wrong', 'input_port': 'speaker', 'source': {'canvas_id': 'canvas', 'card_id': 'place', 'port_id': 'object', 'object_id': 'place', 'position': 0}}]}],
        'edges': [{'id': 'candidate', 'source_card': 'place', 'source_port': 'object', 'target_card': 'dialogue', 'target_port': 'speaker'}]}
    cleaned = clean_connection_document(document)
    assert cleaned['cards'][1]['input_bindings'] == []
    assert cleaned['edges'][0]['id'] == 'candidate'
    assert clean_connection_document(cleaned) == cleaned


@pytest.mark.parametrize(('migration', 'backup_name'), [
    ('b62f4c901dea_unify_connection_policy.py', 'generation_canvas_connection_backup'),
    ('c73e5da012bf_unify_source_connections.py', 'generation_canvas_source_connection_backup'),
])
def test_migration_backs_up_and_invalidates_stale_revisions(monkeypatch, migration, backup_name):
    import importlib.util
    from pathlib import Path
    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    path = Path(__file__).parents[1] / 'alembic/versions' / migration
    spec = importlib.util.spec_from_file_location('connection_migration', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = sa.create_engine('sqlite://')
    metadata = sa.MetaData()
    table = sa.Table('generation_canvases', metadata, sa.Column('id', sa.String, primary_key=True), sa.Column('document', sa.JSON), sa.Column('revision', sa.Integer))
    document = {'id': 'canvas', 'cards': [{'id': 'design', 'type': 'direction.sound'}, {'id': 'model', 'type': 'model.text', 'input_bindings': []}], 'edges': [{'id': 'candidate', 'source_card': 'design', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], 'input_order': {}}
    with engine.begin() as connection:
        metadata.create_all(connection)
        connection.execute(table.insert().values(id='canvas', document=document, revision=7))
        monkeypatch.setattr(module, 'op', Operations(MigrationContext.configure(connection)))
        module.upgrade()
        row = connection.execute(sa.select(table)).mappings().one()
        assert row['revision'] == 8 and row['document']['edges'] == []
        assert connection.execute(table.update().where(table.c.revision == 7).values(document=document)).rowcount == 0
        backup = sa.Table(backup_name, sa.MetaData(), autoload_with=connection)
        saved = connection.execute(sa.select(backup)).mappings().one()
        assert saved['document'] == document and saved['revision'] == 7
    engine.dispose()



def test_image_source_normalization_preserves_adoption_and_remaps_duplicate_references():
    source = dict(canvas_id='canvas', card_id='image', port_id='image', position=0)
    binding = dict(id='first', input_port='first_frame', source=source)
    edge = dict(id='original', source_card='image', source_port='image', target_card='video', target_port='first_frame')
    document = dict(id='canvas', cards=[
        dict(id='image', type='content.image'),
        dict(id='video', type='model.video', input_bindings=[binding, {**binding, 'id': 'duplicate'}],
             prompt={'segments': [{'id': 'ref', 'kind': 'reference', 'binding_id': 'duplicate'}]}),
    ], edges=[edge, {**edge, 'id': 'duplicate-edge'}], input_order={'video': {'first_frame': ['original', 'duplicate-edge']}})
    cleaned = clean_connection_document(document)
    assert {item['target_port'] for item in cleaned['edges']} == {'first_frame', 'last_frame', 'key_frame', 'subject_image'}
    assert cleaned['input_order']['video']['first_frame'] == ['original']
    assert cleaned['cards'][1]['input_bindings'] == [binding]
    assert cleaned['cards'][1]['prompt']['segments'][0]['binding_id'] == 'first'
    assert clean_connection_document(cleaned) == cleaned
