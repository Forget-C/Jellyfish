"""指令生成和依据核对共用的单元设计范围。"""

from app.core.contracts.directing.scene_version import EditableGenerationUnit, EditableSceneDesign


def instruction_design(design: EditableSceneDesign, unit: EditableGenerationUnit) -> EditableSceneDesign:
    """保留共享场次背景和当前镜头的工作单，不让无关镜头输入影响本单元。

    共享人物、事件、空间、场记、声音和编译约束仍是真实输入，改变时需要核对。
    镜头内节拍与调度作为该镜头上下文整体保留；执行动作仍由单元覆盖明确限定。
    """
    shot_ids = {item.shot_id for item in unit.coverage}
    shots = [shot for shot in design.direction.shots if shot.id in shot_ids]
    beat_ids = {key for shot in shots for key in shot.beat_ids}
    blocking_ids = {key for shot in shots for key in shot.blocking_state_ids}
    direction = design.direction.model_copy(update={
        'shots': shots,
        'beats': [beat for beat in design.direction.beats if beat.id in beat_ids],
        'blocking_states': [row for row in design.direction.blocking_states if row.id in blocking_ids],
    })
    performance = design.performance.model_copy(update={
        'beats': [row for row in design.performance.beats if row.beat_id in beat_ids],
    })
    return design.model_copy(update={
        'direction': direction, 'performance': performance,
        'cinematography': [row for row in design.cinematography if row.shot_id in shot_ids],
    })
