"""单元固定依据经真实场次版本接口核对，执行选择不从同镜关系推定。"""





def test_explicit_beat_background_does_not_leak_to_another_shot():
    """共享节拍不能绕过字段明确限定的背景镜头范围。"""
    from app.core.contracts.directing.scene_version import EditableSceneDesign, EditableGenerationUnit
    from app.services.directing.instruction_inputs import unit_scope
    from tests.directing.samples import editable_design_sample

    raw = editable_design_sample()
    raw['direction']['shots'][1]['beat_ids'] = ['b1']
    raw['applicability'] = [{'subject': {'kind': 'beat', 'id': 'b1', 'field': 'objective'},
        'purpose': 'background', 'scope': 'shots', 'shot_ids': ['s1']}]
    design = EditableSceneDesign.model_validate(raw)
    unit = EditableGenerationUnit.model_validate({'id': 'u', 'ratio': '16:9', 'coverage': [
        {'id': 'c', 'shot_id': 's2', 'beat_ids': ['b1']}]})
    assert not any(row.owner == 'beat:b1' and row.field == 'objective'
                   for row in unit_scope(design, unit).background)
    historical = unit_scope(design, unit, version=1)
    assert any(row.owner == 'beat:b1' and row.field == 'objective' for row in historical.background)
    assert historical.version == 1
