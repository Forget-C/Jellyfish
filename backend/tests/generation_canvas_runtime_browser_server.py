"""Isolated real HTTP + TaskWorker fixture, controlled external providers."""
import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from time import monotonic, sleep
from types import SimpleNamespace
import uvicorn
from fastapi import Body
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.llm import Model, Provider
from app.models.studio import Project
from app.task_worker import TaskWorker, WorkerLimits
import app.task_worker as worker_module

database_url = os.environ.get('CANVAS_BROWSER_DATABASE_URL')
if database_url:
    from sqlalchemy.engine import make_url
    parsed = make_url(database_url)
    if parsed.get_backend_name() != 'mysql' or not (parsed.database or '').startswith('jellyfish_check'):
        raise ValueError('browser MySQL evidence requires an explicit jellyfish_check database')
# Reload can cancel an SQLite stream while SQLAlchemy is closing its connection.
# Use a fresh connection for each checkout in the file-backed browser fixture.
engine = create_async_engine(database_url, isolation_level='READ COMMITTED') if database_url else create_async_engine(
    'sqlite+aiosqlite:///' + os.environ['CANVAS_BROWSER_DATABASE'], poolclass=NullPool)
project_id = os.environ.get('CANVAS_BROWSER_PROJECT_ID', 'canvas-project')
provider_id = project_id + '-provider' if database_url else 'canvas-runtime-provider'
model_id = project_id + '-text' if database_url else 'canvas-runtime-text'
sessions = async_sessionmaker(engine, expire_on_commit=False)
storyboard_video_fixture = os.environ.get('CANVAS_BROWSER_STORYBOARD_VIDEO_FIXTURE')
storyboard_design_stacks = os.environ.get('CANVAS_BROWSER_STORYBOARD_DESIGN_STACKS') == '1'
control = {'release': 0, 'release_for': {}, 'fail_next': False, 'calls': [], 'stream_connections': 0, 'disconnect_epoch': 0, 'duplicate_next': False, 'check_release': False, 'check_calls': []}
if storyboard_video_fixture:
    control.update(media_calls=[], media_fail_next=False, media_hold=False)
object_candidate_fixture = os.environ.get('CANVAS_BROWSER_OBJECT_CANDIDATE') == '1'
if object_candidate_fixture:
    control['object_extraction_calls'] = 0
storyboard_recovery_fixture = os.environ.get('CANVAS_BROWSER_STORYBOARD_RECOVERY') == '1'
if storyboard_recovery_fixture:
    control.update(storyboard_calls=0, storyboard_release=0, storyboard_fail_on=0)
    control.update(storyboard_review_calls=0, storyboard_review_release=100, storyboard_review_fail_on=0,
                   storyboard_review_conflict_on=0)
    control.update(storyboard_repair_on=0, storyboard_repair_calls=0, storyboard_repair_release=False,
                   storyboard_recheck_release=False, saved_storyboard_check_calls=0)


