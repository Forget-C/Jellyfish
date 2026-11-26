"""Verify result and history projections through their public HTTP endpoints."""

import re
from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import event

from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.studio import FileItem
from app.models.task import Task, TaskOutput
from tests.test_database_baseline_business import baseline_client


@pytest.mark.asyncio
async def test_history_query_count_and_order(baseline_client):
    client, sessions = baseline_client
    sid = uuid4().hex
    history = f"/api/v1/studio/chat/sessions/image/{sid}/snapshot"
    engine = sessions.kw["bind"]

    async def read(path):
        statements = []

        def record(_conn, _cursor, sql, *_args):
            if sql.lstrip().upper().startswith("SELECT"):
                statements.append(sql.lower())

        event.listen(engine.sync_engine, "before_cursor_execute", record)
        try:
            response = await client.get(path)
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", record)
        assert response.status_code == 200, response.text
        # Media receipts extract selected public input fields in SQL. Keep
        # execution snapshots and storage keys out of the projected columns.
        whole_snapshot = re.compile(r"(?:select|,)\s*tasks\.input_snapshot\s*(?:as\s+\w+)?\s*(?:,|from\b)")
        assert all(not whole_snapshot.search(sql) and "files.storage_key" not in sql for sql in statements)
        data = response.json()["data"]
        rows = data["history"]["messages"] if "history" in data else data
        return rows, len(statements)

    async with sessions.begin() as db:
        db.add(ExperimentSession(id=sid, lab_type="image"))
        await db.flush()
        db.add(ExperimentMessage(id=uuid4().hex, session_id=sid, sequence=1, role="user",
                                 payload={"input_snapshot": {"prompt": "saved"}}))
    ordinary, count = await read(history)
    assert count == 4 and ordinary[0]["payload"]["input_snapshot"]["prompt"] == "saved"

    async with sessions.begin() as db:
        task_ids = [uuid4().hex for _ in range(100)]
        files = [FileItem(id=uuid4().hex, type="image", name="out", storage_key=uuid4().hex,
                          deleted_at=datetime.now() if i == 1 else None) for i in range(3)]
        db.add_all(files)
        for i, tid in enumerate(task_ids):
            db.add(Task(id=tid, kind="text_chat" if i == 0 else "image_generation",
                        status="succeeded" if i == 0 else "failed", stage="finished", progress=100,
                        error_code=None if i == 0 else "download_failed",
                        target_type="experiment_session", target_id=sid, error_message=None if i == 0 else "partial",
                        result={"text": "answer", "extra": 42} if i == 0 else None))
        await db.flush()
        for i, tid in enumerate(task_ids):
            db.add(ExperimentMessage(id=uuid4().hex, session_id=sid, sequence=i+2, role="task", task_id=tid))
            if i:
                for ordinal in ((2, 1) if i == 1 else (2, 0, 1)):
                    db.add(TaskOutput(task_id=tid, ordinal=ordinal, file_id=files[ordinal].id.upper() if engine.dialect.name == "mysql" else files[ordinal].id))

    one, one_count = await read(history + "?page_size=1")
    many, many_count = await read(history + "?page_size=100")
    assert one_count == many_count <= 9
    assert many[-1] == one[0]
    assert [msg["task_id"] for msg in many] == task_ids
    previous, _ = await read(history + "?page_size=100&page=2")
    assert previous == ordinary
    single, count = await read(f"/api/v1/film/tasks/{task_ids[0]}/result")
    assert count <= 2 and single["result"] == many[0]["payload"]["result"] == {"text": "answer", "extra": 42}
    for index, msg in enumerate(many[1:], start=1):
        payload = msg["payload"]
        assert msg["status"] == "failed" and payload["error"] == "partial"
        assert [out["ordinal"] for out in payload["outputs"]] == ([1, 2] if index == 1 else [0, 1, 2])
        assert [out["ordinal"] for out in payload["outputs"] if out["deleted"]] == [1]
        assert all(out["file_id"] == files[out["ordinal"]].id for out in payload["outputs"])
        assert payload["result"]["primary_file_id"] == (None if index == 1 else files[0].id)
        assert all(a["artifact_id"].startswith(msg["task_id"] + ":") for a in payload["result"]["artifacts"])
