import type { EditableRevisionField, ReviewRevisionCandidate, RevisionFieldTarget, WorkspaceRead } from '../../../services/generated'
import { generationInstructionGraph } from './generationInstructionGraph'
import { fixedValue } from './readableText'
import { relatedInstructionPath } from './instructionContent'

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  const a = Object.keys(left), b = Object.keys(right)
  return a.length === b.length && a.every(key => Object.prototype.hasOwnProperty.call(right, key) && sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
}

/** 只替换精确快照中已有的自有字段；这是候选展示投影，不保存或授权修改。 */
function replaceValue(root: unknown, path: string, value: unknown) {
  const parts = path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (!path.startsWith('/') || parts.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) return false
  let parent = root as Record<string, unknown>
  for (const part of parts.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !Object.prototype.hasOwnProperty.call(parent, part)) return false
    parent = parent[part] as Record<string, unknown>
  }
  const key = parts[parts.length - 1]
  if (!parent || typeof parent !== 'object' || !Object.prototype.hasOwnProperty.call(parent, key)) return false
  parent[key] = structuredClone(value)
  return true
}

/** 关联背景、授权范围与真实候选分别计算；不依据布局、文本相似或共同名称推断变化。 */
export function instructionOptimization(workspace: WorkspaceRead, promptId: string, fields: EditableRevisionField[], scope: RevisionFieldTarget[] | null, candidate?: ReviewRevisionCandidate | null, stale = false) {
  const graph = generationInstructionGraph(workspace, promptId)
  const design = workspace.designs.find(row => row.id === graph.designId)?.content
  const attention = scope || (candidate?.source_prompt_revision_id === promptId && !stale ? candidate.changes : []) || []
  const selected = graph.requirements.filter(requirement => attention.some(target => target.target === 'design' && relatedInstructionPath(target.path, requirement.path)))
  const selectedGroups = new Set(selected.map(requirement => requirement.groupId))
  const paths = new Map<string, string[]>([...selectedGroups].map(id => [id, []]))
  const queue = [...selectedGroups]
  while (queue.length) {
    const id = queue.shift()!
    for (const edge of graph.relations.filter(edge => edge.from === id || edge.to === id)) {
      const other = edge.from === id ? edge.to : edge.from
      if (!paths.has(other)) { paths.set(other, [...paths.get(id)!, edge.id]); queue.push(other) }
    }
  }
  const background = graph.groups.filter(group => paths.has(group.id) && !selectedGroups.has(group.id)).map(group => ({ group, via: paths.get(group.id)! }))
  const issues: Array<{ index?: number; message: string }> = []
  const changes = (candidate?.changes || []).map((change, index) => {
    const current = fixedValue(change.target === 'design' ? design : graph.unit, change.path)
    const allowed = fields.some(field => field.target === change.target && field.path === change.path && sameValue(field.value, current))
    const inScope = !scope || scope.some(target => target.target === change.target && target.path === change.path)
    const reasons: string[] = []
    if (current === undefined || !sameValue(current, change.before)) reasons.push('修改前值与本次固定来源不一致')
    if (!allowed) reasons.push('字段不在当前允许修改范围，或固定原值已失效')
    if (!inScope) reasons.push('变化超出明确调整范围')
    if (sameValue(change.before, change.after)) reasons.push('此项没有实际字段变化')
    if ((candidate?.changes || []).some((other, otherIndex) => otherIndex !== index && other.target === change.target && relatedInstructionPath(other.path, change.path))) reasons.push('候选包含重复或相互覆盖的字段')
    reasons.forEach(message => issues.push({ index, message }))
    return { ...change, current, allowed, inScope, reasons }
  })
  if (candidate?.source_prompt_revision_id && candidate.source_prompt_revision_id !== promptId) issues.push({ message: '候选来源属于另一份指令' })
  if (stale) issues.push({ message: '修改要求或固定来源已变化；旧候选不能用于当前关系预览' })
  let preview: ReturnType<typeof generationInstructionGraph> | undefined
  if (candidate && !issues.length && candidate.source_prompt_revision_id === promptId && candidate.preview_text != null && candidate.preview_decisions != null && graph.planId && graph.designId && graph.unit) {
    const proposed = structuredClone(workspace)
    const proposedDesign = proposed.designs.find(row => row.id === graph.designId)!.content
    const proposedUnit = proposed.plans.find(row => row.id === graph.planId)!.content.units.find(unit => unit.id === graph.unitId)!
    const applied = changes.every(change => replaceValue(change.target === 'design' ? proposedDesign : proposedUnit, change.path, change.after))
    if (applied) {
      const prompt = proposed.prompts.find(row => row.id === promptId)!.content
      prompt.text = candidate.preview_text; prompt.decisions = candidate.preview_decisions
      try { preview = generationInstructionGraph(proposed, promptId) }
      catch { issues.push({ message: '候选结构无法形成可靠关系投影，保留实际字段差异供核对' }) }
    } else issues.push({ message: '候选字段无法投影到固定来源，保留真实差异与完整预览' })
  }
  const added = preview?.relations.filter(edge => !graph.relations.some(current => current.id === edge.id)) || []
  const removed = preview ? graph.relations.filter(edge => !preview!.relations.some(next => next.id === edge.id)) : []
  const changedGroupIds = new Set(changes.filter(change => change.target === 'design').flatMap(change => graph.groups.filter(group => group.path && relatedInstructionPath(group.path, change.path)).map(group => group.id)))
  const unchanged = preview ? graph.relations.filter(edge => preview!.relations.some(next => next.id === edge.id) && (changedGroupIds.has(edge.from) || changedGroupIds.has(edge.to))) : []
  return { graph, selected, background, changes, issues, preview, added, removed, unchanged }
}
