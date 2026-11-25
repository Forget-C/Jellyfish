"""实验室统一任务路由的事务边界与路径绑定测试。"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.api.v1.routes.studio import lab_generation_tasks as route
from app.core.contracts.generation import (
    GenerationSubmitRequest,
    ImageGenerationOperationInput,
    VideoGenerationOperationInput,
)
from app.models.experiment_sessions import ExperimentMessage
from app.services.generation.submission import GenerationAccepted
from app.schemas.studio.experiment_sessions import ExperimentMessageRead


@pytest.fixture
def isolate_message_projection(monkeypatch):
    """这里验证路由编排；消息状态投影另由真实数据库测试覆盖。"""
    async def read(db, messages, *, include_media_receipts):
        """投影只能在提交完成后执行。"""
        assert db.commits == 1 and include_media_receipts
        return [ExperimentMessageRead.model_validate(message) for message in messages]
    async def publish(*_args):
        pass
    monkeypatch.setattr(route, "publish_media_fact", publish)
    monkeypatch.setattr(route, "read_experiment_messages", read)


class _DummyDB:
    """记录提交和刷新顺序的最小数据库会话替身。"""

    def __init__(self, lab_type: str = "image") -> None:
        """构造具有目标实验室类型的会话替身。"""

        self.session = SimpleNamespace(lab_type=lab_type, updated_at=None)
        self.commits = 0
        self.refreshed: list[object] = []

    async def get(self, _model, _session_id, *, with_for_update):  # noqa: ANN001
        """返回已存在的实验会话。"""

        assert with_for_update
        return self.session

    async def commit(self) -> None:
        """记录任务和消息完成同一事务提交。"""

        self.commits += 1

    async def flush(self):
        """Assign generated identities in the production transaction."""

    async def refresh(self, item: object) -> None:
        """记录返回前刷新权威消息。"""

        self.refreshed.append(item)


class _Submitter:
    """捕获统一命令且不触及真实门禁的提交器替身。"""

    command = None

    def __init__(self, *, entity_gate) -> None:  # noqa: ANN001
        """保持生产注入形状。"""

    async def submit_async(self, _db, command):  # noqa: ANN001
        """返回固定任务标识供消息关联断言。"""

        type(self).command = command
        return GenerationAccepted(task_id="task-1", model_id="resolved-model")


def _message(message_id: str, role: str) -> ExperimentMessage:
    """构造可由响应 schema 序列化的实验室消息。"""

    timestamp = datetime.now(UTC)
    return ExperimentMessage(
        id=message_id,
        session_id="session-1",
        sequence=1 if role == "user" else 2,
        role=role,
        content="最终提示词",
        status=None,
        payload={},
        created_at=timestamp,
        updated_at=timestamp,
    )


@pytest.mark.anyio
async def test_image_lab_task_commits_messages_and_snapshot_before_read_projection(monkeypatch, isolate_message_projection) -> None:
    """图片实验室提交先原子保存消息和任务，再查询响应投影。"""

    db = _DummyDB()
    user_message, task_message = _message("user-1", "user"), _message("task-message-1", "task")
    events: list[str] = []

    async def _append(_db, *, session_id, drafts):  # noqa: ANN001
        assert session_id == "session-1"
        assert [draft.role for draft in drafts] == ["user", "task"]
        assert drafts[0].content == "实验图片"
        assert drafts[0].payload["input_snapshot"]["model_id"] == "resolved-model"
        task_message.task_id = drafts[1].task_id
        events.append("messages")
        return user_message, task_message

    async def _submit(self, _db, command):  # noqa: ANN001
        assert not events
        type(self).command = command
        events.append("task")
        return GenerationAccepted(task_id="task-1", model_id="resolved-model")

    monkeypatch.setattr(route, "append_experiment_messages", _append)
    monkeypatch.setattr(route, "GenerationSubmitter", _Submitter)
    monkeypatch.setattr(_Submitter, "submit_async", _submit)

    response = await route.submit_image_lab_generation_task(
        "session-1",
        GenerationSubmitRequest(
            model_id="image-model",
            execution_prompt="实验图片",
            operation_input=ImageGenerationOperationInput(),
        ),
        db,
    )

    assert response.data.task_id == "task-1"
    assert task_message.task_id == "task-1"
    assert _Submitter.command.target.kind.value == "experiment_session"
    assert _Submitter.command.target.entity_id == "session-1"
    assert _Submitter.command.modality.value == "image"
    assert events == ["task", "messages"]
    assert db.commits == 1
    assert db.refreshed == [user_message, task_message]


@pytest.mark.anyio
async def test_video_lab_task_binds_video_modality_and_rejects_wrong_session_type(monkeypatch, isolate_message_projection) -> None:
    """视频路径固定视频 operation，且不能写入图片实验会话。"""

    db = _DummyDB(lab_type="video")
    user_message, task_message = _message("user-1", "user"), _message("task-message-1", "task")

    async def _append(*_args, **_kwargs):  # noqa: ANN001
        return user_message, task_message

    monkeypatch.setattr(route, "append_experiment_messages", _append)
    monkeypatch.setattr(route, "GenerationSubmitter", _Submitter)
    await route.submit_video_lab_generation_task(
        "session-1",
        GenerationSubmitRequest(
            model_id="video-model",
            execution_prompt="实验视频",
            operation_input=VideoGenerationOperationInput(ratio="16:9"),
        ),
        db,
    )
    assert _Submitter.command.modality.value == "video"
    assert _Submitter.command.operation.value == "video_generation"

    wrong_type_db = _DummyDB(lab_type="image")
    with pytest.raises(Exception) as error:
        await route.submit_video_lab_generation_task(
            "session-1",
            GenerationSubmitRequest(
                model_id="video-model",
                execution_prompt="实验视频",
                operation_input=VideoGenerationOperationInput(ratio="16:9"),
            ),
            wrong_type_db,
        )
    assert getattr(error.value, "detail", None) == "experiment_session_type_invalid"


@pytest.mark.asyncio
@pytest.mark.parametrize("explicit_model", [False, True])
@pytest.mark.parametrize("unified", [False, True])
@pytest.mark.parametrize(("modality", "model", "media", "operation"), [
    ("image", "gpt-image-1", {"references": [{"file_id": "input", "media_kind": "image", "ordinal": 0}]},
     {"kind": "image_generation", "target_ratio": "1:1", "count": 2}),
    ("video", "viduq2", {"frames": {"first": {"file_id": "input", "media_kind": "image", "ordinal": 0}}},
     {"kind": "video_generation", "ratio": "16:9", "seconds": 4}),
])
async def test_lab_submission_history_recovers_media_inputs(tmp_path, monkeypatch, modality, model, media, operation, explicit_model, unified):
    """用户可从历史读取已提交输入，任务消息继续承载关联任务状态。"""
    from app.models.llm import Model, ModelSettings, Provider
    from app.models.studio import FileItem
    from httpx import ASGITransport, AsyncClient
    from app.dependencies import get_db
    from app.main import app
    from tests.directing.test_store import database

    async with database(tmp_path) as sessions, AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async def test_db():
            async with sessions() as db:
                yield db

        monkeypatch.setitem(app.dependency_overrides, get_db, test_db)
        async with sessions.begin() as db:
            db.add(Provider(id="test-lab", provider_key="vidu" if modality == "video" else "openai", name="Vidu" if modality == "video" else "OpenAI",
                            base_url="https://example.invalid", api_key="private-key"))
            db.add(FileItem(id="input", type="image", name="参考图", storage_key="input.png"))
            await db.flush()
            db.add(Model(id="lab-model", name=model, category=modality, provider_id="test-lab"))
            await db.flush()
            db.add(ModelSettings(id=1, **{f"default_{modality}_model_id": "lab-model"}))
        base = "/api/v1/studio"
        session = await client.post(base + "/experiment-sessions", json={"lab_type": modality})
        assert session.status_code == 201, session.text
        session_id = session.json()["data"]["id"]
        body = {"execution_prompt": "按参考图生成", "media": media, "operation_input": operation}
        if explicit_model:
            body["model_id"] = "lab-model"
        submit_url = base + (f"/chat/sessions/media/{session_id}/turns" if unified else
                             f"/generation-tasks/labs/{modality}/sessions/{session_id}/tasks")
        headers = {"Idempotency-Key": "same-lab-request"}
        submitted = await client.post(submit_url, json=body, headers=headers)
        assert submitted.status_code == 201, submitted.text
        reconnected = await client.get(base + f"/experiment-sessions/{session_id}/interaction/requests/same-lab-request")
        assert reconnected.status_code == 200, reconnected.text
        assert reconnected.json()["data"] == submitted.json()["data"]
        replayed = await client.post(submit_url, json=body, headers=headers)
        assert replayed.status_code == 201 and replayed.json()["data"] == submitted.json()["data"]
        changed = await client.post(submit_url, json={**body, "execution_prompt": "更换请求正文"}, headers=headers)
        assert changed.status_code == 409, changed.text
        history = await client.get(base + (f"/chat/sessions/media/{session_id}" if unified else
                                           f"/experiment-sessions/{session_id}/messages"))
        assert history.status_code == 200
        user, task = history.json()["data"]
        snapshot = user["payload"]["input_snapshot"]
        assert submitted.json()["data"]["messages"][0]["payload"]["input_snapshot"] == snapshot
        assert snapshot["version"] == 1
        assert snapshot["prompt"] == "按参考图生成" and snapshot["model_id"] == "lab-model"
        for field, value in operation.items():
            assert snapshot["operation_input"][field] == value
        if modality == "image":
            assert snapshot["media"]["references"] == media["references"]
        else:
            assert snapshot["media"]["frames"]["first"] == media["frames"]["first"]
        assert task["task_id"] == submitted.json()["data"]["task_id"] and task["status"] == "queued"
        assert "private-key" not in history.text
        if unified:
            event_url = base + f"/chat/sessions/media/{session_id}/events"
            events = await client.get(event_url, params={"follow": "false"})
            assert events.status_code == 200
            import json
            observed = [json.loads(line[6:]) for line in events.text.splitlines() if line.startswith("data: ")]
            assert [item["type"] for item in observed] == ["task.accepted"]
            receipt = observed[0]["payload"]
            assert receipt["task_id"] == task["task_id"]
            assert receipt["model_id"] == "lab-model" and receipt["model_name"] == model
            assert receipt["references"][0]["file_id"] == "input"
            assert "private-key" not in events.text
            assert task["media_receipt"] == receipt
            assert not (await client.get(event_url, params={"after": observed[0]["cursor"], "follow": "false"})).text
            if explicit_model:
                await complete_media_trial(sessions, client, event_url, modality, model, monkeypatch)


async def complete_media_trial(sessions, api, url, modality, model, monkeypatch):
    """Run the real worker against controlled HTTP/storage edges and replay its archived files."""
    import asyncio
    import base64
    import json
    import httpx
    from botocore.exceptions import ClientError
    from app.task_worker import TaskWorker

    reference = b"trial reference image"
    posts = []
    uploads = []

    async def download(*, key):
        assert key == "input.png"
        return reference

    async def head(**_):
        raise ClientError({"Error": {"Code": "NoSuchKey"}}, "HeadObject")

    async def upload(**kwargs):
        uploads.append(kwargs["data"].read())

    def provider(request):
        if request.method == "GET":
            return httpx.Response(200, json={"state": "success", "creations": [{"b64_json": "dg=="}]})
        posts.append(request)
        if modality == "video":
            body = json.loads(request.content)
            assert body["model"] == model and body["duration"] == 4
            assert body["images"] == ["data:image/png;base64," + base64.b64encode(reference).decode()]
            return httpx.Response(200, json={"task_id": "remote-video"})
        assert model.encode() in request.content and (reference in request.content or base64.b64encode(reference) in request.content)
        return httpx.Response(200, json={"data": [{"b64_json": "YQ=="}, {"b64_json": "Yg=="}]})

    monkeypatch.setattr("app.core.storage.download_file", download)
    monkeypatch.setattr("app.core.storage.get_file_info", head)
    monkeypatch.setattr("app.core.storage.upload_file", upload)
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
        worker = TaskWorker(sessions, client=http)
        try:
            for _ in range(2 if modality == "video" else 1):
                await worker.tick()
                await asyncio.gather(*list(worker.jobs.values()))
        finally:
            worker.text_pool.shutdown(wait=True)
    events = await api.get(url, params={"follow": "false"})
    items = [json.loads(line[6:]) for line in events.text.splitlines() if line.startswith("data: ")]
    assert items[-1]["type"] == "task.completed"
    assert any(item["type"] == "task.progress" for item in items)
    assert items[-2]["type"] == "artifact.created"
    receipt = items[-1]["payload"]
    assert len(posts) == 1 and uploads == ([b"v"] if modality == "video" else [b"a", b"b"])
    assert len({item["file_id"] for item in receipt["artifacts"]}) == len(uploads)
    snapshot = await api.get(url.removesuffix("/events"))
    assert snapshot.json()["data"][-1]["media_receipt"] == receipt
    assert snapshot.json()["meta"]["cursor"] == items[-1]["cursor"]
