import type { SceneDesign_Input } from '../../../services/generated'
import { designAt, noteText, patchDesign } from './designValue'
import type { DesignPath } from './designValue'

export type DesignObject = { key: string; label: string; kind: string; path: DesignPath; fields?: string[] }
export type DesignEdge = { from: string; to: string; label: string; indirect?: boolean }
export type DesignGraph = { nodes: DesignObject[]; edges: DesignEdge[] }
export type RelationBinding = { path: DesignPath; prefix: string; target: string; many: boolean; required: boolean }
export const departmentNames: Record<string, string> = { direction: '总导演', performance: '表演指导', staging: '镜内执行', cinematography: '摄影指导', continuity: '场记与连续性', sound: '对白与声音', prompt: '提示词指导' }

export type DesignScope = 'all' | 'unassigned' | `beat:${string}`

/** 范围仅筛选原镜头；跨节拍镜头保持同一身份，全场统计不会重复。 */
export function scopeShots(value: SceneDesign_Input, scope: DesignScope) {
  return value.direction.shots.filter(shot => scope === 'all' || (scope === 'unassigned'
    ? !shot.beat_ids.some(id => value.direction.beats.some(beat => beat.id === id))
    : shot.beat_ids.includes(scope.slice(5))))
}

/** 仅重排筛选集合占用的槽位，隐藏镜头的相对顺序和全部对象内容保持不变。 */
export function reorderScopeShots(value: SceneDesign_Input, visibleIds: string[], fromId: string, toId: string): SceneDesign_Input {
  const ids = new Set(visibleIds)
  const visible = value.direction.shots.filter(shot => ids.has(shot.id))
  const from = visible.findIndex(shot => shot.id === fromId), to = visible.findIndex(shot => shot.id === toId)
  if (from < 0 || to < 0 || from === to) return value
  const reordered = [...visible]; reordered.splice(to, 0, ...reordered.splice(from, 1))
  let index = 0
  return { ...value, direction: { ...value.direction, shots: value.direction.shots.map(shot => ids.has(shot.id) ? reordered[index++] : shot) } }
}

