"""``partial*`` 状态 token 的后端归一化口径（任务二·后端侧，2026-09-19 报障的配套修复）。

真实报障：页面把一条「部分失败」的汇总显示成**成功 0 / 失败 0**。
前端分类器是直接原因（不认裸 ``partial``），但**后端也必须先有一致口径**，
否则同一批数据在两侧会被算成不同的档：

- 后端 ``summarize_results`` 对 ``partial_failed`` 一直是对的
  （``ok_count=0 / failed_count=1 / partial_failed_count=1 / has_partial_failure=true``）；
- 但 ``classify_status_token`` / ``normalize_outcome`` 遇到**不带 fail/error 词的 partial 变体**
  （``partial`` / ``partial_ok`` / ``partially_failed`` 之外的口语写法）会落到 ``None`` → 交给
  ``ok`` 布尔兜底 → 老形状 ``ok=true`` 时就会被算成**成功**。

这里把「只要含 partial 就一律是 partial_failed」这条口径钉死，并确认它不是 unknown。
"""

from __future__ import annotations

import pytest

from app.schemas.studio.image_pipeline import ImageTaskResultRead
from app.services.studio.image_pipeline.image_pipeline import (
    OUTCOME_OK,
    OUTCOME_PARTIAL_FAILED,
    OUTCOME_UNKNOWN,
    classify_status_token,
    normalize_outcome,
    summarize_results,
)

#: 「部分失败」的各种写法（含没有 fail/error 词的写法 —— 它们才是以前会漏掉的）
PARTIAL_TOKENS = [
    "partial",
    "partial_failed",
    "partial_fail",
    "partially_failed",
    "partial_ok",
    "partial_success",
    "partial_succeeded",
    "partial_error",
    "oss_failed",
    "oss_upload_error_403",
]


@pytest.mark.parametrize("token", PARTIAL_TOKENS)
def test_partial_tokens_never_fall_back_to_unknown_or_ok(token: str) -> None:
    assert classify_status_token(token) == OUTCOME_PARTIAL_FAILED
    # 关键：ok 布尔不再能把 partial 变体"救"成成功（老形状对 partial_failed 恒回 ok=true）
    assert normalize_outcome(status=token, ok=True) == OUTCOME_PARTIAL_FAILED
    assert normalize_outcome(status=token, ok=True) != OUTCOME_OK
    assert normalize_outcome(status=token, ok=None) != OUTCOME_UNKNOWN


def test_bare_partial_status_summarizes_as_partial_failure() -> None:
    """``by_status: {partial: 1}`` 这种形状：后端四个新字段必须把它算成失败。"""
    results = [
        ImageTaskResultRead(
            source_task_id="t1",
            source_asset_id="a1",
            status="partial",  # 上游/方言写法：既不是 completed 也不是 partial_failed
            ok=True,  # 老形状的 ok=true 不得把它算成成功
            image_url="/images/a1.png",
        )
    ]

    summary = summarize_results(results)

    assert summary["by_status"] == {"partial": 1}
    assert summary["ok_count"] == 0
    assert summary["failed_count"] == 1
    assert summary["partial_failed_count"] == 1
    assert summary["unknown_count"] == 0
    assert summary["has_failure"] is True
    assert summary["has_partial_failure"] is True
    assert summary["by_outcome"] == {OUTCOME_PARTIAL_FAILED: 1}
    assert summary["total"] == 1
    # 计数必须能解释 total（前端「不丢数」硬约束依赖这一条）
    assert (
        summary["ok_count"]
        + summary["failed_count"]
        + summary["running_count"]
        + summary["dry_run_count"]
        + summary["unknown_count"]
        == summary["total"]
    )
