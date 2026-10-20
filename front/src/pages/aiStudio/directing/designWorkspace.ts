import type { SceneDesign_Input, SceneRelationshipGraph } from '../../../services/generated'
import { designAt, designObjectSnapshot, noteText, patchDesign } from './designValue'
import type { DesignPath } from './designValue'

export type DesignObject = { key: string; label: string; kind: string; path: DesignPath; fields?: string[] }
export type DesignEdge = { from: string; to: string; label: string; indirect?: boolean; field?: string; path?: DesignEdge[] }
export type DesignGraph = { nodes: DesignObject[]; edges: DesignEdge[] }

/** 范围摘要只读取服务端字段用途，不用前端图连通性重判全场或镜头归属。 */
export function designScopeLabel(graph: SceneRelationshipGraph | undefined, key: string): string | undefined {
  const node = graph?.nodes.find(row => row.key === key)
  if (!node) return undefined
  const uses = graph?.uses.filter(row => row.owner === key && row.has_content !== false) || []
  const global = uses.some(row => row.scope === 'scene' || row.scope === 'scene_rule')
  const local = uses.some(row => row.scope === 'shots' || row.scope === 'occurrences')
  const incomplete = graph?.issues?.some(row => row.owner === key)
  if (incomplete) return '设计未完整 · 查看字段缺项'
  if (global && local) return '全场与局部内容 · 逐项查看'
  if (node.placement === 'scene_background') return '全场背景 · 无需逐镜关联'
  if (node.placement === 'scene_rule') return '全场规则'
  if (node.placement === 'occurrences') return '明确适用于单元出现项'
  if (node.placement === 'shots') return `明确适用于 ${node.shot_ids?.length || 0} 个镜头`
  return node.placement === 'pending_shot' ? '待归镜头 · 设计未完整' : '未关联 · 设计未完整'
}
export type RelationBinding = { path: DesignPath; prefix: string; target: string; many: boolean; required: boolean }
export const departmentNames: Record<string, string> = { direction: '总导演', performance: '表演指导', staging: '镜内执行', cinematography: '摄影指导', continuity: '场记与连续性', sound: '对白与声音', prompt: '提示词指导' }

export const designDomains = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'sound', 'prompt'] as const
export type DesignDomain = typeof designDomains[number]
export type DirectorDesignView = { domain?: DesignDomain; scope: 'all' | 'shot'; shotId?: string; temporaryKey?: string }

/** 正式归属来自业务职责；共享对象的引用次数不改变归属。 */
export function designDomain(key: string): DesignDomain | undefined {
  const kind = key.split(':')[0]
  if (['overview', 'space', 'shot', 'beat', 'anchor', 'blocking'].includes(kind)) return 'direction'
  if (kind === 'situation' || kind === 'performance') return 'performance'
  if (kind === 'activity' || kind === 'staging') return 'staging'
  if (kind === 'camera') return 'cinematography'
  if (kind === 'continuity' || kind === 'sound' || kind === 'prompt') return kind
  if (kind === 'dialogue') return 'sound'
  return undefined
}

const globalDesignKeys = ['overview', 'space', 'performance', 'staging', 'sound', 'prompt', 'location']

