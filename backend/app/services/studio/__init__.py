"""Studio 业务服务。"""

# 说明：
# - 新的生成准备编排主入口已迁移到 `app.services.studio.generation.*`
# - `shot_video_prompt_pack` 仍保留为视频模板渲染底层组件，不再承担编排入口职责

from app.services.studio.shot_character_links import (
    list_by_shot as list_shot_character_links,
    upsert as upsert_shot_character_link,
)
from app.services.studio.script_division import write_division_result_to_chapter
from app.services.studio.files import (
    build_download_response,
    delete_file,
    get_file_detail,
    get_storage_info,
    list_files_paginated,
    update_file_meta,
    upload_file,
)
from app.services.studio.image_task_references import (
    pick_front_ref_file_id,
    pick_ordered_ref_file_ids,
    resolve_reference_file_ids_and_names_from_linked_items,
    resolve_reference_image_refs_by_file_ids,
)
from app.services.studio.generation.asset_image import (
    build_actor_image_base_draft,
    build_actor_image_submission_payload,
    build_asset_image_base_draft,
    build_asset_image_context,
    build_asset_image_submission_payload,
    build_character_image_base_draft,
    build_character_image_submission_payload,
    derive_asset_image_preview,
)
from app.services.studio.generation.frame import (
    build_frame_base_draft,
    build_frame_context,
    build_frame_submission_payload,
    derive_frame_preview,
)
from app.services.studio.generation.video import (
    build_video_base_draft,
    build_video_context,
    build_video_submission_payload,
    derive_video_preview,
)
from app.services.studio.image_task_runner import create_image_task_and_link
from app.services.studio.image_task_validation import (
    validate_actor_image,
    validate_asset_image_and_relation_type,
    validate_character_image,
)
from app.services.studio.shot_assets import (
    create_project_asset_link,
    delete_project_asset_link,
    list_project_asset_links_paginated,
    list_shot_linked_assets,
    list_shot_linked_assets_paginated,
)
from app.services.studio.shot_assets_overview import get_shot_assets_overview
from app.services.studio.shots import (
    create as create_shot,
    delete as delete_shot,
    get as get_shot,
    list_paginated as list_shots_paginated,
    update as update_shot,
)
from app.services.studio.shot_details import (
    create as create_shot_detail,
    delete as delete_shot_detail,
    get as get_shot_detail,
    list_paginated as list_shot_details_paginated,
    update as update_shot_detail,
)
from app.services.studio.shot_dialogs import (
    create as create_shot_dialog_line,
    delete as delete_shot_dialog_line,
    list_by_shot as list_shot_dialog_lines_by_shot,
    list_paginated as list_shot_dialog_lines_paginated,
    update as update_shot_dialog_line,
)
from app.services.studio.shot_frames import (
    create as create_shot_frame_image,
    delete as delete_shot_frame_image,
    list_paginated as list_shot_frame_images_paginated,
    update as update_shot_frame_image,
)
from app.services.studio.shot_extracted_candidates import (
    list_by_shot as list_shot_extracted_candidates,
    mark_ignored as ignore_shot_extracted_candidate,
    mark_linked as link_shot_extracted_candidate,
    mark_linked_by_name as link_shot_extracted_candidate_by_name,
    replace_for_shot as replace_shot_extracted_candidates,
    set_skip_extraction,
    sync_from_extraction_draft as sync_shot_extracted_candidates_from_draft,
)
from app.services.studio.shot_extracted_dialogue_candidates import (
    list_by_shot as list_shot_extracted_dialogue_candidates,
    mark_accepted as accept_shot_extracted_dialogue_candidate,
    mark_ignored as ignore_shot_extracted_dialogue_candidate,
    replace_for_shot as replace_shot_extracted_dialogue_candidates,
    sync_from_extraction_draft as sync_shot_extracted_dialogue_candidates_from_draft,
)
from app.services.studio.shot_video_prompt_pack import build_shot_video_prompt_pack
from app.services.studio.shot_runtime_summary import list_shot_runtime_summary_by_chapter
from app.services.studio.shot_preparation_state import build_shot_preparation_state, link_existing_asset_for_preparation
from app.services.studio.shot_video_readiness import get_shot_video_readiness
from app.services.studio.shot_status import (
    mark_shot_generating,
    recompute_shot_status,
)
from app.services.studio.entities import (
    StudioEntitiesService,
)
from app.services.studio.entity_crud import (
    create_entity,
    delete_entity,
    get_entity,
    list_entities_paginated,
    update_entity,
)
from app.services.studio.entity_existence import check_names_existence
from app.services.studio.entity_images import (
    create_entity_image,
    delete_entity_image,
    list_entity_images_paginated,
    update_entity_image,
)
from app.services.studio.entity_specs import entity_spec, normalize_entity_type
from app.services.studio.entity_thumbnails import download_url, resolve_thumbnail_infos, resolve_thumbnails

