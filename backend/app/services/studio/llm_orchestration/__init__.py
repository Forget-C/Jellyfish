"""LLM 编排层（P1）：实体提取 / 图片提示词生成 / 视频提示词生成。

三个服务统一模式：
组装上下文 → 构建提示词 → 调 LLM（经 DRY_RUN 守卫）→ 解析 JSON + 确定性后校验 → 返回预览。

硬边界（贯穿整个包）：
- 只返回预览，**不写任何表**、不自动建资产；
- 不改数据库结构，不引入新依赖（只用 httpx）；
- 默认 DRY_RUN：未显式关闸并确认前，一行真实请求都不会发出。
"""

from __future__ import annotations

from app.services.studio.llm_orchestration.dry_run import (
    CONFIRM_ENV,
    DRY_RUN_ENV,
    DryRunBlocked,
    RealCallNotConfirmed,
    allow_real_llm_call,
    assert_llm_outbound_allowed,
    audit_log,
    clear_audit_log,
    dry_run_enabled,
    install_network_guard,
    network_guard_installed,
    real_call_confirmed,
    short_status,
    state as dry_run_state,
    uninstall_network_guard,
)
from app.services.studio.llm_orchestration.context import (
    build_profile_cards,
    load_chapter_source,
    load_project_entity_profiles,
    load_shot_context,
    render_profile_cards,
    resolve_project_id,
)
from app.services.studio.llm_orchestration.client import (
    LLMCompletion,
    LLMRequestError,
    TextLLMCaller,
    TextLLMTarget,
    call_text_llm,
    resolve_text_llm_target,
)
from app.services.studio.llm_orchestration.json_utils import (
    JSONParseError,
    extract_json_candidate,
    json_error_hint,
    normalize_name,
    parse_json_object_with_repairs,
)
from app.services.studio.llm_orchestration.registry import (
    ALLOWED_DURATION_SECONDS,
    CAMERA_MOVEMENT_KEYS,
    ENTITY_TYPE_WHITELIST,
    camera_movement_options,
    normalize_camera_movement,
    normalize_entity_type,
)
from app.services.studio.llm_orchestration.entity_extraction import (
    build_entity_extraction_prompt,
    postprocess_entities,
    preview_entity_extraction,
)
from app.services.studio.llm_orchestration.asset_binding import (
    AUTO_TIER,
    REVIEW_TIER,
    SLOT_ASSET_TYPES,
    build_binding_prompt,
    classify_tier,
    heuristic_suggestions,
    load_candidate_catalog,
    parse_binding_response,
    preview_asset_binding,
    reconcile_with_heuristic,
)
from app.services.studio.llm_orchestration.image_prompt import (
    assemble_image_prompt,
    postprocess_slots,
    preview_image_prompts,
)
from app.services.studio.llm_orchestration.video_prompt import (
    assemble_video_prompt,
    postprocess_video_plan,
    preview_video_prompt,
    strip_forbidden_refs,
)
from app.services.studio.llm_orchestration.drama_plan import (
    ALLOWED_DURATIONS,
    MAX_SHOT_COUNT,
    build_drama_plan_prompt,
    postprocess_plan,
    preview_drama_plan,
    render_brief_text,
)

__all__ = [
    # 守卫
    "CONFIRM_ENV",
    "DRY_RUN_ENV",
    "DryRunBlocked",
    "RealCallNotConfirmed",
    "allow_real_llm_call",
    "assert_llm_outbound_allowed",
    "audit_log",
    "clear_audit_log",
    "dry_run_enabled",
    "dry_run_state",
    "install_network_guard",
    "network_guard_installed",
    "real_call_confirmed",
    "short_status",
    "uninstall_network_guard",
    # 上下文
    "build_profile_cards",
    "load_chapter_source",
    "load_project_entity_profiles",
    "load_shot_context",
    "render_profile_cards",
    "resolve_project_id",
    # LLM 客户端
    "LLMCompletion",
    "LLMRequestError",
    "TextLLMCaller",
    "TextLLMTarget",
    "call_text_llm",
    "resolve_text_llm_target",
    # JSON
    "JSONParseError",
    "extract_json_candidate",
    "json_error_hint",
    "normalize_name",
    "parse_json_object_with_repairs",
    # 词表
    "ALLOWED_DURATION_SECONDS",
    "CAMERA_MOVEMENT_KEYS",
    "ENTITY_TYPE_WHITELIST",
    "camera_movement_options",
    "normalize_camera_movement",
    "normalize_entity_type",
    # 三个服务
    "build_entity_extraction_prompt",
    "postprocess_entities",
    "preview_entity_extraction",
    "assemble_image_prompt",
    "postprocess_slots",
    "preview_image_prompts",
    "assemble_video_prompt",
    "postprocess_video_plan",
    "preview_video_prompt",
    "strip_forbidden_refs",
    # P2 资产绑定
    "AUTO_TIER",
    "REVIEW_TIER",
    "SLOT_ASSET_TYPES",
    "build_binding_prompt",
    "classify_tier",
    "heuristic_suggestions",
    "load_candidate_catalog",
    "parse_binding_response",
    "preview_asset_binding",
    "reconcile_with_heuristic",
    # 广告剧情流程：剧情策划（一次调用产出整份草稿）
    "ALLOWED_DURATIONS",
    "MAX_SHOT_COUNT",
    "build_drama_plan_prompt",
    "postprocess_plan",
    "preview_drama_plan",
    "render_brief_text",
]