/** 逐镜浏览按契约引用选取；共享人物和验收不会反向吸入其他工作单。 */
function directorShotKeys(value: SceneDesign_Input, graph: DesignGraph, shotId?: string): Set<string> {
  const keys = new Set(globalDesignKeys)
  const shot = value.direction.shots.find(row => row.id === shotId)
  if (!shot) return keys
  const add = (prefix: string, ids: string[]) => ids.forEach(id => keys.add(`${prefix}:${id}`))
  keys.add(`shot:${shot.id}`)
  add('beat', shot.beat_ids); add('blocking', shot.blocking_state_ids)
  const events = new Set(shot.event_ids), people = new Set(shot.participant_ids || [])
  value.direction.beats.filter(row => shot.beat_ids.includes(row.id)).forEach(row => row.event_ids.forEach(id => events.add(id)))
  value.direction.blocking_states.filter(row => shot.blocking_state_ids.includes(row.id)).forEach(row => {
    add('anchor', row.anchor_ids)
    if (row.event_id) events.add(row.event_id)
  })
  value.performance.beats.forEach((row, index) => {
    if (!shot.beat_ids.includes(row.beat_id)) return
    keys.add(`performance:${row.id || index}`); people.add(row.participant_id)
    row.received_event_ids.forEach(id => events.add(id)); add('dialogue', row.dialogue_ids)
  })
  value.performance.situations.forEach((row, index) => { if (people.has(row.participant_id)) keys.add(`situation:${row.id || index}`) })
  value.cinematography.forEach((row, index) => { if (row.shot_id === shot.id) keys.add(`camera:${row.id || index}`) })
  value.staging.activities.forEach((row, index) => { if (row.trigger_event_id && events.has(row.trigger_event_id)) keys.add(`activity:${row.id || index}`) })
  value.continuity.forEach(row => { if (row.event_id && events.has(row.event_id)) keys.add(`continuity:${row.id}`) })
  add('event', [...events]); add('participant', shot.participant_ids || [])
  // 只补齐选中工作单的共享引用，不继续展开共享对象的其他引用者。
  // 只沿已选对象的字段方向补依赖；活动引用的空间锚点也属于本镜关联集合。
  const outgoing = new Map<string, DesignEdge[]>()
  graph.edges.filter(edge => !edge.indirect).forEach(edge => outgoing.set(edge.from, [...outgoing.get(edge.from) || [], edge]))
  const pending = [...keys].filter(key => !globalDesignKeys.includes(key))
  while (pending.length) {
    const from = pending.pop()!
    outgoing.get(from)?.forEach(edge => {
      if (keys.has(edge.to)) return
      keys.add(edge.to)
      if (!globalDesignKeys.includes(edge.to)) pending.push(edge.to)
    })
  }
  return keys
}

/** 七域共享同一关系来源；外层压缩正式成员，子图以紧凑引用承接跨域关系。 */
export function directorDesignGraph(value: SceneDesign_Input, view: DirectorDesignView) {
  const graph = sceneDesignGraph(value)
  const allObjects = graph.nodes.map(node => node.key === 'overview' ? { ...node, label: '全场叙事与约束',
    fields: ['viewpoint', 'information_change', 'relationship_change', 'turning_point', 'immutable_facts', 'open_questions', 'control_level'] } : node)
  allObjects.push({ key: 'space', label: '空间规则', kind: 'direction', path: ['direction'], fields: ['spatial_basis', 'shootable_area', 'axis', 'scale'] },
    { key: 'location', label: '本场场所', kind: 'location', path: ['direction'], fields: ['location_asset_id'] })
  const relatedKeys = directorShotKeys(value, graph, view.shotId)
  const temporaryKey = view.temporaryKey && designDomain(view.temporaryKey) === view.domain ? view.temporaryKey : undefined
  const objects = allObjects.filter(node => view.scope === 'all' || relatedKeys.has(node.key) || node.key === temporaryKey)
  const visibleEdges = graph.edges.filter(edge => view.scope === 'all' || edge.from === temporaryKey && !edge.indirect || relatedKeys.has(edge.from) &&
    (!edge.indirect || relatedKeys.has(edge.to) && edge.path?.every(step => relatedKeys.has(step.from) && relatedKeys.has(step.to))))
  const groups = designDomains.map(domain => ({ domain, members: objects.filter(node => node.kind !== 'missing' && designDomain(node.key) === domain) }))
  if (view.domain) {
    const members = groups.find(group => group.domain === view.domain)!.members
    const keys = new Set(members.map(node => node.key))
    const edges = visibleEdges.filter(edge => keys.has(edge.from) || keys.has(edge.to))
    const references = new Set(edges.flatMap(edge => [edge.from, edge.to]).filter(key => !keys.has(key)))
    return { nodes: [...members, ...allObjects.filter(node => references.has(node.key)).map(node => node.kind === 'missing' ? node : { ...node, kind: 'reference' })], edges, groups, relatedKeys }
  }
  const nodes = objects.filter(node => node.kind === 'missing' || !designDomain(node.key))
  groups.forEach(group => nodes.push({ key: `domain:${group.domain}`, label: departmentNames[group.domain], kind: 'summary', path: [] }))
  const edges = new Map<string, ProjectedDesignEdge>()
  const projectedKey = (key: string) => allObjects.find(node => node.key === key)?.kind === 'missing' ? key : designDomain(key) ? `domain:${designDomain(key)}` : key
  visibleEdges.forEach(edge => {
    const from = projectedKey(edge.from), to = projectedKey(edge.to)
    if (from === to) return
    const key = JSON.stringify([from, to, edge.label, !!edge.indirect])
    const existing = edges.get(key)
    if (existing) existing.sources.push(...(edge.path || [edge]))
    else edges.set(key, { ...edge, from, to, sources: edge.path || [edge] })
  })
  return { nodes, edges: [...edges.values()], groups, relatedKeys }
}

