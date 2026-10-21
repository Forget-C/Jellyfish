"""新身份补拍继承真实准备输入，保留冲突并使检查凭证重新确认。"""
from app.core.contracts.directing.scene_version import EditableGenerationUnit


def copy_source_unit_preparation(source, proposal, target_model_id, organization_source, capabilities):
    """来源正文、参考和依赖保持原归属；新单元不能继承原身份的确认与检查。"""
    from app.services.directing.scene_unit_design import merge_unit_design_proposal  # pylint: disable=import-outside-toplevel

    inherited = source.model_copy(update={'id': proposal.id, 'instruction_basis_id': None,
                                         'instruction_check_task_id': None})
    if proposal.duration_ms is None:
        proposal = proposal.model_copy(update={'duration_ms': source.duration_ms})
    unit = merge_unit_design_proposal(inherited, proposal, target_model_id, organization_source)
    missing = list(unit.organization.missing)
    unsupported = set(unit.parameters) - {'seed'}
    if unsupported:
        missing.append('补拍参数与执行器冲突：' + ', '.join(sorted(unsupported)))
    references = capabilities['references']
    frames = [binding for binding in unit.references if binding.input_role != 'subject']
    subjects = [binding for binding in unit.references if binding.input_role == 'subject']
    if any(binding.input_role not in references['frame_roles'] for binding in frames):
        missing.append('补拍参考与目标模型冲突：不支持所选帧位置')
    if references['max_frames'] is not None and len(frames) > references['max_frames']:
        missing.append('补拍参考与目标模型冲突：帧参考数量超过限制')
    if frames and subjects and not references['combine_subjects_and_frames']:
        missing.append('补拍参考与目标模型冲突：不支持主体与帧参考组合')
    if any(binding.media_kind == 'image' for binding in subjects) and not references['subject_images']:
        missing.append('补拍参考与目标模型冲突：不支持主体图片参考')
    if any(binding.media_kind == 'video' for binding in subjects) and not references['subject_videos']:
        missing.append('补拍参考与目标模型冲突：不支持主体视频参考')
    if any(binding.media_kind == 'audio' for binding in unit.references):
        missing.append('补拍参考与执行器冲突：不支持声音参考')
    unit.organization.missing = list(dict.fromkeys(missing))
    return EditableGenerationUnit.model_validate(unit.model_dump())
