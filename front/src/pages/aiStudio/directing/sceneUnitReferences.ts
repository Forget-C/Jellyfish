import type { EditableSceneDesign_Output, SceneVersionContent_Output } from '../../../services/generated'

export type UnitReferenceConflict = { unitId: string; shotId: string; coverageId?: string; referenceId?: string; label: string; reason: string }

/** 展示设计变更影响的当前单元引用；服务端仍对整份候选作最终校验。 */
export function sceneUnitReferenceConflicts(content: Pick<SceneVersionContent_Output, 'design' | 'units'>, proposed: EditableSceneDesign_Output): UnitReferenceConflict[] {
  return (content.units || []).flatMap((unit, unitIndex) => {
    const conflicts: UnitReferenceConflict[] = []
    unit.coverage.forEach((item, index) => {
      const shot = proposed.direction.shots.find(row => row.id === item.shot_id)
      const missing = !shot ? '来源镜头将被移除' : [
        item.beat_ids.some(id => !shot.beat_ids.includes(id)) && '覆盖节拍将不再属于来源镜头',
        item.event_ids.some(id => !shot.event_ids.includes(id)) && '覆盖事件将不再属于来源镜头',
      ].filter(Boolean).join('；')
      if (missing) conflicts.push({ unitId: unit.id, shotId: item.shot_id, coverageId: item.id,
        label: `单元 ${unitIndex + 1} · 覆盖 ${index + 1}`, reason: missing })
    })
    unit.references.forEach((binding, index) => {
      if (binding.participant_ids.some(id => !proposed.participants.some(row => row.id === id))) conflicts.push({
        unitId: unit.id, shotId: unit.coverage[0].shot_id, referenceId: binding.id,
        label: `单元 ${unitIndex + 1} · 参考 ${index + 1}`, reason: '参考绑定的参与对象将被移除',
      })
    })
    return conflicts
  })
}