export type ShotCanvasLocation = 'global' | 'shared' | 'unlinked' | string

/** 保存修订已决定归位与引用；此投影只压缩总览并筛选逐镜可见对象。 */
export function authoritativeShotCanvasProjection(value: SceneDesign_Input, authority: SceneRelationshipGraph) {
  const authorityKeys = new Set(authority.nodes.map(node => node.key))
  const objects = designObjects(value).map(node => node.key === 'overview' ? { ...node, label: '全场叙事与约束',
    fields: ['viewpoint', 'information_change', 'relationship_change', 'turning_point', 'open_questions', 'control_level'] } : node)
  objects.push({ key: 'space', label: '空间规则', kind: 'direction', path: ['direction'], fields: ['spatial_basis', 'shootable_area', 'axis', 'scale'] },
    { key: 'location', label: '本场场所', kind: 'location', path: ['direction'], fields: ['location_asset_id'] })
  const objectKeys = new Set(objects.map(node => node.key))
  authority.nodes.filter(node => node.missing && !objectKeys.has(node.key)).forEach(node =>
    objects.push({ key: node.key, label: `缺失引用 · ${node.key}`, kind: 'missing', path: [] }))
  const byKey = new Map(authority.nodes.map(node => [node.key, node]))
  const memberships = new Map(authority.nodes.map(node => [node.key, node.shot_ids || []] as const))
  const location = (key: string): ShotCanvasLocation => {
    const node = byKey.get(key)
    if (!node || node.placement === 'unlinked' || node.placement === 'pending_shot') return 'unlinked'
    if (node.placement === 'scene_background' || node.placement === 'scene_rule') return 'global'
    if ((node.shot_ids?.length || 0) > 1) return 'shared'
    return node.shot_ids?.[0] || 'unlinked'
  }
  const direct: DesignEdge[] = authority.edges.map(edge => ({ from: edge.owner, to: edge.target,
    label: edge.field, field: edge.field }))
  const view = (shotId?: string) => {
    if (!shotId) {
      const nodes = objects.filter(node => ['global', 'shared'].includes(location(node.key)) || node.key.startsWith('shot:') && authorityKeys.has(node.key))
      const keys = new Set(nodes.map(node => node.key))
      return { nodes, unlinked: objects.filter(node => location(node.key) === 'unlinked'),
        edges: direct.filter(edge => keys.has(edge.from) && keys.has(edge.to)).map(edge => ({ ...edge, sources: [edge] })), memberships, location }
    }
    const owned = objects.filter(node => location(node.key) === shotId)
    const ownedKeys = new Set(owned.map(node => node.key))
    const referenceKeys = new Set(direct.filter(edge => ownedKeys.has(edge.from) && location(edge.to) === 'shared' ||
      ownedKeys.has(edge.to) && location(edge.from) === 'shared').flatMap(edge => [edge.from, edge.to])
      .filter(key => location(key) === 'shared'))
    const visible = new Set([...ownedKeys, ...referenceKeys])
    return { nodes: [...owned, ...objects.filter(node => referenceKeys.has(node.key)).map(node => ({ ...node, kind: 'reference' }))],
      unlinked: [], edges: direct.filter(edge => visible.has(edge.from) && visible.has(edge.to)).map(edge => ({ ...edge, sources: [edge] })), memberships, location }
  }
  return { view, objects, memberships, location, direct }
}