class ControlledModel:
    """Provider chunks remain blocked until the browser observes committed increments."""
    def __init__(self, **params):
        self.params = params

    def invoke(self, messages):
        """为场次准备和分镜浏览器旅程替换外部模型输出。"""
        from tests.directing.storyboard_prompt_fixture import video_prompt_response
        if response := video_prompt_response(messages):
            return response
        if os.environ.get('CANVAS_BROWSER_SCENE_OBJECTS') != '1':
            raise AssertionError('Unexpected direct text request')
        args = json.loads(messages[1].content)
        if 'repair_targets' in args and storyboard_recovery_fixture:
            control['storyboard_repair_calls'] += 1
            deadline = monotonic() + 45
            while not control['storyboard_repair_release'] and monotonic() < deadline:
                sleep(.03)
            [target] = args['repair_targets']
            text = '沿原轴线保持机位' if args.get('saved_canvas_check') else '保持原地，固定机位切近'
            return SimpleNamespace(content=json.dumps({'edits': [{**target, 'text': text}]}, ensure_ascii=False))
        if args.get('saved_canvas_check') and storyboard_recovery_fixture:
            control['saved_storyboard_check_calls'] += 1
            if 'recheck_shot_ids' in args:
                return SimpleNamespace(content='{"issues": []}')
            camera = next(card for card in args['storyboard_draft']['cards'] if card['type'] == 'direction.camera')
            return SimpleNamespace(content=json.dumps({'issues': [{'kind': 'conflict', 'shot_ids': ['front'],
                'requirements': '切近后要保持原轴线', 'suggestion': '沿原轴线保持机位',
                'repair_targets': [{'shot_id': 'front', 'design_id': camera['id'], 'field_id': 'viewpoint'}]}]}, ensure_ascii=False))
        if 'storyboard_draft' in args:
            if storyboard_recovery_fixture:
                from httpx import ReadTimeout
                if 'recheck_shot_ids' in args:
                    deadline = monotonic() + 45
                    while not control['storyboard_recheck_release'] and monotonic() < deadline:
                        sleep(.03)
                    return SimpleNamespace(content='{"issues": []}')
                control['storyboard_review_calls'] += 1
                call = control['storyboard_review_calls']
                deadline = monotonic() + 45
                while control['storyboard_review_release'] < call and monotonic() < deadline:
                    sleep(.03)
                if control['storyboard_review_fail_on'] == call or control['storyboard_review_release'] < call:
                    raise ReadTimeout('controlled review failure')
                if control['storyboard_review_conflict_on'] == call:
                    return SimpleNamespace(content=json.dumps({'issues': [{'kind': 'conflict',
                        'shot_ids': [args['storyboard_draft']['shots'][0]['id']],
                        'requirements': '静止与入场要求冲突', 'suggestion': '保留站位，仅切换景别'}]}, ensure_ascii=False))
                if control['storyboard_repair_on'] == call:
                    return SimpleNamespace(content=json.dumps({'issues': [{'kind': 'conflict', 'shot_ids': ['front'],
                        'requirements': '运镜与保持站位矛盾', 'suggestion': '固定机位',
                        'repair_targets': [{'shot_id': 'front', 'design_id': 'camera', 'field_id': 'viewpoint'}]}]}, ensure_ascii=False))
            return SimpleNamespace(content='{"issues": []}')
        if os.environ.get('CANVAS_BROWSER_STORYBOARD_SCOPE') == '1':
            from tests.directing.storyboard_scope_fixture import START, END, complex_design
            if 'organization_inputs' in args:
                result = {'shots': [{'id': 'rear', 'segments': [
                    {'id': 'take-out', 'excerpt': START, 'seconds': 9, 'ratio': '16:9'},
                    {'id': 'lift', 'excerpt': END, 'seconds': 9, 'ratio': '16:9'},
                ]}]}
            elif 'mode' in args:
                result = complex_design(args['objects'][0]['id'])
                result['designs'] = result['designs'][:6]
                result['missed_objects'].append({'id': 'box', 'kind': 'prop', 'name': '铜匣', 'excerpt': '打开铜匣'})
                result['shots'][0]['object_ids'].append('box')
                result['designs'].append({'id': 'box-continuity', 'card_type': 'direction.continuity', 'object_id': 'box',
                    'fields': {'before': {'state': 'fact', 'text': '打开铜匣', 'excerpt': '打开铜匣',
                                          'scope': {'shot_ids': ['rear'], 'occurrence_ids': ['lift'], 'phase': 'video'}},
                               'following_constraints': {'state': 'proposal', 'text': '铜匣出画后仍保持打开',
                                                         'scope': {'shot_ids': ['rear'], 'occurrence_ids': ['lift'], 'phase': 'video'}}}})
            else:
                result = {'objects': [{'kind': 'character', 'name': '林舟', 'description': '码头勘查者',
                                       'excerpt': '林舟在码头', 'asset_id': 'object-browser-character'}]}
            return SimpleNamespace(content=json.dumps(result, ensure_ascii=False))
        if args['script_text'] == '空镜。' and 'mode' not in args:
            return SimpleNamespace(content='{"objects": []}')
        assert '前门的阿同' in args['script_text']
        if os.environ.get('CANVAS_BROWSER_STORYBOARD_REEXTRACT') == '1' and '放下信封' in args['script_text']:
            revised = '前门的阿同放下信封。'
            return SimpleNamespace(content=json.dumps({'shots': [{'id': 'front', 'excerpt': revised}]}, ensure_ascii=False))
        if control.get('storyboard_structure_choices') and args.get('mode') == 'complete':
            subject = next(item['id'] for item in args['objects'] if item['kind'] == 'character')
            if '测试依据不足' in messages[-1].content:
                return SimpleNamespace(content=json.dumps({'structure_choices': [], 'reason': '镜头缺少人物出镜依据，请调整适用范围。'}))
            selected = ('"selected_option": {' in messages[-1].content
                        or '保留等待设计，仅补齐参与对象关联' in messages[-1].content)
            if len(messages) > 2 and not selected:
                return SimpleNamespace(content=json.dumps({'structure_choices': [{
                    'id': 'include-subject', 'title': '补充镜头参与对象',
                    'impact': '镜头 only 增加已准备人物，保留等待设计和镜头结构。',
                    'instruction': '将设计主体加入镜头 only 的 object_ids'}]}))
            return SimpleNamespace(content=json.dumps({'shots': [{
                'id': 'only', 'excerpt': args['script_text'], 'object_ids': [subject] if selected else [],
                'designs': [{'id': 'blocking', 'card_type': 'direction.blocking', 'object_id': subject,
                             'fields': {'position': {'state': 'proposal', 'text': '保持原地等待'}}}]}]}))
        if args.get('mode') in ('complete', 'faithful'):
            if storyboard_recovery_fixture and len(messages) == 2:
                from httpx import ConnectError
                control['storyboard_calls'] += 1
                call = control['storyboard_calls']
                deadline = monotonic() + 45
                while control['storyboard_release'] < call and monotonic() < deadline:
                    sleep(.03)
                if control['storyboard_fail_on'] == call or control['storyboard_release'] < call:
                    raise ConnectError('controlled storyboard provider failure')
            objects = {item['excerpt']: item['id'] for item in args['objects']}
            front = objects['前门的阿同']
            extra = [{'id': 'return', 'excerpt': '他绕过门廊。', 'object_ids': [front]}] if os.environ.get('CANVAS_BROWSER_STORYBOARD_REFERENCES') == '1' else []
            designs = [{'id': 'action', 'card_type': 'direction.performance', 'object_id': front,
                        'fields': {'physical_action': {'state': 'fact', 'text': '拿着信封', 'excerpt': '拿着信封'}}}]
            if os.environ.get('CANVAS_BROWSER_STORYBOARD_REEXTRACT') == '1':
                designs.append({'id': 'movement', 'card_type': 'direction.movement', 'fields': {'movement_start': {
                    'state': 'fact', 'text': '前门的阿同拿着信封。', 'excerpt': '前门的阿同拿着信封。',
                }}})
            if args['mode'] == 'complete':
                designs.append({'id': 'camera', 'card_type': 'direction.camera', 'fields': {'viewpoint': {
                    'state': 'proposal', 'text': '低机位跟拍', 'excerpt': '前门的阿同拿着信封。', 'reason': '突出手部动作',
                }}})
            missed = {'id': 'door', 'kind': 'scene', 'name': '前门', 'excerpt': '前门的阿同拿着信封。'}
            if args['mode'] == 'complete' and len(messages) == 2:
                missed = {'id': 'door', 'kind': 'character', 'name': '阿同', 'excerpt': '前门的阿同'}
            result = {'missed_objects': [missed], 'shots': [
                {'id': 'front', 'excerpt': '前门的阿同拿着信封。', 'object_ids': [front, objects['拿着信封'], 'door'], 'designs': designs},
                {'id': 'back', 'excerpt': '后门的阿同等待。', 'object_ids': [objects['后门的阿同']]},
                *extra,
            ]}
            revision = control.get('visual_continuity_revision') if storyboard_video_fixture else None
            if revision in ('source', 'target'):
                result['shots'].pop(0 if revision == 'source' else 1)
            if revision == 'design':
                result['shots'][1]['designs'] = [{'id': 'wait', 'card_type': 'direction.performance',
                    'object_id': objects['后门的阿同'], 'fields': {
                        'physical_action': {'state': 'fact', 'text': '等待', 'excerpt': '等待'},
                    }}]
            if storyboard_design_stacks:
                result['designs'] = [{'id': 'light', 'card_type': 'direction.lighting', 'fields': {
                    'light_direction': {'state': 'proposal', 'text': '保持柔和侧光', 'excerpt': '前门的阿同拿着信封。',
                                        'reason': '保持镜头衔接', 'scope': {'shot_ids': ['front', 'back']}},
                }}]
            if storyboard_design_stacks and control.get('add_storyboard_content'):
                for shot, excerpt in zip(result['shots'][:2], ('前门的阿同拿着信封。', '后门的阿同等待。'), strict=True):
                    shot.setdefault('designs', []).append({
                        'id': 'new-focus', 'card_type': 'direction.focus', 'adoption': 'dependency',
                        'fields': {'depth_focus': {'state': 'proposal', 'text': '保持主体清晰', 'excerpt': excerpt, 'reason': '方便核对动作'}},
                    })
                result['shots'].append({'id': 'look-back', 'excerpt': '阿同回头。', 'object_ids': [front]})
            return SimpleNamespace(content=json.dumps(result, ensure_ascii=False))
        if object_candidate_fixture:
            control['object_extraction_calls'] += 1
            if control['object_extraction_calls'] > 1:
                return SimpleNamespace(content=json.dumps({'objects': [
                    {'kind': 'character', 'name': '阿同', 'description': '前门等候', 'excerpt': '前门的阿同',
                     'asset_id': 'object-browser-character'},
                    {'kind': 'character', 'name': '阿同', 'description': '后门等候', 'excerpt': '后门的阿同'},
                    {'kind': 'scene', 'name': '前门', 'excerpt': '前门'},
                ]}, ensure_ascii=False))
        return SimpleNamespace(content=json.dumps({'objects': [
            {'kind': 'character', 'name': '阿同', 'description': '前门等候', 'excerpt': '前门的阿同',
             'asset_id': 'object-browser-character'},
            {'kind': 'character', 'name': '阿同', 'description': '后门等候', 'excerpt': '后门的阿同'},
            {'kind': 'prop', 'name': '信封', 'description': '手持物件', 'excerpt': '拿着信封'},
        ]}, ensure_ascii=False))

    async def astream(self, messages):
        if database_url and self.params.get('model') != model_id:
            yield SimpleNamespace(content='unrelated isolated fixture')
            return
        control['calls'].append({key: self.params.get(key) for key in ('model', 'temperature', 'base_url', 'max_retries')}
                                | {'text': messages[0].content})
        fail = control['fail_next']
        control['fail_next'] = False
        yield SimpleNamespace(content='第一段')
        while control['release_for'].get(messages[0].content, control['release']) < 1:
            await asyncio.sleep(.03)
        yield SimpleNamespace(content='第二段')
        while control['release_for'].get(messages[0].content, control['release']) < 2:
            await asyncio.sleep(.03)
        if fail:
            raise RuntimeError('controlled provider failure')
        yield SimpleNamespace(content='第三段')


    async def ainvoke(self, messages):
        data = json.loads(messages[1].content)
        if 'requirements' in data:
            control['check_calls'].append('R01')
            return SimpleNamespace(content=json.dumps({'results': [
                {'item_id': item['item_id'], 'outcome': 'conforming', 'message': '已核对历史正文',
                 'submitted_excerpt': data['output_text']} for item in data['requirements']
            ]}))
        field = data['requirement']['field_id']
        calls = control['check_calls']
        first_duration = field == 'estimated_duration' and field not in calls
        calls.append(field)
        while not control['check_release']:
            await asyncio.sleep(.03)
        if first_duration:
            return SimpleNamespace(content='malformed')
        return SimpleNamespace(content=json.dumps({
            'outcome': 'conforming', 'message': '已传入本项设计',
            'submitted_excerpt': data['requirement']['text'],
        }))


