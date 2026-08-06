"""ProviderOperation 能力矩阵回归测试。"""

from app.core.contracts.provider_capabilities import provider_operation_capabilities


def test_only_verified_async_provider_handles_are_recoverable() -> None:
    """同步图片和未知组合不得获得 poll 或 create 幂等承诺。"""
    assert provider_operation_capabilities(provider_key="vidu", operation_kind="image_generation").supports_poll_by_handle
    assert provider_operation_capabilities(provider_key="vidu", operation_kind="image_generation").supports_result_retrieval_by_handle
    assert provider_operation_capabilities(provider_key="openai", operation_kind="video_generation").supports_remote_handle
    assert not provider_operation_capabilities(provider_key="openai", operation_kind="image_generation").supports_poll_by_handle
    unknown = provider_operation_capabilities(provider_key="new-provider", operation_kind="video_generation")
    assert not unknown.supports_remote_handle
    assert not unknown.supports_result_retrieval_by_handle
    assert not unknown.supports_create_idempotency