/** 一次建立整场关系和逐镜集合，再投影总览与每个镜头。 */
export function shotCanvasProjection(value: SceneDesign_Input) {
  const graph = sceneDesignGraph(value, false)
  const nodes = graph.nodes.map(node => node.key === 'overview' ? { ...node, label: '全场叙事与约束',
    fields: ['viewpoint', 'information_change', 'relationship_change', 'turning_point', 'immutable_facts', 'open_questions', 'control_level'] } : node)
  nodes.push({ key: 'space', label: '空间规则', kind: 'direction', path: ['direction'], fields: ['spatial_basis', 'shootable_area', 'axis', 'scale'] },
    { key: 'location', label: '本场场所', kind: 'location', path: ['direction'], fields: ['location_asset_id'] })
  const memberships = new Map<string, string[]>()
  const shotKeys = new Map<string, Set<string>>()
  value.direction.shots.forEach(shot => {
    const related = directorShotKeys(value, graph, shot.id)
    shotKeys.set(shot.id, related)
    related.forEach(key => {
      if (globalDesignKeys.includes(key)) return
      memberships.set(key, [...memberships.get(key) || [], shot.id])
    })
  })
  const location = (key: string): ShotCanvasLocation => globalDesignKeys.includes(key) ? 'global'
    : key.startsWith('shot:') ? key.slice(5)
      : (memberships.get(key)?.length || 0) > 1 ? 'shared'
        : memberships.get(key)?.[0] || 'unlinked'
  const direct = graph.edges.filter(edge => !edge.indirect)
  const relationPath = (shotId: string, target: string, related: Set<string>) => {
    const start = `shot:${shotId}`
    const search = (allowReverse: boolean): DesignEdge[] => {
      const pending = [{ key: start, path: [] as DesignEdge[] }], visited = new Set([start])
      while (pending.length) {
        const current = pending.shift()!
        if (current.key === target) return current.path
        direct.forEach(edge => {
          const next = edge.from === current.key ? edge.to : allowReverse && edge.to === current.key ? edge.from : undefined
          if (!next || !related.has(next) || visited.has(next)) return
          visited.add(next); pending.push({ key: next, path: [...current.path, edge] })
        })
      }
      return []
    }
    const forward = search(false)
    return forward.length ? forward : search(true)
  }
  const view = (shotId?: string) => {
    if (!shotId) {
      const visible = nodes.filter(node => ['global', 'shared'].includes(location(node.key)) || node.key.startsWith('shot:'))
      const keys = new Set(nodes.map(node => node.key))
      const edges: ProjectedDesignEdge[] = direct.filter(edge => keys.has(edge.from) && keys.has(edge.to) &&
        (location(edge.from) === 'global' || location(edge.from) === 'shared' || location(edge.from) === 'unlinked') &&
        (location(edge.to) === 'global' || location(edge.to) === 'shared' || location(edge.to) === 'unlinked')).map(edge => ({ ...edge, sources: [edge] }))
      memberships.forEach((ids, key) => {
        if (location(key) !== 'shared') return
        ids.forEach(id => {
          const related = shotKeys.get(id) || new Set<string>()
          const path = relationPath(id, key, related)
          const sources = [...path, ...direct.filter(edge => (edge.to === key || edge.from === key) &&
            related.has(edge.from) && related.has(edge.to) && !path.includes(edge))]
          edges.push({ from: `shot:${id}`, to: key, label: '镜头关联', sources })
        })
      })
      return { nodes: visible, unlinked: nodes.filter(node => location(node.key) === 'unlinked'), edges, memberships, location }
    }
    const owned = nodes.filter(node => location(node.key) === shotId)
    const ownedKeys = new Set(owned.map(node => node.key))
    const related = shotKeys.get(shotId) || new Set<string>()
    const referenceKeys = new Set(direct.filter(edge =>
      (ownedKeys.has(edge.from) && location(edge.to) === 'shared' || ownedKeys.has(edge.to) && location(edge.from) === 'shared') &&
      related.has(edge.from) && related.has(edge.to)).flatMap(edge => [edge.from, edge.to]).filter(key => location(key) === 'shared'))
    const visible = new Set([...ownedKeys, ...referenceKeys])
    return { nodes: [...owned, ...nodes.filter(node => referenceKeys.has(node.key)).map(node => ({ ...node, kind: 'reference' }))],
      unlinked: [], edges: direct.filter(edge => visible.has(edge.from) && visible.has(edge.to)).map(edge => ({ ...edge, sources: [edge] })),
      memberships, location }
  }
  return { view, location, memberships, objects: nodes }
}