async def database():
    async with sessions() as db:
        try:
            yield db
            await db.commit()
        except Exception:
            await db.rollback()
            raise


@app.get('/test/runtime-controls')
async def read_control():
    return control


@app.post('/test/runtime-controls')
async def set_control(body: dict = Body(...)):
    if body.get('disconnect'):
        control['disconnect_epoch'] += 1
    if body.get('expire_events'):
        from sqlalchemy import delete
        from app.models.generation_canvas import CanvasEvent
        async with sessions.begin() as db:
            await db.execute(delete(CanvasEvent))
    for key in ('release', 'release_for', 'fail_next', 'duplicate_next', 'check_release'):
        if key in body:
            control[key] = body[key]
    if storyboard_video_fixture:
        for key in ('media_fail_next', 'media_hold', 'visual_continuity_revision', 'unavailable_media_key'):
            if key in body:
                control[key] = body[key]
    if storyboard_design_stacks and 'add_storyboard_content' in body:
        control['add_storyboard_content'] = body['add_storyboard_content']
    if storyboard_recovery_fixture:
        for key in ('storyboard_release', 'storyboard_fail_on', 'storyboard_review_release',
                    'storyboard_review_fail_on', 'storyboard_review_conflict_on', 'storyboard_repair_on',
                    'storyboard_repair_release', 'storyboard_recheck_release', 'storyboard_structure_choices'):
            if key in body:
                control[key] = body[key]
    return control


