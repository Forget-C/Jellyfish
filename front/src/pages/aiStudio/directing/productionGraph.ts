import type { AssetSummary, ContinuityRead, ProductionPlan_Input, SceneDesign_Input, WorkspaceRead } from '../../../services/generated'

export type ProductionGraphNode = {
  id: string; kind: 'coverage' | 'reference' | 'dependency' | 'unit' | 'participant' | 'location';
  label: string; detail: string; planId: string; unitId: string; objectId: string;
  external?: boolean; missing?: boolean; action?: 'add'; indirect?: boolean;
  referenceIds?: string[]; assetId?: string; sourcePlanId?: string; sourceUnitId?: string;
  coverageIds?: string[]; scopeUnknown?: boolean;
}
export type ProductionGraphEdge = { from: string; to: string; kind: 'coverage' | 'reference' | 'dependency' | 'context' | 'binding'; indirect?: boolean }
const key = (...parts: string[]) => JSON.stringify(parts)

/** 明确名单决定镜头范围；历史未知只保留调度／表演依据，不能冒充完整名单。 */
export function shotParticipantRelations(design: SceneDesign_Input | undefined, shotId: string) {
  const shot = design?.direction.shots.find(row => row.id === shotId)
  if (shot?.participant_ids != null) return { known: true, participants: shot.participant_ids.map(id => ({ id, indirect: false })) }
  const participants = new Map<string, boolean>()
  for (const id of shot?.blocking_state_ids || []) {
    const person = design?.direction.blocking_states.find(row => row.id === id)?.participant_id
    if (person) participants.set(person, false)
  }
  for (const row of design?.performance.beats || []) if (shot?.beat_ids.includes(row.beat_id) && !participants.has(row.participant_id)) participants.set(row.participant_id, true)
  return { known: false, participants: [...participants].map(([id, indirect]) => ({ id, indirect })) }
}

