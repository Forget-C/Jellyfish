"""Provider response for legacy storyboard fixtures that do not exercise writing."""
import json
from types import SimpleNamespace


def video_prompt_response(messages):
    inputs = json.loads(messages[1].content)
    if 'prompt_unit' not in inputs:
        return None
    return SimpleNamespace(content=json.dumps({
        'segments': [{'kind': 'text', 'text': '按当前单元设计执行。'}],
        'designs': [{'card_id': row['card']['id'], 'placement': 'before'} for row in inputs['designs']],
    }, ensure_ascii=False))