/** 依据确定的逐镜引用归位；同一对象在整场只有一张可编辑原卡。 */
export function shotCanvasGraph(value: SceneDesign_Input, shotId?: string) {
  return shotCanvasProjection(value).view(shotId)
}

export type DesignScope = 'all' | 'unassigned' | `beat:${string}`

/** 范围仅筛选原镜头；跨节拍镜头保持同一身份，全场统计不会重复。 */
export function scopeShots(value: SceneDesign_Input, scope: DesignScope) {
  return value.direction.shots.filter(shot => scope === 'all' || (scope === 'unassigned'
    ? !shot.beat_ids.some(id => value.direction.beats.some(beat => beat.id === id))
    : shot.beat_ids.includes(scope.slice(5))))
}

/** 仅重排筛选集合占用的槽位，隐藏镜头的相对顺序和全部对象内容保持不变。 */
export function reorderScopeShots<T extends SceneDesign_Input>(value: T, visibleIds: string[], fromId: string, toId: string): T {
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
  const owner = designObjects(value).find(node => node.key === edge.from)
  if (owner && edge.field) {
    const current = designAt(value, [...owner.path, edge.field])
    if (current === toId || Array.isArray(current) && current.includes(toId)) return {
      path: [...owner.path, edge.field], prefix: toKind, target: toId,
      many: Array.isArray(current), required: ['participant_id', 'beat_id', 'shot_id'].includes(edge.field),
    }
  }
  if (fromKind === 'shot') {
    const index = value.direction.shots.findIndex(shot => shot.id === fromId)
    const field = { beat: 'beat_ids', event: 'event_ids', criterion: 'criterion_ids', blocking: 'blocking_state_ids', participant: 'participant_ids' }[toKind]
    if (index >= 0 && field) return { path: ['direction', 'shots', index, field], prefix: toKind, target: toId, many: true, required: false }
    const cameraIndex = value.cinematography.findIndex((row, index) => (row.id || String(index)) === toId)
    if (toKind === 'camera' && cameraIndex >= 0 && value.cinematography[cameraIndex].shot_id === fromId) return { path: ['cinematography', cameraIndex, 'shot_id'], prefix: 'shot', target: fromId, many: false, required: true }
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
    const text = typeof row.name === 'string' ? row.name : [row.visible_result, row.objective, row.description, row.requirement, row.content, row.physical_action, row.ongoing_task, row.position, row.after, row.situation].map(noteText).find(Boolean)
    objects.push({ key: `${prefix}:${row.id || index}`, label: `${label} ${String(index + 1).padStart(2, '0')}${text ? ` · ${text}` : ''}`, kind, path: [...path, index] })
  })
  add(value.direction.shots, ['direction', 'shots'], 'shot', '镜头', 'direction')
  add(value.direction.beats, ['direction', 'beats'], 'beat', '节拍', 'direction')
  add(value.direction.anchors, ['direction', 'anchors'], 'anchor', '锚点', 'direction')
  add(value.direction.immutable_facts, ['direction', 'immutable_facts'], 'fact', '不变事实', 'direction')
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