/** 准备图只投影当前草稿的真实输入；总览只显示计划单元、覆盖和明确依赖，不借用草稿解释历史指令。 */
export function buildProductionGraph(workspace: WorkspaceRead, planId: string, plan: ProductionPlan_Input, unitId?: string, assets?: AssetSummary[], continuity?: ContinuityRead) {
  const nodes = new Map<string, ProductionGraphNode>()
  const edges: ProductionGraphEdge[] = []
  const selected = plan.units.filter(unit => !unitId || unit.id === unitId)
  const design = workspace.designs.find(row => row.id === plan.design_revision_id)?.content
  const add = (node: ProductionGraphNode) => { nodes.set(node.id, node); return node.id }
  const connect = (from: string, to: string, kind: ProductionGraphEdge['kind'], indirect = false) => {
    if (!edges.some(edge => edge.from === from && edge.to === to && edge.kind === kind)) edges.push({ from, to, kind, indirect })
  }
  for (const unit of selected) {
    const base = { planId, unitId: unit.id }
    const target = add({ ...base, id: key('unit', planId, unit.id), kind: 'unit', label: `单元 ${String(plan.units.indexOf(unit) + 1).padStart(2, '0')}`,
      detail: `${unit.model_id ? '已选择模型' : '模型待选择'} · ${unit.duration_ms / 1000} 秒 · ${unit.ratio}`, objectId: unit.id })
    const participants = new Map<string, boolean>()
    const contexts = new Map<string, Array<{ nodeId: string; coverageId: string; indirect: boolean; unknown: boolean }>>()
    for (const coverage of unit.coverage) {
      const shotIndex = design?.direction.shots.findIndex(shot => shot.id === coverage.shot_id) ?? -1
      const shot = design?.direction.shots[shotIndex]
      const relations = shotParticipantRelations(design, coverage.shot_id)
      const source = add({ ...base, id: key('coverage', planId, unit.id, coverage.id), kind: 'coverage', label: shot ? `镜头 ${String(shotIndex + 1).padStart(2, '0')}` : '镜头不可用',
        detail: `${coverage.action_scope || '动作范围待填写'}${!relations.known ? ' · 参与对象范围待核对' : !relations.participants.length ? ' · 已明确无参与对象' : ''}`, objectId: coverage.id, missing: !shot, scopeUnknown: !relations.known })
      connect(source, target, 'coverage')
      for (const { id, indirect } of relations.participants) {
        participants.set(id, participants.has(id) ? participants.get(id)! && indirect : indirect)
        contexts.set(id, [...contexts.get(id) || [], { nodeId: source, coverageId: coverage.id, indirect, unknown: !relations.known }])
      }
    }
    for (const dependency of unit.dependencies || []) {
      const sourceUnit = workspace.plans.find(row => row.id === dependency.plan_revision_id)?.content.units.find(row => row.id === dependency.unit_id)
      const frame = continuity?.frames.find(row => row.id === dependency.frame_id)
      const reference = unit.references.find(row => row.id === dependency.reference_id)
      const validFrame = !!frame?.current && frame.edge === 'end' && frame.plan_revision_id === dependency.plan_revision_id && frame.unit_id === dependency.unit_id && frame.file_id === reference?.file_id
      const internal = !unitId && dependency.plan_revision_id === planId && selected.some(row => row.id === dependency.unit_id)
      const source = internal ? key('unit', planId, dependency.unit_id) : add({ ...base,
        id: key('dependency', planId, unit.id, dependency.plan_revision_id, dependency.unit_id), kind: 'dependency',
        label: dependency.plan_revision_id === planId ? '其他单元落幅' : '历史计划落幅', objectId: key(dependency.plan_revision_id, dependency.unit_id),
        sourcePlanId: dependency.plan_revision_id, sourceUnitId: dependency.unit_id, external: true,
        referenceIds: reference ? [reference.id] : [], missing: !sourceUnit || !dependency.frame_id || !reference || !!continuity && !validFrame,
        detail: !sourceUnit ? '固定来源单元不可用' : !dependency.frame_id || !reference ? '落幅或参考待配置' : !continuity ? '已绑定 · 实际落幅待核实' : !validFrame ? '实际落幅已变化 · 待处理' : `实际片段 ${frame!.item_id} · ${frame!.at_ms / 1000} 秒`,
      })
      connect(source, target, 'dependency')
    }
    if (!unitId) continue
    // 添加入口不进入业务数据；非空集合也保留追加操作。
    for (const kind of ['coverage', 'reference', 'dependency'] as const) {
      add({ ...base, id: key('add', planId, unit.id, kind), kind, label: { coverage: '＋添加覆盖镜头', reference: '＋添加参考', dependency: '＋添加落幅依赖' }[kind],
        detail: { coverage: unit.coverage.length ? '追加本次动作范围' : '尚未配置镜头范围', reference: unit.references.length ? '人物、场所或临时素材' : '本次未选参考（可选）', dependency: '只绑定明确的实际落幅来源（可选）' }[kind], objectId: '', action: 'add' })
    }
    const designParticipants = new Set(participants.keys())
    const referenceNodes = new Map<string, string>()
    const groups = new Map<string, typeof unit.references>()
    for (const reference of [...unit.references].sort((a, b) => a.ordinal - b.ordinal)) {
      const groupId = (reference.input_role || 'subject') === 'subject' ? reference.subject_group_id || reference.id : reference.id
      groups.set(groupId, [...groups.get(groupId) || [], reference])
      for (const id of reference.participant_ids) if (!participants.has(id)) participants.set(id, true)
    }
    for (const [groupId, group] of groups) {
      const reference = group[0]
      const names = reference.participant_ids.map(id => design?.participants.find(row => row.id === id)?.name || '对象引用不可用').join('、')
      const role = { subject: '主体参考', first_frame: '起始画面', last_frame: '结束画面', key_frame: '关键帧' }[reference.input_role || 'subject']
      const source = add({ ...base, id: key('reference', planId, unit.id, groupId), kind: 'reference', label: `${reference.asset_origin?.name || names || '画面参考'} · ${role}`,
        detail: `已选入本次输入 · ${group.length} 份素材`, objectId: reference.id, referenceIds: group.map(row => row.id) })
      group.forEach(row => referenceNodes.set(row.id, source))
      connect(source, target, 'reference')
    }
    for (const [id, indirect] of participants) {
      const person = design?.participants.find(row => row.id === id)
      const assetId = person?.character_id || person?.prop_id || undefined
      const asset = assets?.find(row => row.id === assetId && row.kind === (person?.character_id ? 'character' : 'prop'))
      const references = unit.references.filter(row => row.participant_ids.includes(id))
      const relations = contexts.get(id) || []
      const status = !assetId ? '未关联资产' : !assets ? '资产状态待核实' : !asset ? '关联资产不可用' : asset.image_file_ids === undefined ? '可选图片待核实' : !asset.image_file_ids.length ? '资产暂无可选图片' : '资产图片可供选择'
      // Participant 没有独立类型；未关联资产时不能把物件默认归为角色。
      const source = add({ ...base, id: key('participant', planId, unit.id, id), kind: 'participant', label: `${person?.prop_id ? '物件' : person?.character_id ? '角色' : '对象'}：${person?.name || '引用不可用'}`,
        detail: `${status} · ${references.length ? `本次已选 ${references.length} 份参考` : '本次未选参考'} · ${!designParticipants.has(id) ? '仅本次参考关联' : relations.some(row => !row.unknown) ? '镜头参与对象' : indirect ? '间接设计关联' : '设计调度关联'}${relations.some(row => row.unknown) ? ' · 范围待核对' : ''}`,
        objectId: id, assetId, missing: !person, indirect, coverageIds: relations.map(row => row.coverageId) })
      relations.forEach(row => connect(source, row.nodeId, 'context', row.indirect))
      for (const reference of references) connect(source, referenceNodes.get(reference.id)!, 'binding')
    }
    if (design || unit.references.some(row => row.asset_origin?.kind === 'scene')) {
      const assetId = design?.direction.location_asset_id || undefined
      const asset = assets?.find(row => row.kind === 'scene' && row.id === assetId)
      const references = unit.references.filter(row => row.asset_origin?.kind === 'scene' || row.purpose === 'space')
      const status = !assetId ? '未关联场所资产' : !assets ? '资产状态待核实' : !asset ? '关联资产不可用' : asset.image_file_ids === undefined ? '可选图片待核实' : asset.image_file_ids.length ? '资产图片可供选择' : '资产暂无可选图片'
      const source = add({ ...base, id: key('location', planId, unit.id), kind: 'location', label: `场所：${asset?.name || '待关联场所'}`, detail: `${status} · ${references.length ? `本次已选 ${references.length} 份空间参考` : '本次未选空间参考'}`, objectId: assetId || '', assetId })
      if (assetId) connect(source, target, 'context')
      references.forEach(row => connect(source, referenceNodes.get(row.id)!, 'binding'))
    }
  }
  return { nodes: [...nodes.values()], edges }
}
