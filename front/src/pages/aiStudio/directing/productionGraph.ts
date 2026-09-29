import type { ProductionPlan_Input, WorkspaceRead } from '../../../services/generated'

export type ProductionGraphNode = {
  id: string; kind: 'coverage' | 'reference' | 'dependency' | 'unit' | 'prompt' | 'review' | 'take';
  label: string; detail: string; planId: string; unitId: string; objectId: string; external?: boolean;
}
export type ProductionGraphEdge = { from: string; to: string; kind: 'coverage' | 'reference' | 'dependency' | 'prompt' | 'review' | 'take' }
const key = (...parts: string[]) => JSON.stringify(parts)

/** 从明确引用投影关系。列表相邻不形成依赖，历史单元始终保留计划身份。 */
export function buildProductionGraph(workspace: WorkspaceRead, planId: string, plan: ProductionPlan_Input, unitId?: string) {
  const nodes = new Map<string, ProductionGraphNode>()
  const edges: ProductionGraphEdge[] = []
  const selected = plan.units.filter(unit => !unitId || unit.id === unitId)
  const savedPlan = workspace.plans.find(row => row.id === planId)
  const design = workspace.designs.find(row => row.id === plan.design_revision_id)?.content
  const changed = (id: string) => JSON.stringify(savedPlan?.content.units.find(row => row.id === id)) !== JSON.stringify(plan.units.find(row => row.id === id))
  const add = (node: ProductionGraphNode) => { nodes.set(node.id, node); return node.id }
  const connect = (from: string, to: string, kind: ProductionGraphEdge['kind']) => {
    if (!edges.some(edge => edge.from === from && edge.to === to && edge.kind === kind)) edges.push({ from, to, kind })
  }
  for (const unit of selected) {
    const target = add({ id: changed(unit.id) ? key('unit', planId, unit.id, 'draft') : key('unit', planId, unit.id), kind: 'unit', label: `单元 ${plan.units.indexOf(unit) + 1}`,
      detail: `${unit.duration_ms / 1000} 秒 · ${unit.ratio}`, planId, unitId: unit.id, objectId: unit.id })
    for (const coverage of unit.coverage) {
      const shotIndex = design?.direction.shots.findIndex(shot => shot.id === coverage.shot_id) ?? -1
      const source = add({ id: key('coverage', planId, unit.id, coverage.id), kind: 'coverage', label: '镜头范围',
        detail: `${shotIndex < 0 ? '镜头不可用' : `镜头 ${String(shotIndex + 1).padStart(2, '0')}`} · 本单元第 ${unit.coverage.indexOf(coverage) + 1} 段`, planId, unitId: unit.id, objectId: coverage.id })
      connect(source, target, 'coverage')
    }
    for (const reference of unit.references) {
      const source = add({ id: key('reference', planId, unit.id, reference.id), kind: 'reference', label: `${({ image: '图片', video: '视频', audio: '声音' })[reference.media_kind]}参考 ${unit.references.indexOf(reference) + 1}`,
        detail: ({ identity: '主体外观', space: '空间', composition: '构图', continuity: '连续性', performance: '表演', sound: '声音' })[reference.purpose], planId, unitId: unit.id, objectId: reference.id })
      connect(source, target, 'reference')
    }
    for (const dependency of unit.dependencies || []) {
      const sourceUnit = workspace.plans.find(row => row.id === dependency.plan_revision_id)?.content.units.find(row => row.id === dependency.unit_id)
      const internal = dependency.plan_revision_id === planId && !changed(dependency.unit_id) && selected.some(row => row.id === dependency.unit_id)
      const source = internal ? key('unit', planId, dependency.unit_id) : add({
        id: key('dependency', dependency.plan_revision_id, dependency.unit_id, dependency.frame_id || '', dependency.reference_id || ''),
        kind: 'dependency', label: dependency.plan_revision_id === planId ? '其他单元落幅' : '历史计划落幅',
        detail: !sourceUnit ? '固定来源单元不可用' : dependency.frame_id && dependency.reference_id ? '已绑定落幅与参考' : '落幅或参考待配置',
        planId: dependency.plan_revision_id, unitId: dependency.unit_id, objectId: dependency.frame_id || '', external: true,
      })
      connect(source, target, 'dependency')
    }
    const prompts = workspace.prompts.filter(row => row.content.plan_revision_id === planId && row.content.unit_id === unit.id)
    let promptSource = target
    if (prompts.length && changed(unit.id)) {
      const frozen = savedPlan?.content.units.find(row => row.id === unit.id)
      promptSource = add({ id: key('unit', planId, unit.id), kind: 'unit', label: '指令的固定单元',
        detail: frozen ? `${frozen.duration_ms / 1000} 秒 · ${frozen.ratio} · 已保存依据` : '固定依据不可用',
        planId, unitId: unit.id, objectId: unit.id, external: true })
    }
    for (const prompt of prompts) {
      const promptId = add({ id: key('prompt', prompt.id), kind: 'prompt', label: prompt.display_number ? `指令 v${prompt.display_number}` : `指令 ${prompts.indexOf(prompt) + 1}`,
        detail: prompt.confirmed_at ? '固定执行输入' : '草稿', planId, unitId: unit.id, objectId: prompt.id })
      connect(promptSource, promptId, 'prompt')
      for (const review of workspace.reviews.filter(row => row.content.occurrences.some(item => item.prompt_revision_id === prompt.id && item.plan_revision_id === planId && item.unit_id === unit.id))) {
        const reviewId = add({ id: key('review', review.id), kind: 'review', label: '指令检查', detail: review.confirmed_at ? '已确认结论' : '待确认', planId, unitId: unit.id, objectId: review.id })
        connect(promptId, reviewId, 'review')
      }
    }
    for (const take of workspace.takes.filter(row => row.plan_revision_id === planId && row.unit_id === unit.id)) {
      const takeId = add({ id: key('take', take.id), kind: 'take', label: `候选 ${take.display_number || workspace.takes.indexOf(take) + 1}`,
        detail: take.annotation.review_status === 'unreviewed' ? '待审片' : '已有审片记录', planId, unitId: unit.id, objectId: take.id })
      const promptId = key('prompt', take.prompt_revision_id)
      if (nodes.has(promptId)) connect(promptId, takeId, 'take')
    }
  }
  return { nodes: [...nodes.values()], edges }
}
