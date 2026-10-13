"""导出授权经真实 HTTP 固定已保存整场内容，重复请求不增加任务。"""
import asyncio
import json
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Thread
from copy import deepcopy
from uuid import uuid4
from urllib.parse import urlparse, parse_qs
from xml.sax.saxutils import escape

import pytest

from app.models.directing import Sequence
from app.models.studio import FileItem, FileUsage
from sqlalchemy import select, delete
from app.models.task import TaskInput, TaskOutput
from app.services.task_service import TaskService, utcnow
from app.task_worker import TaskWorker
from app.services.directing.store import DirectingStore
from tests.directing.samples import SOURCE, design_sample, plan_sample
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database, frozen, output


@pytest.fixture
def export_storage(monkeypatch):
    from app.config import settings
    objects, uploading, release = {}, Event(), Event()
    release.set()

    class Handler(BaseHTTPRequestHandler):
        def do_HEAD(self):
            value = objects.get(self.path)
            self.send_response(objects.get('__head_status__', 404 if value is None else 200))
            self.send_header('Content-Length', str(len(value) if value else 0))
            self.send_header('Content-Type', 'video/mp4')
            self.end_headers()

        def do_DELETE(self):
            objects.pop(self.path, None)
            self.send_response(204)
            self.end_headers()

        def do_GET(self):
            query = parse_qs(urlparse(self.path).query)
            if query.get('list-type') == ['2']:
                prefix = query.get('prefix', [''])[0]
                entries = ''.join(f'<Contents><Key>{escape(key[len("/scene-test/"):])}</Key>'
                    f'<LastModified>2000-01-01T00:00:00Z</LastModified><Size>{len(value)}</Size></Contents>'
                    for key, value in objects.items() if key.startswith('/scene-test/' + prefix))
                data = f'<ListBucketResult><IsTruncated>false</IsTruncated>{entries}</ListBucketResult>'.encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Content-Type', 'application/xml')
                self.end_headers()
                self.wfile.write(data)
                return
            value = objects.get(self.path)
            self.send_response(objects.get('__get_status__', 404 if value is None else 200))
            self.send_header('Content-Length', str(len(value) if value else 0))
            self.send_header('Content-Type', 'video/mp4')
            self.end_headers()
            if value:
                self.wfile.write(value)

        def do_PUT(self):
            value = self.rfile.read(int(self.headers['Content-Length']))
            uploading.set()
            if not release.wait(15):
                self.send_error(500)
                return
            objects[self.path] = value
            self.send_response(200)
            self.send_header('Content-Length', '0')
            self.end_headers()

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    for name, value in {'s3_endpoint_url': f'http://127.0.0.1:{server.server_port}',
            's3_bucket_name': 'scene-test', 's3_base_path': '', 's3_addressing_style': 'path',
            's3_access_key_id': 'fixture', 's3_secret_access_key': 'fixture'}.items():
        monkeypatch.setattr(settings, name, value)
    try:
        yield objects, uploading, release
    finally:
        release.set()
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.asyncio
@pytest.mark.parametrize('size', [1080, 720])
@pytest.mark.parametrize('execution', ['success', 'cancel_upload', 'corrupt', 'missing'])
async def test_export_freezes_saved_cut_and_blocks_copy_until_terminal(tmp_path, export_storage, execution, size):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '导出'})).json()['data']
        detail = path + '/versions/' + version['id']
        request = {'request_id': str(uuid4()), 'expected_revision': 1, 'size': size}
        assert (await client.post(detail + '/exports', json=request)).status_code == 422
        async with sessions.begin() as db:
            store = DirectingStore(db, 'p1')
            design = await frozen(store, path.rsplit('/', 1)[1], 'design', design_sample())
            plan = await frozen(store, design.sequence_id, 'plan', plan_sample(design.id))
            prompt = await frozen(store, design.sequence_id, 'prompt', {'plan_revision_id': plan.id, 'unit_id': 'u1',
                'format_version': 'fixture', 'text': '旧素材', 'sources': [SOURCE], 'decisions': []})
            await output(db, prompt.id)
            take = await store.register_take(prompt_revision_id=prompt.id, task_id='task1', output_ordinal=0)
            take_id = take.id
        content = deepcopy(version['content'])
        content['timeline']['items'] = [{'kind': 'media', 'id': 'clip', 'take_kind': 'production_plan', 'take_id': take_id,
            'file_id': 'video1', 'media_range': {'source_in_ms': 1000, 'source_out_ms': 2000}, 'timeline_start_ms': 500, 'fit': 'cover'}]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        saved = saved.json()['data']
        request['expected_revision'] = saved['revision']
        assert (await client.post(detail + '/exports', json=request)).status_code == 422
        assert (await client.get(detail + '/exports')).json()['data'] == []
        objects, uploading, release = export_storage
        source = tmp_path / 'source.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x90:r=25:d=2',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(source)], check=True)
        async with sessions() as db:
            source_key = '/scene-test/' + (await db.get(FileItem, 'video1')).storage_key
        objects[source_key] = source.read_bytes()
        response = await client.post(detail + '/exports', json=request)
        assert response.status_code == 200, response.text
        task = response.json()['data']
        assert task['status'] == 'queued' and task['file_id'] is None
        foreign_detail = detail.replace('/projects/p1/', '/projects/foreign/')
        assert foreign_detail != detail
        assert (await client.get(foreign_detail + '/exports')).status_code == 422
        assert (await client.post(foreign_detail + '/exports', json=request)).status_code == 422
        assert (await client.post(foreign_detail + '/exports/' + task['task_id'] + '/retry', json={'request_id': str(uuid4())})).status_code == 422
        assert task['snapshot']['content'] == saved['content']
        assert task['snapshot']['profile'] == {'size': size, 'width': size * 16 // 9, 'height': size, 'fps': 30, 'video_codec': 'h264', 'audio_codec': 'aac', 'container': 'mp4'}
        assert (await client.post(detail + '/exports', json=request)).json()['data']['task_id'] == task['task_id']
        assert (await client.post(detail + '/exports', json={**request, 'expected_revision': 1})).status_code == 409
        assert (await client.post(detail + '/exports', json={**request, 'size': 720 if size == 1080 else 1080})).status_code == 409
        assert (await client.get(detail + '/copy-readiness')).json()['data']['ready'] is False
        async with sessions() as db:
            assert list(await db.scalars(select(TaskInput.file_id).where(TaskInput.task_id == task['task_id']))) == ['video1']
        deletion = await client.delete('/api/v1/studio/files/video1')
        assert deletion.status_code == 409
        content['output_aspect_ratio'] = '1:1'
        changed = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'content': content})
        assert changed.status_code == 200, changed.text
        records = (await client.get(detail + '/exports')).json()['data']
        assert len(records) == 1 and records[0]['snapshot']['content'] == saved['content']
        assert (await client.post(detail + '/exports', json={**request, 'request_id': str(uuid4()), 'expected_revision': changed.json()['data']['revision']})).status_code == 409

        async with sessions.begin() as db:
            file = await db.get(FileItem, 'video1')
            file.width = file.height = 9999  # Nominal metadata must not replace measured media dimensions.
            source_key = '/scene-test/' + file.storage_key
            objects[source_key] = b'corrupted' if execution == 'corrupt' else source.read_bytes()
            assert await TaskService(db).claim(task['task_id'], worker_id='export-test')
        tasks = (await client.get('/api/v1/film/tasks', params={'project_id': 'p1'})).json()['data']['items']
        listed = next(row for row in tasks if row['task_id'] == task['task_id'])
        assert listed['source']['version_id'] == version['id']
        assert listed['source']['id'] == path.rsplit('/', 1)[1]
        inspect_body = {'timeline': content['timeline'], 'output_aspect_ratio': '9:16', 'size': size}
        inspected = await client.post(detail + '/export-inspection', json=inspect_body)
        if execution != 'corrupt':
            assert inspected.status_code == 200, inspected.text
            measured = inspected.json()['data']['clips'][0]
            assert measured['source_width'] == 160 and measured['source_height'] == 90
            assert measured['needs_upscale'] is True
            assert measured['effective_width'] == pytest.approx(50.625)
            assert inspected.json()['data']['profile']['width'] == size
        else:
            assert inspected.status_code == 422
        if execution == 'missing':
            objects.pop(source_key)
            assert (await client.post(detail + '/export-inspection', json=inspect_body)).status_code == 422
        worker = TaskWorker(sessions)
        if execution == 'cancel_upload':
            release.clear()
        running = asyncio.create_task(worker._execute(task['task_id']))
        try:
            if execution == 'cancel_upload':
                assert await asyncio.to_thread(uploading.wait, 10)
                async with sessions.begin() as db:
                    cancelled = await TaskService(db).request_cancel(task['task_id'])
                    assert cancelled.status == 'running'
                assert (await client.get(detail + '/copy-readiness')).json()['data']['ready'] is False
                release.set()
            await running
        finally:
            release.set()
            await running
            worker.text_pool.shutdown(wait=True)
        final = (await client.get(detail + '/exports')).json()['data'][0]
        assert (await client.get(detail + '/copy-readiness')).json()['data']['ready'] is True
        if execution == 'success':
            assert final['status'] == 'succeeded', final
            download = await client.get(final['download_url'])
            assert download.status_code == 200, download.text[:100] if download.status_code != 200 else ''
            exported = tmp_path / 'download.mp4'
            exported.write_bytes(download.content)
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(exported)]))
            video = next(row for row in probe['streams'] if row['codec_type'] == 'video')
            assert (video['width'], video['height'], video['r_frame_rate']) == (size * 16 // 9, size, '30/1')
            assert video['codec_name'] == 'h264'
            assert abs(float(video['duration']) - 1.5) < 0.04
            async with sessions.begin() as db:
                assert (await TaskService(db).request_cancel(task['task_id'])).status == 'succeeded'
            assert (await client.get(detail + '/exports')).json()['data'][0]['file_id'] == final['file_id']
            objects['__head_status__'] = 403
            uncertain = (await client.get(detail + '/exports')).json()['data'][0]
            assert uncertain['status'] == 'succeeded' and uncertain['file_status'] == 'unknown'
            assert uncertain['download_url'] is None and uncertain['file_id'] == final['file_id']
            objects.pop('__head_status__')
            export_key = '/scene-test/generated/' + task['task_id'] + '/export.mp4'
            original_bytes = objects.pop(export_key)
            missing_file = (await client.get(detail + '/exports')).json()['data'][0]
            assert missing_file['status'] == 'succeeded' and missing_file['file_status'] == 'unavailable'
            objects[export_key] = original_bytes
            assert (await client.get(detail + '/exports')).json()['data'][0]['file_status'] == 'available'
            second = await client.post(detail + '/exports', json={'request_id': str(uuid4()),
                'expected_revision': changed.json()['data']['revision'], 'size': 720})
            assert second.status_code == 200, second.text
            second = second.json()['data']
            async with sessions.begin() as db:
                assert await TaskService(db).claim(second['task_id'], worker_id='second-export')
            second_worker = TaskWorker(sessions)
            try:
                await second_worker._execute(second['task_id'])
            finally:
                second_worker.text_pool.shutdown(wait=True)
            second = next(row for row in (await client.get(detail + '/exports')).json()['data'] if row['task_id'] == second['task_id'])
            assert second['status'] == 'succeeded' and second['file_id'] != final['file_id']
            assert (await client.get(final['download_url'])).content == original_bytes
            third_response = await client.post(detail + '/exports', json={'request_id': str(uuid4()),
                'expected_revision': changed.json()['data']['revision'], 'size': 720})
            assert third_response.status_code == 200, third_response.text
            third = third_response.json()['data']
            async with sessions.begin() as db:
                assert await TaskService(db).claim(third['task_id'], worker_id='cancelled-export')
            uploading.clear()
            release.clear()
            cancelled_worker = TaskWorker(sessions)
            cancelling_render = asyncio.create_task(cancelled_worker._execute(third['task_id']))
            try:
                assert await asyncio.to_thread(uploading.wait, 10)
                async with sessions.begin() as db:
                    assert (await TaskService(db).request_cancel(third['task_id'])).status == 'running'
                release.set()
                await cancelling_render
            finally:
                release.set()
                await cancelling_render
                cancelled_worker.text_pool.shutdown(wait=True)
            orphan_key = '/scene-test/generated/' + third['task_id'] + '/export.mp4'
            assert orphan_key in objects
            from app.services.file_cleanup import FileCleaner
            cleaner = FileCleaner(sessions)
            await cleaner.run_once()
            await cleaner.run_once()
            assert orphan_key not in objects
            assert objects[source_key] == source.read_bytes()
            assert (await client.get(final['download_url'])).content == original_bytes
            assert (await client.get(second['download_url'])).status_code == 200
            retained = (await client.get(detail + '/exports')).json()['data']
            assert len(retained) == 3
            cancelled_record = next(row for row in retained if row['task_id'] == third['task_id'])
            assert cancelled_record['status'] == 'cancelled' and cancelled_record['file_id'] is None

        else:
            assert final['status'] == ('cancelled' if execution == 'cancel_upload' else 'failed'), final
            assert final['file_id'] is None and final['download_url'] is None
            async with sessions() as db:
                assert await db.get(TaskOutput, (task['task_id'], 0)) is None
            if execution in ['corrupt', 'missing']:
                assert 'clip' in final['error']
        if execution != 'missing':
            assert objects[source_key] == (b'corrupted' if execution == 'corrupt' else source.read_bytes())

        if execution in ['corrupt', 'missing']:
            rejected = await client.post(detail + '/exports/' + task['task_id'] + '/retry', json={'request_id': str(uuid4())})
            assert rejected.status_code == 422, rejected.text
            assert 'clip' in rejected.text
            assert len((await client.get(detail + '/exports')).json()['data']) == 1
            objects[source_key] = source.read_bytes()
            objects['__get_status__'] = 403
            try:
                inaccessible = await client.post(detail + '/exports/' + task['task_id'] + '/retry', json={'request_id': str(uuid4())})
                assert inaccessible.status_code == 422 and 'clip' in inaccessible.text
            finally:
                objects.pop('__get_status__')
            async with sessions.begin() as db:
                (await db.get(FileItem, 'video1')).delete_requested_at = utcnow()
            deleted_source = await client.post(detail + '/exports/' + task['task_id'] + '/retry', json={'request_id': str(uuid4())})
            assert deleted_source.status_code == 422 and 'clip' in deleted_source.text
            assert (await client.post(detail + '/exports', json=request)).json()['data']['task_id'] == task['task_id']
            assert len((await client.get(detail + '/exports')).json()['data']) == 1
            async with sessions.begin() as db:
                (await db.get(FileItem, 'video1')).delete_requested_at = None
        if execution == 'cancel_upload':
            retry_request = {'request_id': str(uuid4())}
            retry_url = detail + '/exports/' + task['task_id'] + '/retry'
            retry = await client.post(retry_url, json=retry_request)
            assert retry.status_code == 200, retry.text
            retry = retry.json()['data']
            assert retry['snapshot'] == task['snapshot']
            assert retry['retry_of_task_id'] == task['task_id']
            assert (await client.post(retry_url, json=retry_request)).json()['data']['task_id'] == retry['task_id']
            assert (await client.post(detail + '/exports', json={**request, **retry_request})).status_code == 409
            assert (await client.get(detail + '/copy-readiness')).json()['data']['ready'] is False

        async with sessions.begin() as db:
            (await db.get(Sequence, version['sequence_id'])).is_current = False
        assert (await client.post(detail + '/exports', json=request)).json()['data']['task_id'] == task['task_id']
        assert (await client.post(detail + '/exports', json={**request, 'request_id': str(uuid4())})).status_code == 409
        if execution == 'success':
            assert (await client.get(final['download_url'])).status_code == 200
            file_url = detail + '/exports/' + task['task_id'] + '/file'
            async with sessions.begin() as db:
                db.add(FileUsage(file_id=final['file_id'], project_id='p1', usage_kind='directing_reference', source_ref='other-business'))
            assert (await client.delete(file_url)).status_code == 409
            async with sessions.begin() as db:
                own_usage = await db.scalar(select(FileUsage.id).where(FileUsage.file_id == final['file_id'], FileUsage.source_ref == 'scene-export:' + task['task_id']))
                assert own_usage is not None  # Rejected deletion must roll back the export ownership unlink.
                await db.execute(delete(FileUsage).where(FileUsage.file_id == final['file_id'], FileUsage.source_ref == 'other-business'))
            removed = await client.delete(file_url)
            assert removed.status_code == 200, removed.text
            removed = removed.json()['data']
            assert removed['status'] == 'succeeded' and removed['file_status'] == 'unavailable'
            assert removed['file_id'] == final['file_id'] and removed['download_url'] is None
            assert (await client.delete(file_url)).json()['data'] == removed
            assert (await client.get(final['download_url'])).status_code == 410
            from app.services.file_cleanup import FileCleaner
            await FileCleaner(sessions)._delete_requested()
            assert export_key not in objects
            assert objects[source_key] == source.read_bytes()
            assert (await client.get(second['download_url'])).status_code == 200
            assert len((await client.get(detail + '/exports')).json()['data']) == 3

        elif execution == 'cancel_upload':
            assert (await client.post(retry_url, json=retry_request)).json()['data']['task_id'] == retry['task_id']
            assert (await client.post(retry_url, json={'request_id': str(uuid4())})).status_code == 409
