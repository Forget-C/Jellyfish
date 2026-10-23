"""公开参数规则在保存之外生成定位诊断，不把未完成编辑判作坏文档。"""
from app.schemas.generation_canvas import CanvasModelCapability, VideoModelCard, ImageModelCard
from app.services.generation_canvas.capabilities import parameter_diagnostics


def test_video_invalid_parameters_diagnose_each_preserved_value():
    card = VideoModelCard(id='v', config={'ratio': '1:1', 'seconds': 20, 'seed': 7})
    capability = CanvasModelCapability(model_id='video', modality='video', input_ports=['text'],
                                       ratios=['16:9'], min_seconds=4, max_seconds=8, supports_seed=False)
    diagnostics = parameter_diagnostics(card, capability)
    assert [item['target'] for item in diagnostics] == [
        {'card_id': 'v', 'path': ['config', 'ratio']},
        {'card_id': 'v', 'path': ['config', 'seconds']},
        {'card_id': 'v', 'path': ['config', 'seed']},
    ]
    assert all(item['blocks'] == ['run'] for item in diagnostics)
    assert card.config.model_dump() == {'ratio': '1:1', 'seconds': 20, 'seed': 7}


def test_image_count_and_resolution_obey_actual_capability():
    card = ImageModelCard(id='i', config={'target_ratio': '16:9', 'resolution_profile': 'high', 'count': 3})
    capability = CanvasModelCapability(model_id='image', modality='image', input_ports=['text', 'image'],
                                       ratios=['16:9'], resolution_profiles={'16:9': {'standard': '1024x576'}}, max_count=2)
    assert [issue['target']['path'] for issue in parameter_diagnostics(card, capability)] == [
        ['config', 'count'], ['config', 'resolution_profile']]
