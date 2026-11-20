"""Public canvas connection policy."""
from app.services.generation_canvas.catalog import canvas_catalog


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
