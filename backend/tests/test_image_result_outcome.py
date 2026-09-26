"""出图结果的 outcome 归一化（``partial_failed`` 语义，故障 B 的后端部分）。

真实故障 B：出图服务在上游图片**已生成**、但它自己 **OSS 上传失败**时返回 ``partial_failed``。
旧实现把它当成功透传：``ok`` 恒为 true、错误消息被笼统的 ``task.message`` 盖掉、
``summarize_results`` 只给 ``{"total":1,"by_status":{"partial_failed":1},"oss_ready":0}``，
用户完全看不出「成功几条 / 失败几条」。

这个文件锁住四件事：

1. ``outcome`` 归一化：``partial_failed`` 不等于成功，且能被调用方识别；
2. 计数是**整数**（``ok_count`` / ``failed_count`` / ``oss_ready_count``），旧字段一个没删；
3. 错误文案优先取 ``detail.error_message``（上游真话），不再被笼统 message 盖掉；
4. 参考图不可达时**一个请求都不发**（不产生付费调用）。

全部不联网：真实分支一律注入 ``httpx.MockTransport``。
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.v1.routes.studio import image_pipeline as route
from app.schemas.studio.image_pipeline import ImageSubmitRequest, ImageTaskResultRead
from app.services.studio.image_pipeline import external_image_client as client
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.image_pipeline.image_pipeline import (
    OUTCOME_DRY_RUN,
    OUTCOME_FAILED,
    OUTCOME_OK,
    OUTCOME_PARTIAL_FAILED,
    OUTCOME_RUNNING,
    OUTCOME_UNKNOWN,
    SubmissionTarget,
    normalize_outcome,
    submit_targets,
    summarize_results,
    summary_outcome,
)
from app.services.studio.llm_orchestration.dry_run import CONFIRM_ENV, DRY_RUN_ENV

SUBMIT_URL = "/api/v1/studio/image-pipeline/submit"

OSS_ERROR = "OSS upload failed: HTTP 403 AccessDenied"


def _target(*, reference: str = "", name: str = "林晓") -> SubmissionTarget:
    return SubmissionTarget(
        source_task_id="jellyfish:proj-1:character:char-1:abcd1234",
        source_asset_id="char-1",
        asset_type="character",
        name=name,
        prompt="定妆照：女主林晓，正面",
        stage="reference_batch",
        reference_image=reference,
    )


# ---------------------------------------------------------------------------
# 1) outcome 归一化
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        ("partial_failed", OUTCOME_PARTIAL_FAILED),
        ("partial_fail", OUTCOME_PARTIAL_FAILED),
        ("oss_failed", OUTCOME_PARTIAL_FAILED),
        ("oss_upload_error_403", OUTCOME_PARTIAL_FAILED),
        ("storage_failed", OUTCOME_PARTIAL_FAILED),
        ("completed", OUTCOME_OK),
        ("succeeded", OUTCOME_OK),
        ("queued", OUTCOME_RUNNING),
        ("running", OUTCOME_RUNNING),
        ("failed", OUTCOME_FAILED),
        ("timeout", OUTCOME_FAILED),
        ("", OUTCOME_OK),  # 认不出来 + ok=True 时退回 ok（老形状兼容）
    ],
)
def test_normalize_outcome_maps_upstream_statuses(status: str, expected: str) -> None:
    assert normalize_outcome(status=status, ok=True) == expected


def test_normalize_outcome_rules() -> None:
    # ok=False 是明确的失败证据（ok=true 不可信、false 可信）→ 不允许渲染成成功
    assert normalize_outcome(status="completed", ok=False) == OUTCOME_FAILED
    # 演练占位既不算成功也不算失败
    assert normalize_outcome(status="", ok=True, dry_run=True) == OUTCOME_DRY_RUN
    # 认不出来且没有 ok 可依据 → unknown（不猜）
    assert normalize_outcome(status="weird_status", ok=None) == OUTCOME_UNKNOWN
    # 状态说成功、但没拿到长期地址且错误文本是 OSS 相关 → 属于部分失败，不能算成功
    assert (
        normalize_outcome(status="completed", ok=True, oss_url="", error_message=OSS_ERROR)
        == OUTCOME_PARTIAL_FAILED
    )
    assert normalize_outcome(status="completed", ok=True, oss_url="https://oss.example.com/a.png") == OUTCOME_OK


def test_summary_outcome_is_conservative() -> None:
    def row(status: str, outcome: str, *, oss: str = "") -> ImageTaskResultRead:
        return ImageTaskResultRead(
            source_task_id="t",
            source_asset_id="a",
            status=status,
            outcome=outcome,
            oss_url=oss,
        )

    assert summary_outcome([]) == "empty"
    assert summary_outcome([row("completed", OUTCOME_OK), row("completed", OUTCOME_OK)]) == OUTCOME_OK
    assert summary_outcome([row("completed", OUTCOME_OK), row("partial_failed", OUTCOME_PARTIAL_FAILED)]) == OUTCOME_PARTIAL_FAILED
    # 只有部分失败（没有一条真正成功）也必须报 partial_failed：那比"失败"更准确
    assert summary_outcome([row("partial_failed", OUTCOME_PARTIAL_FAILED)]) == OUTCOME_PARTIAL_FAILED
    assert summary_outcome([row("failed", OUTCOME_FAILED)]) == OUTCOME_FAILED
    assert summary_outcome([row("queued", OUTCOME_RUNNING), row("completed", OUTCOME_OK)]) == OUTCOME_RUNNING
    assert summary_outcome([row("dry_run", OUTCOME_DRY_RUN)]) == OUTCOME_DRY_RUN


# ---------------------------------------------------------------------------
# 2) 汇总：整数计数 + 旧字段向后兼容
# ---------------------------------------------------------------------------


def test_summarize_results_keeps_legacy_fields_and_adds_integer_counts() -> None:
    results = [
        ImageTaskResultRead(
            source_task_id="t1",
            source_asset_id="a1",
            status="completed",
            outcome=OUTCOME_OK,
            ok=True,
            oss_url="https://oss.example.com/a1.png",
            oss_ready=True,
        ),
        ImageTaskResultRead(
            source_task_id="t2",
            source_asset_id="a2",
            status="partial_failed",
            outcome=OUTCOME_PARTIAL_FAILED,
            ok=False,
            image_url="/images/a2.png",
            error_message=OSS_ERROR,
            http_status=403,
        ),
        ImageTaskResultRead(
            source_task_id="t3",
            source_asset_id="a3",
            status="queued",
            outcome=OUTCOME_RUNNING,
        ),
    ]

    summary = summarize_results(results)

    # 旧字段一个都没删
    assert summary["total"] == 3
    assert summary["by_status"] == {"completed": 1, "partial_failed": 1, "queued": 1}
    assert summary["oss_ready"] == 1
    assert summary["dry_run"] is False
    # 新字段：整数计数 + 归一化口径
    assert summary["ok_count"] == 1
    assert summary["failed_count"] == 1  # 部分失败算失败，**绝不算成功**
    assert summary["partial_failed_count"] == 1
    assert summary["running_count"] == 1
    assert summary["oss_ready_count"] == 1
    assert summary["outcome"] == OUTCOME_PARTIAL_FAILED
    assert summary["ok"] is False
    assert summary["has_failure"] is True
    assert summary["has_partial_failure"] is True
    assert OSS_ERROR in summary["message"]
    assert isinstance(summary["ok_count"], int) and isinstance(summary["oss_ready_count"], int)


def test_summarize_results_dry_run_keeps_legacy_shape() -> None:
    results = [
        ImageTaskResultRead(
            source_task_id="t1",
            source_asset_id="a1",
            status="dry_run",
            outcome=OUTCOME_DRY_RUN,
            dry_run=True,
        )
    ]

    summary = summarize_results(results)

    assert summary["oss_ready"] == 0 and summary["dry_run_count"] == 1
    assert summary["outcome"] == OUTCOME_DRY_RUN
    assert summary["ok"] is False  # 演练占位不是"成功出图"


# ---------------------------------------------------------------------------
# 3) 真实提交：上游 partial_failed 必须被如认识别出来
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_submit_targets_reports_partial_failed_as_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(
                200,
                json={
                    "ok": True,
                    "service_task_id": "svc-1",
                    "source_task_id": "x",
                    "status": "queued",
                    "message": "已创建",
                },
            )
        return httpx.Response(
            200,
            json={
                "ok": True,
                "service_task_id": "svc-1",
                "status": "partial_failed",
                "error_message": OSS_ERROR,
                "images": [{"local_path": "/images/char-1_1.png", "index": 1}],
            },
        )

    results = await submit_targets([_target()], wait_seconds=1, transport=httpx.MockTransport(handler))
    result = results[0]

    assert result.status == "partial_failed"  # 上游原文保留
    assert result.outcome == OUTCOME_PARTIAL_FAILED  # 归一化口径
    assert result.ok is False  # 不再对 partial_failed 恒为 true
    assert result.error_message == OSS_ERROR  # 上游真话优先
    assert result.message == OSS_ERROR  # **不**被笼统的 "已创建" 盖掉
    assert result.http_status == 403
    assert result.oss_ready is False
    assert result.oss_url == ""
    # 上游只给了服务静态路由，client 会补成可打开的本机绝对地址（既有行为）
    assert result.image_url == f"{client.service_base_url()}/images/char-1_1.png"
    assert result.detail["error_message"] == OSS_ERROR
    assert result.detail["source_message"] == "已创建"


@pytest.mark.asyncio
async def test_submit_targets_keeps_running_status_without_polling(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"ok": True, "service_task_id": "svc-2", "status": "queued", "message": "已创建"},
        )

    results = await submit_targets([_target()], transport=httpx.MockTransport(handler))

    assert results[0].outcome == OUTCOME_RUNNING
    assert results[0].ok is False  # 还没跑完就不算成功
    assert results[0].message == "已创建"


@pytest.mark.asyncio
async def test_submit_targets_marks_success_with_oss_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"ok": True, "service_task_id": "svc-3", "status": "queued"})
        return httpx.Response(
            200,
            json={
                "ok": True,
                "service_task_id": "svc-3",
                "status": "completed",
                "images": [{"oss_url": "https://oss.example.com/a.png", "index": 1}],
            },
        )

    results = await submit_targets([_target()], wait_seconds=1, transport=httpx.MockTransport(handler))

    assert results[0].outcome == OUTCOME_OK
    assert results[0].ok is True
    assert results[0].oss_ready is True
    assert summarize_results(results)["oss_ready_count"] == 1


# ---------------------------------------------------------------------------
# 4) 提交前的可达性预检：不可达 → 一个请求都不发（不产生付费调用）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_submit_targets_preflight_blocks_before_any_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    sent: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - 触发即失败
        sent.append(str(request.url))
        return httpx.Response(200, json={"ok": True})

    candidates: list[reference_preflight.ReferenceCandidate] = []

    async def _blocking_preflight(items, **_kwargs):  # type: ignore[no-untyped-def]
        candidates.extend(items)
        report = reference_preflight.PreflightReport(
            results=[
                await reference_preflight.probe_reference_url(
                    items[0].url,
                    label=items[0].label,
                    transport=httpx.MockTransport(lambda _r: httpx.Response(404)),
                )
            ]
        )
        raise reference_preflight.ReferencePreflightBlocked(report)

    with pytest.raises(reference_preflight.ReferencePreflightBlocked) as exc_info:
        await submit_targets(
            [_target(reference="jellyfish/acceptance/files/test_scene.png")],
            transport=httpx.MockTransport(handler),
            preflight=_blocking_preflight,
        )

    assert sent == []  # 没有任何出图请求发出去
    assert candidates and candidates[0].url.endswith("test_scene.png")
    detail = exc_info.value.detail
    assert detail["paid_call_made"] is False
    # 用户口径：默认主流程生成的是「参考图」，响应文案里不许出现「垫图」这种模糊词
    assert "角色「林晓」的定版参考图" == detail["unreachable"][0]["asset"]
    # 页面文案里不许出现 file_id / 本机绝对路径
    assert "file_id" not in str(detail)
    assert "/Users/" not in str(detail)


@pytest.mark.asyncio
async def test_submit_targets_skips_preflight_under_dry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    """演练模式不触网：预检一次都不该跑。"""
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)
    called: list[object] = []

    async def _preflight(items, **_kwargs):  # type: ignore[no-untyped-def]
        called.append(items)
        raise AssertionError("DRY_RUN 下不应做可达性预检")

    results = await submit_targets(
        [_target(reference="https://cdn.example.com/a.png")],
        preflight=_preflight,
    )

    assert called == []
    assert results[0].status == "dry_run" and results[0].outcome == OUTCOME_DRY_RUN


def test_client_contract_still_validates_before_submit() -> None:
    """出图服务客户端的客户端侧校验不能被这次改动弄丢（回归）。"""
    with pytest.raises(client.ImageServiceError):
        import asyncio

        asyncio.run(
            client.create_asset_image_task(
                source_task_id="",
                source_asset_id="a",
                asset={"asset_type": "character", "prompt": "x"},
                generation={},
            )
        )


# ---------------------------------------------------------------------------
# 5) 路由层：不可达时的结构化中文错误信封
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)


def test_submit_route_returns_structured_error_when_reference_unreachable(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """端点必须把预检接上；不可达 → 409 + 结构化中文错误（不提交、不花钱）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    async def _fake_build_targets(db, **_kwargs):  # type: ignore[no-untyped-def]
        return [_target(reference="jellyfish/acceptance/files/test_scene.png")], []

    async def _fake_submit_targets(targets, *, wait_seconds=0.0, transport=None, preflight=None):  # type: ignore[no-untyped-def]
        assert preflight is not None, "提交端点必须把可达性预检接给服务层"
        await preflight(
            [
                reference_preflight.ReferenceCandidate(
                    label="角色「林晓」的定版垫图",
                    url=targets[0].reference_image,
                )
            ]
        )
        raise AssertionError("参考图不可达时不应继续提交")

    monkeypatch.setattr(route, "build_targets", _fake_build_targets)
    monkeypatch.setattr(route, "submit_targets", _fake_submit_targets)

    response = client.post(
        SUBMIT_URL,
        json={"project_id": "proj-1", "asset_type": "character", "stage": "reference_batch"},
    )

    assert response.status_code == 409
    body = response.json()
    assert body["data"] is None
    error = body["meta"]["error"]
    assert error["code"] == reference_preflight.UNREACHABLE_ERROR_CODE
    assert error["paid_call_made"] is False
    assert "没有提交" in body["message"]
    assert "本机" in error["unreachable"][0]["reason"]
    assert "重新上传" in error["unreachable"][0]["how_to_fix"]


def test_submit_route_under_dry_run_does_not_probe(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """演练模式下端点不探活（守卫同口径：不触网）。"""
    calls: list[object] = []

    async def _boom(*args, **kwargs):  # type: ignore[no-untyped-def]
        calls.append((args, kwargs))
        raise AssertionError("DRY_RUN 下不应探活")

    monkeypatch.setattr(reference_preflight, "probe_reference_url", _boom)

    response = client.post(
        SUBMIT_URL,
        json={"project_id": "proj-1", "asset_type": "character", "stage": "character_sheet"},
    )

    assert calls == []
    # 非契约内资产类型会被 400 拦下（与既有行为一致）；契约内的走 dry_run 占位
    assert response.status_code in {200, 400}


def test_image_submit_request_schema_accepts_legacy_payload() -> None:
    """请求体没有被这次改动改变（回归）。"""
    body = ImageSubmitRequest(project_id="proj-1", asset_type="character", stage="reference_batch")
    assert body.wait_seconds == 0.0
    assert body.use_primary_reference is True
