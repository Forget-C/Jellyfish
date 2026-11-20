"""大载荷历史通过公共列表读取，不将诊断载荷交给数据库排序。"""

import pytest
from sqlalchemy import event

from app.models.task import Task
from app.models.generation_canvas import GenerationCanvas
from tests.directing.test_api import client_for
from tests.directing.test_store import database
from tests.directing.test_storyboard_scope import read_data


@pytest.mark.asyncio
async def test_large_storyboard_history_is_bounded_and_ordered(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        source = await read_data(client, 'GET', chapter)
        scene = await read_data(client, 'POST', chapter + '/sequences', {
            'title': '历史恢复', 'position': 0, 'source_version': source['source_version'],
            'span': {'start': 0, 'end': len('兄弟在店中交谈')}})
        scene_path = chapter + '/sequences/' + scene['id']
        canvas = await read_data(client, 'POST', scene_path + '/canvases', {'name': '大历史画布'})
        async with sessions.begin() as db:
            stored = await db.get(GenerationCanvas, canvas['id'])
            document = {**stored.document}
            document['cards'] = [{**card, 'text': '原文' * 262144} if card['id'] == document['fixed_source']['card_id']
                                 else card for card in document['cards']]
            stored.document = document
            for index in range(25):
                db.add(Task(id=f'history-{index:02d}', kind='directing_storyboard', project_id='p1',
                    target_type='directing_sequence', target_id=scene['id'], status='failed', stage='finished',
                    error_message='诊断' * 32768,
                    input_snapshot={'chapter_id': 'ch1', 'canvas_id': canvas['id'],
                                    'scene_admission_order': index, 'frozen': '原文' * 131072},
                    result={'review_state': 'pending', 'output': '草案' * 262144}))
        engine = sessions.kw['bind']
        sorted_statements = []
        window_projections = []
        def observe(_connection, _cursor, statement, _parameters, _context, _executemany):
            if 'row_number()' in statement.lower():
                ranked = statement.lower().partition('from (select')[2]
                if ranked:
                    window_projections.append(ranked.partition('from tasks')[0])
            elif 'ORDER BY' in statement and ('tasks' in statement or 'generation_canvases' in statement):
                sorted_statements.append(statement.split('FROM')[0])
        event.listen(engine.sync_engine, 'before_cursor_execute', observe)
        try:
            rows = await read_data(client, 'GET', scene_path + '/storyboards?canvas_id=' + canvas['id'])
            listed = await read_data(client, 'GET', scene_path + '/canvases')
            assert listed['canvases'][0]['id'] == canvas['id']
            summary = listed['canvases'][0]['latest_storyboard']
            assert summary['task_id'] == 'history-24'
            assert summary['error'] == '诊断' * 32768
            assert summary['review_state'] == 'incomplete'
        finally:
            event.remove(engine.sync_engine, 'before_cursor_execute', observe)
        assert [row['task_id'] for row in rows] == [f'history-{index:02d}' for index in range(24, 4, -1)]
        assert all(row['review_state'] == 'incomplete' and row['canvas_id'] == canvas['id'] for row in rows)
        assert rows[0]['error'] == '诊断' * 32768
        # SQLite cannot reproduce MySQL filesort exhaustion. Keep its payload boundary explicit,
        # alongside the API assertions and the real-MySQL canvas replay.
        assert len(window_projections) == 1
        assert all(field not in window_projections[0] for field in (
            'error_message', 'retry_of_task_id', 'reextract_canvas_id', 'tasks.result',
        ))
        assert sorted_statements
        assert all('error_message' not in statement and 'result' not in statement
                   and 'input_snapshot' not in statement and 'document' not in statement for statement in sorted_statements)