__all__ = [
    "StudioEntitiesService",
    "create_entity",
    "create_entity_image",
    "check_names_existence",
    "download_url",
    "entity_spec",
    "build_download_response",
    "build_actor_image_base_draft",
    "build_actor_image_submission_payload",
    "build_asset_image_base_draft",
    "build_asset_image_context",
    "build_asset_image_submission_payload",
    "build_character_image_base_draft",
    "build_character_image_submission_payload",
    "build_frame_base_draft",
    "build_frame_context",
    "build_frame_submission_payload",
    "build_video_base_draft",
    "build_video_context",
    "build_video_submission_payload",
    "create_project_asset_link",
    "create_image_task_and_link",
    "create_shot",
    "delete_file",
    "delete_entity",
    "delete_entity_image",
    "delete_project_asset_link",
    "delete_shot",
    "derive_asset_image_preview",
    "derive_frame_preview",
    "derive_video_preview",
    "get_file_detail",
    "get_entity",
    "get_storage_info",
    "get_shot",
    "list_files_paginated",
    "list_entity_images_paginated",
    "list_entities_paginated",
    "list_project_asset_links_paginated",
    "list_shot_character_links",
    "list_shot_linked_assets",
    "list_shot_details_paginated",
    "list_shot_dialog_lines_by_shot",
    "list_shot_dialog_lines_paginated",
    "list_shot_frame_images_paginated",
    "list_shot_extracted_candidates",
    "list_shot_extracted_dialogue_candidates",
    "build_shot_preparation_state",
    "link_existing_asset_for_preparation",
    "list_shot_linked_assets_paginated",
    "get_shot_assets_overview",
    "get_shot_video_readiness",
    "list_shots_paginated",
    "link_shot_extracted_candidate",
    "link_shot_extracted_candidate_by_name",
    "ignore_shot_extracted_candidate",
    "accept_shot_extracted_dialogue_candidate",
    "ignore_shot_extracted_dialogue_candidate",
    "replace_shot_extracted_candidates",
    "replace_shot_extracted_dialogue_candidates",
    "list_shot_runtime_summary_by_chapter",
    "set_skip_extraction",
    "sync_shot_extracted_candidates_from_draft",
    "sync_shot_extracted_dialogue_candidates_from_draft",
    "mark_shot_generating",
    "normalize_entity_type",
    "recompute_shot_status",
    "resolve_thumbnails",
    "resolve_thumbnail_infos",
    "resolve_reference_file_ids_and_names_from_linked_items",
    "resolve_reference_image_refs_by_file_ids",
    "create_shot_detail",
    "get_shot_detail",
    "update_shot_detail",
    "delete_shot_detail",
    "create_shot_dialog_line",
    "update_shot_dialog_line",
    "delete_shot_dialog_line",
    "create_shot_frame_image",
    "update_shot_frame_image",
    "delete_shot_frame_image",
    "build_shot_video_prompt_pack",
    "pick_front_ref_file_id",
    "pick_ordered_ref_file_ids",
    "update_shot",
    "upload_file",
    "update_file_meta",
    "update_entity_image",
    "update_entity",
    "validate_actor_image",
    "validate_asset_image_and_relation_type",
    "validate_character_image",
    "write_division_result_to_chapter",
    "upsert_shot_character_link",
]

# image_tasks 依赖存储/第三方 SDK（如 boto3）；在某些轻量环境中可能未安装。
# 为了让不依赖该能力的模块（如 entities / shots）可正常导入，这里做可选导入。
try:
    from app.services.studio.image_tasks import (  # noqa: F401
        asset_prompt_category,
        build_prompt_with_template,
        is_front_view,
        load_provider_config,
        map_photo_angle_for_prompt,
        map_view_angle_for_prompt,
        resolve_front_image_ref,
        resolve_image_model,
        resolve_ordered_image_refs,
        shot_frame_prompt_category,
    )

    __all__ += [
        "asset_prompt_category",
        "build_prompt_with_template",
        "is_front_view",
        "load_provider_config",
        "map_photo_angle_for_prompt",
        "map_view_angle_for_prompt",
        "resolve_front_image_ref",
        "resolve_image_model",
        "resolve_ordered_image_refs",
        "shot_frame_prompt_category",
    ]
except Exception:  # noqa: BLE001
    pass
