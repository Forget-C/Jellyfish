"""Retired sound metadata is removed only from editable data, never execution evidence."""
import importlib.util
from pathlib import Path
from unittest.mock import patch
import sqlalchemy as sa
import pytest
from fastapi import HTTPException
from app.schemas.generation_canvas import DialogueCard, SoundArrangementCard
from app.services.generation_canvas.snapshot_support import require_supported_snapshot


@pytest.mark.parametrize('model,fields', [(DialogueCard, {'dialogue_id': 'line', 'version': 3}), (SoundArrangementCard, {'production': 'postproduction'})])
def test_current_contract_rejects_retired_sound_fields(model, fields):
    """New edits cannot silently restore retired semantics."""
    with pytest.raises(ValueError):
        model(id='card', **fields)


def test_legacy_sound_snapshot_requires_fresh_submission():
    snapshot = {'document': {'cards': [{'type': 'direction.dialogue', 'version': 3}]}}
    with pytest.raises(HTTPException) as error:
        require_supported_snapshot(snapshot)
    assert error.value.detail['code'] == 'LEGACY_SOUND_SNAPSHOT'
    assert snapshot['document']['cards'][0]['version'] == 3


def test_migration_backs_up_only_changed_current_documents():
    """One-time migration keeps revision, unrelated version fields and raw history intact."""
    path = Path(__file__).parents[1] / 'alembic/versions/a71e92b603cf_retire_sound_metadata.py'
    spec = importlib.util.spec_from_file_location('retire_sound', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine('sqlite://')
    metadata = sa.MetaData()
    table = sa.Table('generation_canvases', metadata, sa.Column('id', sa.String, primary_key=True), sa.Column('document', sa.JSON), sa.Column('revision', sa.Integer))
    metadata.create_all(engine)
    original = {'cards': [{'type': 'direction.dialogue', 'dialogue_id': 'line', 'version': 3}, {'type': 'direction.sound', 'production': 'postproduction'}, {'type': 'content.text', 'version': 7}], 'edges': [{'id': 'kept'}]}
    with engine.begin() as connection:
        connection.execute(table.insert().values(id='a', document=original, revision=9))
        def create_table(name, *columns):
            sa.Table(name, metadata, *columns).create(connection)
        with patch.object(migration.op, 'get_bind', return_value=connection), patch.object(migration.op, 'create_table', side_effect=create_table):
            migration.upgrade()
        row = connection.execute(sa.select(table)).mappings().one()
        assert row['revision'] == 9
        assert row['document'] == {'cards': [{'type': 'direction.dialogue', 'dialogue_id': 'line'}, {'type': 'direction.sound'}, {'type': 'content.text', 'version': 7}], 'edges': [{'id': 'kept'}]}
        backup = metadata.tables['generation_canvas_sound_metadata_backup']
        assert connection.execute(sa.select(backup.c.document)).scalar_one() == original