@asynccontextmanager
async def lifespan(_app):
    worker_module.ChatOpenAI = ControlledModel
    from app.services.generation_canvas import stream
    original_stream = stream.stream_events
    async def controlled_stream(*args, **kwargs):
        # Real persistent stream; faults live only at the HTTP transport boundary.
        control['stream_connections'] += 1
        epoch = control['disconnect_epoch']
        async for chunk in original_stream(*args, **kwargs):
            if epoch != control['disconnect_epoch']:
                return
            yield chunk
            if control['duplicate_next'] and chunk.startswith('id:'):
                control['duplicate_next'] = False
                yield chunk
    stream.stream_events = controlled_stream
    client = None
    if storyboard_video_fixture or os.environ.get('CANVAS_BROWSER_STORYBOARD_REFERENCES') == '1':
        import httpx

        async def media_provider(request):
            if storyboard_video_fixture and request.method == 'POST':
                control['media_calls'].append({'path': request.url.path, 'body': json.loads(request.content)})
                if control['media_fail_next']:
                    control['media_fail_next'] = False
                    return httpx.Response(400, json={'message': 'controlled media failure'})
            if storyboard_video_fixture and request.url.host == 'video.test':
                if request.method == 'POST':
                    while control['media_hold']:
                        await asyncio.sleep(.02)
                    return httpx.Response(200, json={'task_id': 'storyboard-video'})
                return httpx.Response(200, json={'status': 'succeeded', 'creations': [{'url': 'https://media.test/storyboard.mp4'}]})
            if storyboard_video_fixture and request.url.host == 'media.test':
                return httpx.Response(200, content=Path(storyboard_video_fixture).read_bytes(),
                                      headers={'Content-Type': 'video/mp4'})
            assert request.method == 'POST' and request.url.host == 'fixture.test'
            return httpx.Response(200, json={'data': [{'b64_json': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII='}]})

        client = httpx.AsyncClient(transport=httpx.MockTransport(media_provider))
    # A held provider request occupies the one real submit slot, leaving another task queued.
    worker = TaskWorker(sessions, client=client, limits=WorkerLimits(submit=1) if storyboard_video_fixture else None)
    async def tick():
        while True:
            await worker.tick()
            await asyncio.sleep(.05)
    runner = asyncio.create_task(tick())
    def report_worker_failure(future):
        if not future.cancelled() and future.exception():
            import traceback
            traceback.print_exception(future.exception())
            control['worker_error'] = str(future.exception())
    runner.add_done_callback(report_worker_failure)
    try:
        yield
    finally:
        runner.cancel()
        for job in worker.jobs.values():
            job.cancel()
        await asyncio.gather(runner, *list(worker.jobs.values()), return_exceptions=True)
        worker.text_pool.shutdown(wait=False)
        if client is not None:
            await client.aclose()
        await engine.dispose()


async def prepare():
    from app.bootstrap import bootstrap_all_registries
    bootstrap_all_registries()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as db:
        db.add(Project(id=project_id, name='文本流画布项目', style='真人都市'))
        db.add(Provider(id=provider_id, provider_key='openai', name=provider_id, api_key='fixture-private', base_url='https://fixture.test/v1'))
        await db.flush()
        db.add(Model(id=model_id, name=model_id if database_url else 'controlled-text', provider_id=provider_id, category='text', params={'temperature': 0.2}))
        if storyboard_video_fixture or storyboard_design_stacks or os.environ.get('CANVAS_BROWSER_STORYBOARD_REEXTRACT') == '1':
            db.add(Provider(id='story-video-provider', provider_key='vidu', name='vidu', api_key='test', base_url='https://video.test'))
            await db.flush()
            db.add(Model(id='story-video-model', name='viduq2', category='video', provider_id='story-video-provider'))
        if os.environ.get('CANVAS_BROWSER_SCENE_OBJECTS') == '1':
            from base64 import b64decode
            from app.models.llm import ModelSettings
            from app.models.studio import Character, CharacterImage, FileItem
            await db.flush()
            image_model = None
            if os.environ.get('CANVAS_BROWSER_SCENE_STORYBOARD') == '1':
                image_model = 'story-image-model'
                db.add(Model(id=image_model, name='分镜测试图片模型', provider_id=provider_id, category='image'))
                await db.flush()
            if os.environ.get('CANVAS_BROWSER_STORYBOARD_SCOPE') == '1':
                db.add(Provider(id='scope-browser-vidu', provider_key='vidu', name='Scope video', api_key='fixture', base_url='https://fixture.test/v1'))
                await db.flush()
                db.add(Model(id='scope-browser-video', name='viduq2', provider_id='scope-browser-vidu', category='video'))
            db.add(ModelSettings(id=1, default_text_model_id=model_id, default_image_model_id=image_model))
            db.add(Character(id='object-browser-character', project_id=project_id, name='已有角色', style='真人都市'))
            db.add(FileItem(id='object-browser-image', type='image', name='已有角色图片', storage_key='fixture/asset.png',
                            content_type='image/png'))
            await db.flush()
            db.add(CharacterImage(character_id='object-browser-character', file_id='object-browser-image'))
            Path(os.environ['CANVAS_BROWSER_MEDIA_STORAGE'], 'asset.png').write_bytes(b64decode(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII='))

    # Bootstrap and Uvicorn run on separate loops; no pooled MySQL connection may cross them.
    await engine.dispose()


if __name__ == '__main__':
    if os.environ.get('CANVAS_BROWSER_MEDIA_STORAGE'):
        from app.core import storage
        media_dir = Path(os.environ['CANVAS_BROWSER_MEDIA_STORAGE'])
        media_dir.mkdir(parents=True, exist_ok=True)
        def object_path(key):
            return media_dir / (key if key.startswith('generated/') else Path(key).name)

        async def upload_file(*, key, data, **kwargs):
            """只替换外部对象存储 I/O，保留真实文件路由及服务。"""
            path = object_path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data if isinstance(data, bytes) else data.read())

        def readable_path(key, operation):
            path = object_path(key)
            if key == control.get('unavailable_media_key') or not path.exists():
                raise ClientError({'Error': {'Code': 'NoSuchKey'}}, operation)
            return path

        async def download_file(*, key):
            return readable_path(key, 'GetObject').read_bytes()

        storage.upload_file = upload_file
        storage.download_file = download_file
        from botocore.exceptions import ClientError

        async def get_file_info(*, key):
            path = readable_path(key, 'HeadObject')
            return storage.StoredFileInfo(key=key, url='', size=path.stat().st_size,
                content_type='video/mp4' if path.suffix == '.mp4' else 'image/png')

        storage.get_file_info = get_file_info
    asyncio.run(prepare())
    app.router.lifespan_context = lifespan
    app.dependency_overrides[get_db] = database
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('CANVAS_BROWSER_PORT', '8276')),
                timeout_graceful_shutdown=5)