/** 有 ID 的工作单按身份定位；历史无 ID 行沿用自然键或快照布局。 */
export function designObjectLayoutId(value: SceneDesign_Input, node: DesignObject): string {
  const kind = node.key.split(':')[0]
  if (node.kind === 'missing') return node.key
  if (['camera', 'performance', 'situation', 'activity'].includes(kind) && designAt(value, node.path)?.id) return node.key
  if (kind === 'camera' || kind === 'performance' && node.key.includes(':')) {
    const row = designAt(value, node.path), rows = designAt(value, node.path.slice(0, -1)) as Record<string, unknown>[]
    const fields = kind === 'camera' ? ['shot_id'] : ['beat_id', 'participant_id']
    if (fields.some(field => !row?.[field]) || rows.filter(item => fields.every(field => item[field] === row[field])).length !== 1) return `${kind}:ambiguous:${node.path[node.path.length - 1]}`
    return `${kind}:${fields.map(field => encodeURIComponent(row[field])).join(':')}`
  }
  if (kind !== 'situation' && kind !== 'activity') return node.key
  const row = designAt(value, node.path)
  const rows = designAt(value, node.path.slice(0, -1)) as unknown[]
  const identity = designObjectSnapshot(row)
  if (rows.filter(item => designObjectSnapshot(item) === identity).length !== 1) return `${kind}:ambiguous:${node.path[node.path.length - 1]}`
  return `${kind}:${encodeURIComponent(identity)}`
}

const coreFields: Record<string, string[]> = {
  overview: ['viewpoint', 'information_change', 'turning_point'], space: ['spatial_basis', 'shootable_area', 'axis', 'scale'],
  shot: ['visible_result', 'narrative_function'], beat: ['objective', 'expected_change'], anchor: ['description'], performance: ['applicability'],
  staging: ['environment', 'intentional_absence'], sound: ['sources', 'ambience_actions', 'music_constraints'],
  prompt: ['priorities', 'binding_requirements', 'sound_strategy', 'prohibitions'],
  blocking: ['position', 'orientation', 'path'], situation: ['situation', 'relationship'],
  camera: ['composition', 'movement_path', 'end_frame'], continuity: ['before', 'after', 'following_constraint'],
  activity: ['ongoing_task', 'depth'], dialogue: ['content'], criterion: ['requirement'], participant: ['name'],
}
const coreText = (item: unknown): string => {
  if (typeof item === 'string') return item.trim()
  if (!item || typeof item !== 'object') return ''
  const note = item as { state?: string; text?: string; reason?: string }
  if (note.state === 'none') return '明确没有'
  if (note.state === 'not_applicable') return '不适用'
  if (note.state === 'unset' || note.state === 'unknown') return ''
  return (note.text || note.reason || '').trim()
}

/** 摘要只计算明确核心内容；ID、默认枚举和空结构不计为已填写。 */
export function designCoreContent(value: SceneDesign_Input, node: DesignObject): string {
  const row = designAt(value, node.path)
  const kind = node.key.split(':')[0]
  const fields = kind === 'performance' && node.key.includes(':') ? ['physical_action', 'objective'] : coreFields[kind] || []
  return fields.map(field => coreText(row?.[field])).find(Boolean) || ''
}

export type ProjectedDesignEdge = DesignEdge & { sources: DesignEdge[] }