/** 聚合范围中镜头的真实关系，不以同名对象或画布位置猜测关联。 */
export function scopeGraph(value: SceneDesign_Input, scope: DesignScope, visibleShotIds?: string[]): DesignGraph {
  const nodes = new Map<string, DesignObject>(), edges = new Map<string, DesignEdge>()
  scopeShots(value, scope).filter(shot => !visibleShotIds || visibleShotIds.includes(shot.id)).forEach(shot => {
    const graph = shotGraph(value, shot.id)
    graph.nodes.forEach(node => nodes.set(node.key, node))
    graph.edges.forEach(edge => edges.set(JSON.stringify([edge.from, edge.to, edge.label]), edge))
  })
  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

/** 间接展示边的引用实际写在表演/连续性对象上，不在节拍或事件上。 */
export function relationOwner(edge: DesignEdge): string {
  return edge.indirect && (edge.to.startsWith('performance:') || edge.to.startsWith('continuity:')) ? edge.to : edge.from
}

/** 只编辑已有契约支持的直接引用；间接边必须回到其原始对象。 */
export function relationBinding(value: SceneDesign_Input, edge: DesignEdge): RelationBinding | undefined {
  if (edge.indirect) return undefined
  const fromKind = edge.from.slice(0, edge.from.indexOf(':')), fromId = edge.from.slice(edge.from.indexOf(':') + 1)
  const toKind = edge.to.slice(0, edge.to.indexOf(':')), toId = edge.to.slice(edge.to.indexOf(':') + 1)
  if (fromKind === 'shot') {
    const index = value.direction.shots.findIndex(shot => shot.id === fromId)
    const field = { beat: 'beat_ids', event: 'event_ids', criterion: 'criterion_ids', blocking: 'blocking_state_ids' }[toKind]
    if (index >= 0 && field) return { path: ['direction', 'shots', index, field], prefix: toKind, target: toId, many: true, required: false }
    if (toKind === 'camera' && value.cinematography[Number(toId)]?.shot_id === fromId) return { path: ['cinematography', Number(toId), 'shot_id'], prefix: 'shot', target: fromId, many: false, required: true }
  }
  if (fromKind === 'blocking') {
    const index = value.direction.blocking_states.findIndex(row => row.id === fromId)
    const field = { participant: 'participant_id', anchor: 'anchor_ids', event: 'event_id' }[toKind]
    if (index >= 0 && field) return { path: ['direction', 'blocking_states', index, field], prefix: toKind, target: toId, many: toKind === 'anchor', required: toKind === 'participant' }
  }
  return undefined
}

export function changeRelation(value: SceneDesign_Input, binding: RelationBinding, next?: string): SceneDesign_Input {
  if (!next && binding.required) return value
  if (next && !designObjects(value).some(row => row.key === `${binding.prefix}:${next}`)) return value
  const current = designAt(value, binding.path)
  if (binding.many) {
    if (!Array.isArray(current) || !current.includes(binding.target)) return value
    const ids = current.filter((id: string) => id !== binding.target)
    if (next && !ids.includes(next)) ids.push(next)
    return patchDesign(value, binding.path, ids)
  }
  return current === binding.target ? patchDesign(value, binding.path, next ?? null) : value
}

/** 对象名从原字段产生，身份仍使用版本内 ID；不创造可编辑标题。 */
export function designObjects(value: SceneDesign_Input): DesignObject[] {
  const objects: DesignObject[] = [
    { key: 'overview', label: '全场概览', kind: 'direction', path: ['direction'], fields: ['viewpoint', 'information_change', 'relationship_change', 'turning_point', 'immutable_facts', 'location_asset_id', 'spatial_basis', 'shootable_area', 'axis', 'scale', 'open_questions', 'control_level'] },
    { key: 'performance', label: '表演适用规则', kind: 'performance', path: ['performance'], fields: ['applicability'] },
    { key: 'staging', label: '环境活动与留白', kind: 'staging', path: ['staging'], fields: ['environment', 'intentional_absence'] },
    { key: 'sound', label: '声音安排', kind: 'sound', path: ['sound'], fields: ['sources', 'ambience_actions', 'music_constraints', 'execution'] },
    { key: 'prompt', label: '提示词指导', kind: 'prompt', path: ['prompt'] },
  ]
  const add = (rows: unknown[], path: DesignPath, prefix: string, label: string, kind: string) => rows.forEach((raw, index) => {
    const row = raw as Record<string, unknown>
    const text = typeof row.name === 'string' ? row.name : noteText(row.visible_result || row.objective || row.description || row.requirement || row.content || row.physical_action || row.ongoing_task || row.position || row.after || row.situation)
    objects.push({ key: `${prefix}:${row.id || index}`, label: `${label} ${String(index + 1).padStart(2, '0')}${text ? ` · ${text}` : ''}`, kind, path: [...path, index] })
  })
  add(value.direction.shots, ['direction', 'shots'], 'shot', '镜头', 'direction')
  add(value.direction.beats, ['direction', 'beats'], 'beat', '节拍', 'direction')
  add(value.direction.anchors, ['direction', 'anchors'], 'anchor', '锚点', 'direction')
  add(value.direction.blocking_states, ['direction', 'blocking_states'], 'blocking', '调度', 'direction')
  add(value.participants, ['participants'], 'participant', '人物 / 物件', 'participants')
  add(value.events, ['events'], 'event', '事件', 'direction')
  add(value.criteria, ['criteria'], 'criterion', '验收要求', 'direction')
  add(value.performance.situations, ['performance', 'situations'], 'situation', '角色情境', 'performance')
  add(value.performance.beats, ['performance', 'beats'], 'performance', '表演', 'performance')
  add(value.staging.activities, ['staging', 'activities'], 'activity', '镜内活动', 'staging')
  add(value.cinematography, ['cinematography'], 'camera', '摄影', 'cinematography')
  add(value.continuity, ['continuity'], 'continuity', '连续性', 'continuity')
  add(value.sound.dialogues, ['sound', 'dialogues'], 'dialogue', '对白', 'sound')
  return objects
}

/** 图边逐项来自契约引用，表演/声音等间接关联保留经由节拍的路径。 */
export function shotGraph(value: SceneDesign_Input, shotId: string): DesignGraph {
  const registry = designObjects(value)
  const nodes = new Map<string, DesignObject>()
  const edges: DesignEdge[] = []
  const include = (key: string) => {
    if (!nodes.has(key)) nodes.set(key, registry.find(row => row.key === key) || { key, label: `缺失引用 · ${key.split(':').slice(1).join(':')}`, kind: 'missing', path: [] })
  }
  const link = (from: string, to: string, label: string, indirect = false) => {
    include(from); include(to)
    if (!edges.some(e => e.from === from && e.to === to && e.label === label)) edges.push({ from, to, label, indirect })
  }
  const shot = value.direction.shots.find(row => row.id === shotId)
  if (!shot) return { nodes: [], edges: [] }
  const center = `shot:${shot.id}`; include(center)
  shot.beat_ids.forEach(id => link(center, `beat:${id}`, '覆盖节拍'))
  shot.event_ids.forEach(id => link(center, `event:${id}`, '关联事件'))
  shot.criterion_ids.forEach(id => link(center, `criterion:${id}`, '验收依据'))
  shot.blocking_state_ids.forEach(id => {
    const from = `blocking:${id}`
    link(center, from, '调度依据')
    const blocking = value.direction.blocking_states.find(row => row.id === id)
    if (!blocking) return
    link(from, `participant:${blocking.participant_id}`, '调度人物')
    blocking.anchor_ids.forEach(anchor => link(from, `anchor:${anchor}`, '位置锚点'))
    if (blocking.event_id) link(from, `event:${blocking.event_id}`, '变化事件')
  })
  value.cinematography.forEach((row, index) => { if (row.shot_id === shotId) link(center, `camera:${index}`, '摄影设计') })
  value.performance.beats.forEach((row, index) => {
    if (!shot.beat_ids.includes(row.beat_id)) return
    link(`beat:${row.beat_id}`, `performance:${index}`, '节拍表演', true)
    link(`performance:${index}`, `participant:${row.participant_id}`, '表演人物', true)
    row.dialogue_ids.forEach(id => link(`performance:${index}`, `dialogue:${id}`, '对白依据', true))
  })
  value.continuity.forEach(row => { if (row.event_id && shot.event_ids.includes(row.event_id)) link(`event:${row.event_id}`, `continuity:${row.id}`, '连续性变化', true) })
  return { nodes: [...nodes.values()], edges }
}

/** 只统计实际未填/待确定字段及缺失引用；零项不表示经过人工验收。 */
export function shotIssues(value: SceneDesign_Input, shotId: string): string[] {
  const shot = value.direction.shots.find(row => row.id === shotId)
  if (!shot) return ['镜头不存在']
  const issues: string[] = []
  if (['unset', 'unknown'].includes(shot.visible_result.state || 'unset')) issues.push('动作待明确')
  if (['unset', 'unknown'].includes(shot.narrative_function.state || 'unset')) issues.push('叙事待明确')
  if (!shot.estimated_duration_ms) issues.push('时长未填写')
  if (!shot.beat_ids.length) issues.push('未关联节拍')
  for (const [ids, rows] of [[shot.beat_ids, value.direction.beats], [shot.event_ids, value.events], [shot.blocking_state_ids, value.direction.blocking_states], [shot.criterion_ids, value.criteria]] as const) {
    if (ids.some(id => !rows.some(row => row.id === id))) issues.push('关联缺失')
  }
  if (shotGraph(value, shotId).nodes.some(node => node.kind === 'missing')) issues.push('关联缺失')
  return [...new Set(issues)]
}

/** 总览仅聚合真实镜头引用；节拍行可重复引用镜头，全场统计仍使用原镜头集合。 */
export function sceneOverview(value: SceneDesign_Input, visibleIds?: string[]) {
  const graphs = new Map(value.direction.shots.map(shot => [shot.id, shotGraph(value, shot.id)]))
  const scopes: DesignScope[] = value.direction.beats.map(beat => `beat:${beat.id}` as DesignScope)
  if (scopeShots(value, 'unassigned').length) scopes.push('unassigned')
  const rows = scopes.map(scope => {
    const shots = scopeShots(value, scope).filter(shot => !visibleIds || visibleIds.includes(shot.id))
    const objects = new Map<string, DesignObject>()
    shots.forEach(shot => graphs.get(shot.id)?.nodes.forEach(node => {
      if (!node.key.startsWith('shot:') && !node.key.startsWith('beat:')) objects.set(node.key, node)
    }))
    return { scope, shots, objects: [...objects.values()] }
  })
  const frequency = new Map<string, number>()
  rows.forEach(row => row.objects.forEach(node => frequency.set(node.key, (frequency.get(node.key) || 0) + 1)))
  const rank = (node: DesignObject) => node.kind === 'missing' ? -1 : (frequency.get(node.key) || 0) * 10 + (node.key.startsWith('participant:') ? 3 : node.key.startsWith('event:') ? 2 : 0)
  rows.forEach(row => row.objects.sort((a, b) => rank(b) - rank(a)))
  return { rows, graphs, frequency }
}

/** 从镜头出发沿真实引用找解释路径；不以名称或推测补边，缺失引用仍可解释。 */
export function shotRelationPath(graph: DesignGraph, shotId: string, target: string): DesignEdge[] {
  const queue: Array<{ key: string; path: DesignEdge[] }> = [{ key: `shot:${shotId}`, path: [] }]
  const seen = new Set<string>()
  for (let index = 0; index < queue.length; index++) {
    const { key, path } = queue[index]
    if (key === target) return path
    if (seen.has(key)) continue
    seen.add(key)
    graph.edges.filter(edge => edge.from === key && !seen.has(edge.to)).forEach(edge => queue.push({ key: edge.to, path: [...path, edge] }))
  }
  return []
}
