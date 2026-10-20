"""浏览器验收使用的真实 API 与独立临时数据库，不连接用户项目数据库。"""

import asyncio
import os
from pathlib import Path
from hashlib import sha256
import mimetypes
import subprocess
import json

import httpx

# 对象存储只指向此隔离服务；不继承开发机的远程桶或凭据。
os.environ.update({
    'S3_ENDPOINT_URL': f"http://127.0.0.1:{os.environ['SCENE_BROWSER_TEST_PORT']}/browser-test-storage",
    'S3_BUCKET_NAME': 'scene-test', 'S3_ACCESS_KEY_ID': 'fixture', 'S3_SECRET_ACCESS_KEY': 'fixture',
    'S3_REGION_NAME': 'us-east-1', 'S3_ADDRESSING_STYLE': 'path', 'S3_BASE_PATH': '',
    'S3_PUBLIC_BASE_URL': '', 'AWS_REQUEST_CHECKSUM_CALCULATION': 'when_required',
})

import uvicorn
from fastapi import HTTPException, Request, Response
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.studio import Chapter, Project, FileItem
from app.models.llm import Model, ModelSettings, Provider
from app.models.task import Task, TaskOutput
from app.services.generation.media_execution import deliver_media, store_media_output
from app.core.integrations.media_provider import MediaResult
from app.services.task_service import TaskService
from copy import deepcopy
from app.services.directing.store import DirectingStore
from tests.directing.samples import SOURCE, design_sample, plan_sample
from tests.directing.test_store import frozen


engine = create_async_engine('sqlite+aiosqlite:///' + os.environ['SCENE_BROWSER_TEST_DATABASE'])
sessions = async_sessionmaker(engine, expire_on_commit=False)


async def request_db():
    """每个浏览器请求独立提交，刷新通过 HTTP 重读实际落盘内容。"""
    async with sessions.begin() as db:
        yield db


