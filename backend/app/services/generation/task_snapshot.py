"""任务列与输入关系和生成契约之间的转换，不重复保存文件或目标身份。"""

from __future__ import annotations

from collections.abc import Sequence

from app.core.contracts.generation import GenerationTargetKind, ResolvedGenerationSnapshot
from app.core.contracts.media import ImageMediaInput, VideoMediaInput
from app.models.task import Task, TaskInput
from app.models.studio_prompts_files_timeline import FileItem


def split_snapshot(snapshot: ResolvedGenerationSnapshot) -> tuple[dict, str, str, list[tuple[str, int, str]]]:
    """把文件引用移至 task_inputs，并以具体资产类型区分各表的数字槽位 ID。"""
    data = snapshot.model_dump(mode="json", exclude={"canonical_target", "expected_version_id", "media"})
    if data.get("prompt_revision_id") is None:
        data.pop("prompt_revision_id", None)
    if data.get("execution_config") is None:
        data.pop("execution_config", None)
    target = snapshot.canonical_target
    target_type = target.kind.value
    target_id = target.entity_id
    if target.slot_id is not None:
        target_id = target.slot_id
        data["target_parent_id"] = target.entity_id
    if target.kind == GenerationTargetKind.asset_image_slot:
        target_type = f"{target.asset_type}_image_slot"
    inputs = []
    media = snapshot.media
    if isinstance(media, ImageMediaInput):
        data["media_layout"] = {"kind": "image"}
        inputs.extend(("references", ref.ordinal, ref.file_id) for ref in media.references)
    elif isinstance(media, VideoMediaInput):
        data["media_layout"] = {"kind": "video", "subjects": [subject.name for subject in media.subjects]}
        for role, ref in (("frames.first", media.frames.first), ("frames.last", media.frames.last)):
            if ref is not None:
                inputs.append((role, ref.ordinal, ref.file_id))
        inputs.extend(("frames.keys", ref.ordinal, ref.file_id) for ref in media.frames.keys)
        for index, subject in enumerate(media.subjects):
            inputs.extend((f"subjects.{index}", ref.ordinal, ref.file_id) for ref in subject.media)
    return data, target_type, target_id, inputs


def restore_snapshot(task: Task, inputs: Sequence[tuple[TaskInput, FileItem]]) -> ResolvedGenerationSnapshot:
    """从唯一任务目标与有序文件关系重建执行输入，缺失文件由调用方拒绝。"""
    data = dict(task.input_snapshot)
    parent_id = data.pop("target_parent_id", None)
    layout = data.pop("media_layout", None)
    # 路由配置供执行器使用，不属于用户生成输入契约。
    for key in ("model_name", "provider_key"):
        data.pop(key, None)
    target_type = task.target_type
    target = {"kind": target_type, "entity_id": parent_id or task.target_id}
    if parent_id is not None:
        target["slot_id"] = task.target_id
    for asset_type in ("actor", "character", "scene", "prop", "costume"):
        if target_type == f"{asset_type}_image_slot":
            target.update(kind="asset_image_slot", asset_type=asset_type)
            break
    groups: dict[str, list[dict]] = {}
    for relation, file in sorted(inputs, key=lambda item: (item[0].role_path, item[0].ordinal)):
        groups.setdefault(relation.role_path, []).append({
            "file_id": file.id, "media_kind": file.type, "ordinal": relation.ordinal,
        })
    media = None
    if layout and layout["kind"] == "image":
        media = {"references": groups.get("references", [])}
    elif layout and layout["kind"] == "video":
        media = {"frames": {
            "first": next(iter(groups.get("frames.first", [])), None),
            "last": next(iter(groups.get("frames.last", [])), None),
            "keys": groups.get("frames.keys", []),
        }, "subjects": [{"name": name, "media": groups.get(f"subjects.{index}", [])}
                         for index, name in enumerate(layout["subjects"])]}
    return ResolvedGenerationSnapshot.model_validate({
        **data, "canonical_target": target, "expected_version_id": task.expected_target_version, "media": media,
    })