const designReferences: Record<string, [string, string, string][]> = {
  shot: [['participant_ids', 'participant', '参与对象'], ['beat_ids', 'beat', '覆盖节拍'], ['event_ids', 'event', '关联事件'], ['criterion_ids', 'criterion', '验收依据'], ['blocking_state_ids', 'blocking', '调度依据']],
  beat: [['event_ids', 'event', '关联事件']],
  blocking: [['participant_id', 'participant', '调度人物'], ['anchor_ids', 'anchor', '位置锚点'], ['event_id', 'event', '变化事件']],
  situation: [['participant_id', 'participant', '情境人物']],
  performance: [['beat_id', 'beat', '所属节拍'], ['participant_id', 'participant', '表演人物'], ['received_event_ids', 'event', '接收事件'], ['dialogue_ids', 'dialogue', '对白依据'], ['criterion_ids', 'criterion', '验收依据']],
  activity: [['participant_id', 'participant', '活动人物'], ['anchor_id', 'anchor', '空间锚点'], ['trigger_event_id', 'event', '触发事件']],
  camera: [['shot_id', 'shot', '所属镜头'], ['criterion_ids', 'criterion', '验收依据']],
  continuity: [['participant_id', 'participant', '连续性对象'], ['event_id', 'event', '变化事件']],
  dialogue: [['participant_id', 'participant', '说话对象']],
}

/** 整场图直接读取当前设计对象的字段引用，与当前镜头是否选择无关。 */
export function sceneDesignGraph(value: SceneDesign_Input, includeIndirect = true): DesignGraph {
  const registry = new Map(designObjects(value).map(node => [node.key, node]))
  const nodes = new Map(registry), edges: DesignEdge[] = []
  registry.forEach(node => {
    const row = designAt(value, node.path)
    const kind = node.key.split(':')[0]
    for (const [field, prefix, label] of designReferences[kind] || []) {
      const raw = row?.[field]
      for (const id of raw == null ? [] : Array.isArray(raw) ? raw : [raw]) {
        if (typeof id !== 'string' || !id) continue
        const target = `${prefix}:${id}`
        if (!nodes.has(target)) nodes.set(target, { key: target, label: `缺失引用 · ${id}`, kind: 'missing', path: [] })
        edges.push({ from: node.key, to: target, label, field })
      }
    }
  })
  const outgoing = new Map<string, DesignEdge[]>()
  edges.forEach(edge => outgoing.set(edge.from, [...outgoing.get(edge.from) || [], edge]))
  // 只沿真实字段引用遍历无环路径；每条虚线保留完整来源链。
  const follow = (source: string, current: string, path: DesignEdge[], visited: Set<string>) => {
    for (const edge of outgoing.get(current) || []) {
      if (!registry.has(edge.to) || visited.has(edge.to)) continue
      const next = [...path, edge]
      if (next.length > 1) edges.push({ from: source, to: edge.to, label: next.map(item => item.label).join(' → '), indirect: true, path: next })
      follow(source, edge.to, next, new Set([...visited, edge.to]))
    }
  }
  if (includeIndirect) registry.forEach(node => follow(node.key, node.key, [], new Set([node.key])))
  return { nodes: [...nodes.values()], edges }
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
  shot.participant_ids?.forEach(id => link(center, `participant:${id}`, '参与对象'))
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
  value.cinematography.forEach((row, index) => { if (row.shot_id === shotId) link(center, `camera:${row.id || index}`, '摄影设计') })
  value.performance.beats.forEach((row, index) => {
    if (!shot.beat_ids.includes(row.beat_id)) return
    link(`beat:${row.beat_id}`, `performance:${row.id || index}`, '节拍表演', true)
    link(`performance:${row.id || index}`, `participant:${row.participant_id}`, '表演人物', true)
    row.dialogue_ids.forEach(id => link(`performance:${row.id || index}`, `dialogue:${id}`, '对白依据', true))
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
  if (shot.participant_ids == null) issues.push('参与对象范围待核对')
  for (const [ids, rows] of [[shot.beat_ids, value.direction.beats], [shot.event_ids, value.events], [shot.blocking_state_ids, value.direction.blocking_states], [shot.criterion_ids, value.criteria], [shot.participant_ids || [], value.participants]] as const) {
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