async def prepare():
    """只在新建的测试库中准备项目、章节和空场次。"""
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as db:
        db.add(Provider(id='browser-text-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
        await db.flush()
        db.add(Model(id='browser-video-model', name='test-video-model', category='video', provider_id='browser-text-provider', params={}))
        db.add(Model(id='browser-text-model', name='test-design-model', category='text', provider_id='browser-text-provider', params={}))
        await db.flush()
        db.add(ModelSettings(id=1, default_text_model_id='browser-text-model'))
        db.add(Project(id='canvas-project', name='画布验收', style='真人都市'))
        await db.flush()
        db.add(Chapter(id='canvas-chapter', project_id='canvas-project', index=1,
                       title='旧信', raw_text='他把旧信放在桌上，她缓缓抬头。'))
        await db.flush()
        store = DirectingStore(db, 'canvas-project')
        sequence = await store.create_sequence(chapter_id='canvas-chapter', title='旧信重逢', position=0)
        design = await frozen(store, sequence.id, 'design', design_sample('dialogue'))
        plan = await frozen(store, sequence.id, 'plan', plan_sample(design.id))
        if os.environ.get('SCENE_BROWSER_TEST_LEGACY_TAKE') == '1':
            # 初始既有生产记录只作为夹具；后续预览与方案判断走真实公开接口。
            prompt = await frozen(store, sequence.id, 'prompt', {'plan_revision_id': plan.id, 'unit_id': 'u1',
                'format_version': 'fixture', 'text': '旧生产计划的固定拍摄指令', 'sources': [SOURCE], 'decisions': []})
            seconds = int(os.environ.get('SCENE_BROWSER_TEST_LEGACY_DURATION', '2'))
            media = object_path('files/legacy-take.mp4')
            media.parent.mkdir(parents=True, exist_ok=True)
            frame_filter = ['-vf', 'drawbox=x=0:y=0:w=40:h=90:color=red:t=fill,drawbox=x=120:y=0:w=40:h=90:color=blue:t=fill'] if os.environ.get('SCENE_BROWSER_TEST_LEGACY_FRAMING') == '1' else []
            audio_input = ['-f', 'lavfi', '-i', f'sine=frequency=440:duration={seconds}', '-c:a', 'aac'] if os.environ.get('SCENE_BROWSER_TEST_LEGACY_AUDIO') == '1' else []
            await asyncio.to_thread(subprocess.run, ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                f'color=c=green:s=160x90:r=25:d={seconds}', *audio_input, *frame_filter, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart', '-y', str(media)], check=True, capture_output=True, timeout=30)
            db.add(FileItem(id='legacy-take-file', type='video', name='既有生产素材', storage_key='files/legacy-take.mp4', duration_ms=seconds * 1000))
            db.add(Task(id='legacy-video-task', kind='video', project_id='canvas-project', status='succeeded', input_snapshot={'prompt_revision_id': prompt.id}))
            await db.flush()
            db.add(TaskOutput(task_id='legacy-video-task', ordinal=0, file_id='legacy-take-file'))
            await db.flush()
            await store.register_take(prompt_revision_id=prompt.id, task_id='legacy-video-task', output_ordinal=0)


def object_path(key: str) -> Path:
    """外部 S3 边界的磁盘夹具，仅允许测试临时目录中的对象。"""
    root = Path(os.environ['SCENE_BROWSER_TEST_DATABASE']).parent / 'objects'
    path = (root / key).resolve()
    if not path.is_relative_to(root.resolve()):
        raise HTTPException(status_code=400, detail='Invalid fixture key')
    return path


@app.put('/browser-test-storage/scene-test/{key:path}')
async def put_object_fixture(key: str, request: Request):
    """真实上传接口仍经过 boto3 HTTP；只替代外部对象存储，不替代业务服务。"""
    path = object_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = await request.body()
    path.write_bytes(data)
    path.with_name(path.name + '.metadata.json').write_text(json.dumps({
        'content-type': request.headers.get('content-type', 'application/octet-stream'),
        **{key: value for key, value in request.headers.items() if key.startswith('x-amz-meta-')},
    }))
    return Response(headers={'ETag': '"' + sha256(data).hexdigest() + '"'})


@app.api_route('/browser-test-storage/scene-test/{key:path}', methods=['GET', 'HEAD'])
async def get_object_fixture(key: str):
    """返回真实图片／媒体字节，供应用下载与浏览器解码核对。"""
    path = object_path(key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail='Fixture object not found')
    metadata_path = path.with_name(path.name + '.metadata.json')
    headers = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
    return Response(path.read_bytes(), headers=headers, media_type=headers.get('content-type') or mimetypes.guess_type(key)[0] or 'application/octet-stream')


@app.post('/browser-test/design-tasks/{task_id}/complete')
async def complete_design_fixture(task_id: str, remove_shot_id: str | None = None, relations: bool = False,
                                  incomplete: bool = False, empty_row: bool = False):
    """仅测试服务提供工作器结果夹具；验证 UI 消费真实任务，不测试外部模型质量。"""
    async with sessions.begin() as db:
        task = await db.get(Task, task_id)
        assert task and task.project_id == 'canvas-project' and task.input_snapshot.get('scene_design')
        args = task.input_snapshot['run_args']
        result = deepcopy(args['previous_design'])
        target = result
        parts = (args.get('design_scope') or ['/direction/viewpoint'])[0].strip('/').split('/')
        for part in parts[:-1]:
            target = target[int(part)] if isinstance(target, list) else target[part]
        target[parts[-1]] = {'state': 'proposal', 'text': '从她停顿的目光展开整场',
            'sources': [{'kind': 'model', 'reference': args['task_identity'], 'version': '1'}]}
        if relations:
            shot_id = result['direction']['shots'][0]['id']
            camera_id = result['cinematography'][0]['id']
            result['applicability'].append({'subject': {'kind': 'camera', 'id': camera_id, 'field': 'composition'},
                'purpose': 'design', 'scope': 'shots', 'shot_ids': [shot_id]})
            result['applicability'].append({'subject': {'kind': 'prompt', 'field': 'prohibitions'},
                'purpose': 'constraint', 'scope': 'scene_rule', 'phase': 'video'})
            result['criteria'].append({'id': 'ai-orphan-criterion', 'requirement':
                {'state': 'proposal', 'text': '观察手指是否迟疑',
                 'sources': [{'kind': 'model', 'reference': args['task_identity'], 'version': '1'}]}})
        if remove_shot_id is not None:
            result['direction']['shots'] = [shot for shot in result['direction']['shots'] if shot['id'] != remove_shot_id]
        service = TaskService(db)
        assert await service.claim(task_id, worker_id='browser-result-fixture')
        if incomplete:
            from types import SimpleNamespace
            from app.services.directing.ai import DirectingOutputError, generate_directing_result
            if not result['participants']:
                result['participants'] = [{'id': 'participant-incomplete', 'name': '路人'}]
            activity = {name: {} for name in ('depth', 'ongoing_task', 'path', 'attention', 'reaction_delay',
                'intensity', 'entrances_exits', 'narrative_support', 'end_state')}
            activity.update(id='activity-incomplete', participant_id=result['participants'][0]['id'],
                ongoing_task={'state': 'proposal', 'text': '在门口等待', 'sources': [
                    {'kind': 'model', 'reference': args['task_identity'], 'version': '1'}]})
            if empty_row:
                activity['ongoing_task'] = {}
            result['staging']['activities'].append(activity)
            try:
                generated = generate_directing_result('directing_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(
                    content=json.dumps(result, ensure_ascii=False))), args)
            except DirectingOutputError as error:
                assert error.diagnostics is not None
                await service.finish(task_id, error=str(error), result={
                    'design_diagnostics': error.diagnostics.model_dump(mode='json')})
                return {'completed': True}
            await service.finish(task_id, result=generated.model_dump(mode='json'))
            return {'completed': True}
        await service.finish(task_id, result=result)
    return {'completed': True}


@app.post('/browser-test/instruction-tasks/{task_id}/complete')
async def complete_instruction_fixture(task_id: str, text: str = '固定中景，手指拆开信封，人物抬眼看向门口。'):
    """模型边界夹具完成真实指令任务，不代表供应商质量验收。"""
    async with sessions.begin() as db:
        task = await db.get(Task, task_id)
        assert task and task.project_id == 'canvas-project' and task.kind == 'directing_instruction'
        service = TaskService(db)
        assert await service.claim(task_id, worker_id='browser-instruction-fixture')
        await service.finish(task_id, result={'unit_id': task.input_snapshot['scene_instruction']['unit_id'],
            'text': text})
    return {'completed': True}


@app.post('/browser-test/instruction-checks/{task_id}/complete')
async def complete_check_fixture(task_id: str, outcome: str = 'pass'):
    """外部模型结果夹具；真实任务事务仍负责领取与完成。"""
    async with sessions.begin() as db:
        task = await db.get(Task, task_id)
        assert task and task.project_id == 'canvas-project' and task.kind == 'directing_instruction_check'
        unit = task.input_snapshot['run_args']['inputs']['unit']
        args = task.input_snapshot['run_args']
        scope = args['inputs'].get('scope') or {}
        result = {'unit_id': unit['id'], 'rows': [{'role': role, 'occurrence_id': item['id'], 'verdict': 'pass', 'rationale': '检查夹具：动作表达一致', 'findings': []}
            for role in ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt'] for item in unit['coverage']],
            'destinations': [{'owner': use['owner'], 'field': use['field'],
                'coverage_item_ids': use['coverage_item_ids'], 'destination': 'instruction',
                'instruction_excerpt': args['instruction'], 'rationale': '检查夹具：本次正文覆盖'}
                for use in [*scope.get('execution', []), *scope.get('constraints', [])]
                if use['phase'] == 'video' and use['text'].strip()]}
        service = TaskService(db)
        assert await service.claim(task_id, worker_id='browser-check-fixture')
        assert outcome in {'pass', 'revise', 'failed', 'cancelled'}
        if outcome in {'failed', 'cancelled'}:
            await service.finish(task_id, error='检查夹具：供应商失败' if outcome == 'failed' else None, cancelled=outcome == 'cancelled')
        else:
            if outcome == 'revise':
                result['rows'][0]['verdict'] = 'revise'
                result['rows'][0]['rationale'] = '检查夹具：需修改动作表达'
            await service.finish(task_id, result=result)
    return {'completed': True}


@app.post('/browser-test/video-tasks/{task_id}/start')
async def start_video_fixture(task_id: str):
    """模拟外部执行开始，保留运行窗口供真实取消接口登记意图。"""
    async with sessions.begin() as db:
        task = await db.get(Task, task_id)
        assert task and task.project_id == 'canvas-project' and task.target_type == 'scene_video'
        assert await TaskService(db).claim(task_id, worker_id='browser-video-fixture')
    return {'started': True}


@app.post('/browser-test/video-tasks/{task_id}/finish-cancellation')
async def finish_video_cancellation_fixture(task_id: str):
    """模拟执行器结束；统一终结规则决定取消状态，不直接修改 Task。"""
    async with sessions.begin() as db:
        task = await db.get(Task, task_id)
        assert task and task.project_id == 'canvas-project' and task.target_type == 'scene_video'
        assert task.status == 'running' and task.cancel_requested_at is not None
        await TaskService(db).finish(task_id, cancelled=True)
    return {'completed': True}


@app.post('/browser-test/video-tasks/{task_id}/complete')
async def complete_video_fixture(task_id: str, outcome: str = "succeeded"):
    """外部视频 URL 夹具；真实下载、S3 上传、测量及完成事务登记候选。"""
    async with sessions.begin() as db:
        task = await db.get(Task, task_id)
        assert task and task.project_id == 'canvas-project' and task.target_type == 'scene_video'
        assert await TaskService(db).claim(task_id, worker_id='browser-video-fixture')
        assert outcome in {'succeeded', 'failed'}
        if outcome == 'failed':
            await TaskService(db).finish(task_id, error='视频供应商返回失败')
            return {'completed': True}
    # 与预计五秒不同的真实两秒视频，防止把计划时长当作实测结果。
    path = object_path(f'provider/{task_id}.mp4')
    path.parent.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(subprocess.run, ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
        'color=c=blue:s=160x90:r=25:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', '-y', str(path)], check=True, capture_output=True, timeout=30)
    output = MediaResult(url=f"http://127.0.0.1:{os.environ['SCENE_BROWSER_TEST_PORT']}/browser-test-storage/scene-test/provider/{task_id}.mp4")
    async with httpx.AsyncClient() as client:
        await store_media_output(sessions, client, task_id=task_id, ordinal=0, kind='video_generation', output=output)
        await store_media_output(sessions, client, task_id=task_id, ordinal=0, kind='video_generation', output=output)
    async with sessions.begin() as db:
        await TaskService(db).finish(task_id, deliver=deliver_media)
    return {'completed': True}


@app.post('/browser-test/exports/{task_id}/run')
async def run_export(task_id: str):
    """执行真实本地渲染与对象存储，不能用成功夹具代替成片。"""
    from app.task_worker import TaskWorker
    async with sessions.begin() as db:
        assert await TaskService(db).claim(task_id, worker_id='browser-export-worker')
    worker = TaskWorker(sessions)
    try:
        await worker._execute(task_id)
    finally:
        worker.text_pool.shutdown(wait=True)
    return {'executed': True}


if __name__ == '__main__':
    asyncio.run(prepare())
    app.dependency_overrides[get_db] = request_db
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ['SCENE_BROWSER_TEST_PORT']),
                log_level='warning')
