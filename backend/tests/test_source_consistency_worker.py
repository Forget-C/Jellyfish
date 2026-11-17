"""通过任务计算入口核对新检查范围与固定解释依据。"""
import json
from hashlib import sha256
from app.services.script_processing_worker import generate_script_result
from tests.test_script_processing_agents import _MockChatModel


def test_check_freezes_source_and_explanation_versions():
    source = '李哥走来。'
    version = sha256(source.encode()).hexdigest()
    result = generate_script_result('script_consistency', _MockChatModel('{"issues":[],"has_issues":false}'),
                                   {'script_text': source, 'source_explanations': []})
    assert result.source_version == version
    assert result.check_scope == 'source_consistency'
    assert result.explanation_version == sha256(json.dumps([]).encode()).hexdigest()


def test_repair_refuses_changes_outside_selected_excerpt():
    import pytest
    source = '李四来了。张三走了。'
    llm = _MockChatModel('{"optimized_script_text":"李四到了。张三回来了。","change_summary":"修改"}')
    with pytest.raises(ValueError, match='未选问题'):
        generate_script_result('script_optimize', llm, {'script_text': source, 'consistency': {
            'check_scope': 'source_consistency', 'issues': [{'excerpt': '李四来了。', 'resolution': 'repair'}]}})


def test_repair_preserves_other_paragraphs_and_returns_preview_source():
    source = '李四来了。张三走了。'
    llm = _MockChatModel('{"optimized_script_text":"李四到了。张三走了。","change_summary":"仅修复选中问题"}')
    result = generate_script_result('script_optimize', llm, {'script_text': source, 'consistency': {
        'check_scope': 'source_consistency', 'issues': [{'excerpt': '李四来了。', 'resolution': 'repair'}]}})
    assert result.source_text == source
    assert result.optimized_script_text == '李四到了。张三走了。'


def test_check_reports_spatial_ambiguity_at_task_boundary():
    llm = _MockChatModel('{"issues":[{"issue_type":"spatial","classification":"ambiguity","excerpt":"他走到另一侧","description":"位置含糊","suggestion":"确认位置","candidates":["车的另一侧"]}],"has_issues":true}')
    result = generate_script_result('script_consistency', llm, {'script_text': '他走到另一侧'})
    assert result.issues[0].issue_type == 'spatial'
    assert result.issues[0].classification == 'ambiguity'


def test_repair_combines_adjacent_selected_ranges_without_rejecting_valid_changes():
    source = '李四来了。张三走了。'
    llm = _MockChatModel('{"optimized_script_text":"甲乙丙","change_summary":"合并修复"}')
    result = generate_script_result('script_optimize', llm, {'script_text': source, 'consistency': {
        'check_scope': 'source_consistency', 'issues': [
            {'excerpt': '李四来了。', 'resolution': 'repair'}, {'excerpt': '张三走了。', 'resolution': 'repair'}]}})
    assert result.optimized_script_text == '甲乙丙'


def test_language_check_locates_explanation_issues_without_invalidating_notes():
    source = '李成才下车，向他们打招呼到。'
    note = {'id': 'route', 'excerpt': '', 'text': '沿车尾绕行并停到镜头左边。',
            'source_version': sha256(source.encode()).hexdigest(), 'policy_version': 2}
    llm = _MockChatModel(json.dumps({'issues': [
        {'issue_type': 'language', 'classification': 'contradiction', 'excerpt': '打招呼到',
         'description': '用字问题', 'suggestion': '改为打招呼道'},
        {'issue_type': 'explanation_scope', 'target': 'explanation', 'explanation_id': 'route',
         'description': '这是新增的拍摄路线', 'suggestion': '用户确认后退出采用'}], 'has_issues': True}))
    result = generate_script_result('script_consistency', llm, {'script_text': source, 'source_explanations': [note]})
    assert result.policy_version == 2
    assert result.issues[0].target == 'source'
    assert result.issues[1].explanation_id == 'route'
    assert note['policy_version'] == 2


def test_explanation_scope_issue_cannot_be_misreported_as_source_repair():
    import pytest
    llm = _MockChatModel(json.dumps({'issues': [{'issue_type': 'explanation_scope', 'target': 'source',
        'excerpt': '原文', 'description': '解释越界', 'suggestion': '调整解释'}], 'has_issues': True}))
    with pytest.raises(ValueError, match='解释问题'):
        generate_script_result('script_consistency', llm, {'script_text': '原文'})
