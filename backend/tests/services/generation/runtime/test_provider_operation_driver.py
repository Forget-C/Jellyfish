"""ProviderOperation Driver 协议的最小契约测试。"""

import inspect

from app.services.generation.runtime.provider_operation_driver import ProviderOperationDriver, ProviderOperationReceipt, ProviderPollResult


def test_provider_operation_driver_exposes_single_poll_contract() -> None:
    """协议必须将远端副作用限制在 start/recover、单次 poll 和可选取消。"""
    assert {"start_or_recover", "poll", "request_cancel"}.issubset(ProviderOperationDriver.__dict__)
    assert ProviderOperationReceipt(remote_id="id").remote_id == "id"
    assert ProviderPollResult(remote_status="running", terminal=False, succeeded=False).output is None
    assert inspect.iscoroutinefunction(ProviderOperationDriver.poll)
