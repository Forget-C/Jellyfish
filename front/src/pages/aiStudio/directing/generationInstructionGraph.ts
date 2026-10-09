import type { WorkspaceRead } from '../../../services/generated'
import { designObjects } from './designWorkspace'
import { designAt } from './designValue'
import { designLabels } from './designLabels'
import { decisionRanges, fixedValue } from './readableText'
import { instructionBlocks, relatedInstructionPath } from './instructionContent'

export type InstructionExpression = 'execution' | 'background' | 'input' | 'text' | 'reference' | 'unexpressed' | 'not-expressed' | 'unmapped'
export type InstructionRequirement = {
  id: string; groupId: string; path: string; label: string; value: unknown; exists: boolean;
  related: boolean; shared: boolean; expressions: InstructionExpression[]; decisions: number[]; occurrenceIds: string[];
}
export type InstructionRequirementGroup = {
  id: string; objectKey: string; path: string; label: string; value: unknown; shared: boolean; missing: boolean;
  related: boolean; coverageIds: string[]; requirementIds: string[];
}
export type InstructionSemanticRelation = {
  id: string; from: string; to: string; kind: 'trigger' | 'acceptance' | 'participation' | 'location' | 'continuity' | 'context';
  label: string; sourcePath: string;
}
export type InstructionGraphGap = { id: string; kind: 'legacy' | 'missing-source' | 'text-only' | 'unmapped-text'; text: string; groupId?: string; path?: string; blockId?: string }

const identity = (...parts: unknown[]) => JSON.stringify(parts)
const pointer = (parts: Array<string | number>) => '/' + parts.map(part => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')

/** 固定版本的只读投影。正文坐标、字段身份和出现项分别保存，不产生第二份业务事实。 */
export function generationInstructionGraph(workspace: WorkspaceRead, promptId: string) {
  const revision = workspace.prompts.find(row => row.id === promptId), prompt = revision?.content
  const plan = workspace.plans.find(row => row.id === prompt?.plan_revision_id)
  const design = workspace.designs.find(row => row.id === plan?.content.design_revision_id)
  const unit = plan?.content.units.find(row => row.id === prompt?.unit_id)
  const contextKey = identity(workspace.sequence.id, promptId, prompt?.plan_revision_id, prompt?.unit_id, plan?.content.design_revision_id)
  const blocks = prompt ? instructionBlocks(prompt, promptId) : []
  const groups: InstructionRequirementGroup[] = [], requirements: InstructionRequirement[] = [], relations: InstructionSemanticRelation[] = [], gaps: InstructionGraphGap[] = []
  const occurrences: Array<{ id: string; requirementId: string; decisionIndex: number; start: number; end: number; blockIds: string[] }> = []
  const groupId = (key: string) => identity('design', plan?.content.design_revision_id, key)
  const gap = (value: Omit<InstructionGraphGap, 'id'>) => {
    const id = identity(contextKey, value.kind, value.groupId, value.path, value.blockId, value.text)
    if (!gaps.some(row => row.id === id)) gaps.push({ ...value, id })
  }
  if (!prompt) gap({ kind: 'missing-source', text: '未找到所选固定指令；不能拼接最新设计和准备记录。' })
  if (prompt && !plan) gap({ kind: 'missing-source', text: '指令绑定的计划缺失，固定输入不可核对。' })
  if (prompt && plan && !unit) gap({ kind: 'missing-source', text: '指令绑定的单元缺失，不能替换为同名或其他单元。' })
  if (prompt && !design) gap({ kind: 'missing-source', text: '固定设计缺失，保留正文和计划输入，不借用当前设计。' })
  if (prompt && prompt.format_version !== 'jellyfish-scene-v4') gap({ kind: 'legacy', text: '历史格式保留完整正文；执行与背景范围未可靠分类。' })
  const ranges = prompt ? decisionRanges(prompt.text, prompt.decisions) : []
  const coverageKeys = new Map<string, Set<string>>()
  if (design && unit) for (const coverage of unit.coverage) {
    const shot = design.content.direction.shots.find(row => row.id === coverage.shot_id)
    const keys = new Set([`shot:${coverage.shot_id}`, ...coverage.beat_ids.map(id => `beat:${id}`), ...coverage.event_ids.map(id => `event:${id}`), ...(shot?.criterion_ids || []).map(id => `criterion:${id}`), ...(shot?.participant_ids || []).map(id => `participant:${id}`)])
    design.content.direction.blocking_states.forEach(state => {
      if (shot?.blocking_state_ids.includes(state.id) && (!state.event_id || coverage.event_ids.includes(state.event_id))) keys.add(`blocking:${state.id}`)
    })
    design.content.cinematography.forEach((camera, index) => { if (camera.shot_id === coverage.shot_id) keys.add(`camera:${index}`) })
    design.content.performance.beats.forEach((performance, index) => {
      if (!coverage.beat_ids.includes(performance.beat_id)) return
      keys.add(`performance:${index}`); performance.dialogue_ids.forEach(id => keys.add(`dialogue:${id}`))
    })
    design.content.continuity.forEach(state => { if (state.event_id && coverage.event_ids.includes(state.event_id)) keys.add(`continuity:${state.id}`) })
    design.content.staging.activities.forEach((activity, index) => {
      if (activity.trigger_event_id && coverage.event_ids.includes(activity.trigger_event_id)) keys.add(`activity:${index}`)
    })
    coverageKeys.set(coverage.id, keys)
  }
  const addRequirement = (group: InstructionRequirementGroup, path: string, value: unknown) => {
    if (requirements.some(row => row.path === path)) return
    const id = identity('requirement', plan?.content.design_revision_id, path)
    const decisions = prompt?.decisions.flatMap((decision, index) => relatedInstructionPath(path, decision.section_path) ? [index] : []) || []
    const expressions = new Set<InstructionExpression>()
    const occurrenceIds: string[] = []
    for (const decisionIndex of decisions) {
      const decision = prompt!.decisions[decisionIndex]
      if (decision.disposition === 'reference') {
        if (unit?.references.some(reference => reference.id === decision.reference_id)) expressions.add('reference')
        else { expressions.add('unmapped'); gap({ kind: 'missing-source', text: '编译声明的参考在固定单元中缺失。', groupId: group.id, path }) }
      }
      else if (decision.disposition === 'unexpressed') expressions.add('unexpressed')
      else {
        const mapped = ranges.filter(row => row.index === decisionIndex)
        if (!mapped.length) { expressions.add('unmapped'); gap({ kind: 'missing-source', text: '编译摘录在固定正文中没有命中，不能伪造正文坐标。', groupId: group.id, path }) }
        for (const range of mapped) {
        const matched = blocks.filter(block => block.start < range.end && block.end > range.start)
        matched.forEach(block => expressions.add(block.section === 'other' ? 'text' : block.section))
        const occurrenceId = identity(promptId, id, decisionIndex, range.start, range.end)
        occurrences.push({ id: occurrenceId, requirementId: id, decisionIndex, start: range.start, end: range.end, blockIds: matched.map(block => block.id) })
        occurrenceIds.push(occurrenceId)
        }
      }
    }
    if (!expressions.size) expressions.add('not-expressed')
    const field = path.split('/').slice(-1)[0]
    const requirement: InstructionRequirement = { id, groupId: group.id, path, label: designLabels[field] || field, value, exists: value !== undefined, related: group.related || !!decisions.length, shared: group.shared, expressions: [...expressions], decisions, occurrenceIds }
    requirements.push(requirement); group.requirementIds.push(id)
    if (decisions.length) group.related = true
    if (value === undefined) gap({ kind: 'missing-source', text: '编译依据在固定设计中不可用，不能据此提供精确字段编辑。', groupId: group.id, path })
  }
  if (design) for (const object of designObjects(design.content)) {
    const path = pointer(object.path), value = designAt(design.content, object.path)
    const coverageIds = [...coverageKeys].filter(([, keys]) => keys.has(object.key)).map(([id]) => id)
    const shared = ['overview', 'performance', 'staging', 'sound', 'prompt'].includes(object.key)
    const group: InstructionRequirementGroup = { id: groupId(object.key), objectKey: object.key, path, label: object.label, value, shared, missing: false, related: shared || !!coverageIds.length, coverageIds, requirementIds: [] }
    groups.push(group)
    const walk = (current: unknown, parts: Array<string | number>) => {
      if (current && typeof current === 'object' && !Array.isArray(current) && 'state' in current) { addRequirement(group, pointer(parts), current); return }
      if (Array.isArray(current)) { current.forEach((child, index) => walk(child, [...parts, index])); return }
      if (current && typeof current === 'object') for (const [field, child] of Object.entries(current)) {
        if (field === 'sources' || field === 'id' || field === 'name' || field.endsWith('_id') || field.endsWith('_ids') || (object.fields && parts.length === object.path.length && !object.fields.includes(field))) continue
        walk(child, [...parts, field])
      }
      else if (current !== undefined) addRequirement(group, pointer(parts), current)
    }
    walk(value, object.path)
  }
  if (design) {
    const group: InstructionRequirementGroup = { id: groupId('project-style'), objectKey: 'project-style', path: '/style_revision_id', label: '项目风格', value: design.content.style_revision_id, shared: true, missing: false, related: true, coverageIds: [], requirementIds: [] }
    groups.push(group); addRequirement(group, group.path, group.value)
  }
  for (const [coverageId, keys] of coverageKeys) for (const key of keys) {
    const existing = groups.find(group => group.objectKey === key)
    if (existing) { if (!existing.coverageIds.includes(coverageId)) existing.coverageIds.push(coverageId); continue }
    const group: InstructionRequirementGroup = { id: groupId(key), objectKey: key, path: '', label: `固定引用缺失 · ${key}`, value: undefined, shared: false, missing: true, related: true, coverageIds: [coverageId], requirementIds: [] }
    groups.push(group); gap({ kind: 'missing-source', text: '固定覆盖引用的对象缺失，保留原始身份供核对。', groupId: group.id })
  }
  const ownerFor = (path: string) => groups.filter(group => path === group.path || path.startsWith(group.path + '/')).sort((a, b) => b.path.length - a.path.length)[0]
  // 编译决定可以引用整个对象或历史未知字段；保留该决定，不伪造有效字段值。
  prompt?.decisions.forEach(decision => {
    if (requirements.some(row => relatedInstructionPath(row.path, decision.section_path))) return
    let group = ownerFor(decision.section_path)
    if (!group) {
      group = { id: groupId(`unmapped:${decision.section_path}`), objectKey: `unmapped:${decision.section_path}`, path: decision.section_path, label: '未映射的编译依据', value: undefined, shared: false, missing: true, related: true, coverageIds: [], requirementIds: [] }
      groups.push(group)
    }
    addRequirement(group, decision.section_path, fixedValue(design?.content, decision.section_path))
  })
  const link = (owner: InstructionRequirementGroup, targetKey: string, field: string, kind: InstructionSemanticRelation['kind'], label: string, reverse = false) => {
    let target = groups.find(group => group.objectKey === targetKey)
    if (!target) {
      target = { id: groupId(targetKey), objectKey: targetKey, path: '', label: `固定引用缺失 · ${targetKey}`, value: undefined, shared: false, missing: true, related: owner.related, coverageIds: [], requirementIds: [] }
      groups.push(target); gap({ kind: 'missing-source', text: '固定对象引用缺失，关系保留原始身份。', groupId: target.id })
    }
    const from = reverse ? target.id : owner.id, to = reverse ? owner.id : target.id
    const sourcePath = `${owner.path}/${field}`, id = identity(from, to, kind, sourcePath)
    if (!relations.some(row => row.id === id)) relations.push({ id, from, to, kind, label, sourcePath })
  }
  for (const group of [...groups]) {
    if (!group.value || typeof group.value !== 'object') continue
    const row = group.value as Record<string, unknown>
    const references: Array<[string, string, InstructionSemanticRelation['kind'], string, boolean]> = [
      ['participant_id', 'participant', 'participation', '参与对象', true], ['participant_ids', 'participant', 'participation', '参与对象', true],
      ['anchor_id', 'anchor', 'location', '空间位置', true], ['anchor_ids', 'anchor', 'location', '空间位置', true],
      ['criterion_ids', 'criterion', 'acceptance', '验收要求', true], ['blocking_state_ids', 'blocking', 'context', '调度依据', false],
      ['trigger_event_id', 'event', 'trigger', '触发活动', true], ['received_event_ids', 'event', 'context', '接收刺激', true],
      ['event_ids', 'event', 'context', '事件引用', false], ['event_id', 'event', group.objectKey.startsWith('continuity:') ? 'continuity' : 'context', group.objectKey.startsWith('continuity:') ? '连续性依据' : '变化事件', true],
      ['shot_id', 'shot', 'context', '摄影归属', false], ['beat_id', 'beat', 'context', '节拍归属', false], ['beat_ids', 'beat', 'context', '覆盖节拍', false],
      ['dialogue_ids', 'dialogue', 'context', '对白依据', true],
    ]
    for (const [field, prefix, kind, label, reverse] of references) {
      const values = Array.isArray(row[field]) ? row[field] : row[field] ? [row[field]] : []
      for (const value of values as unknown[]) if (typeof value === 'string') link(group, `${prefix}:${value}`, field, kind, label, reverse)
    }
  }
  // 引用可补足核对背景；事件、节拍及动作的覆盖仍以单元声明为准，不沿共享镜头扩张。
  let changed = true
  while (changed) {
    changed = false
    for (const relation of relations) {
      const owner = ownerFor(relation.sourcePath), referenced = groups.find(group => group.id === (owner?.id === relation.from ? relation.to : relation.from))
      if (owner?.related && referenced) {
        if (!referenced.related) { referenced.related = true; changed = true }
        const rangeSensitive = /^(event|beat|blocking|performance|activity|continuity|dialogue):/.test(referenced.objectKey)
        const additional = owner.coverageIds.filter(id => !referenced.coverageIds.includes(id) && (!rangeSensitive || coverageKeys.get(id)?.has(referenced.objectKey)))
        if (additional.length) { referenced.coverageIds.push(...additional); changed = true }
      }
    }
  }
  for (const requirement of requirements) {
    requirement.related = !!groups.find(group => group.id === requirement.groupId)?.related
    if (requirement.related && /\/(reaction_order|reaction_delay|movement_trigger|adjacent_requirements)$/.test(requirement.path) && requirement.value && typeof requirement.value === 'object' && 'text' in requirement.value && requirement.value.text) gap({ kind: 'text-only', text: '条件／时序说明保留原文，尚无明确的两端要求引用；未自动推断关系。', groupId: requirement.groupId, path: requirement.path })
  }
  for (const block of blocks) if (!block.decisions.length) gap({ kind: 'unmapped-text', text: '正文保留完整原文；此片段没有可靠字段映射。', blockId: block.id })
  const coverage = unit?.coverage.map(item => ({ ...item, occurrenceId: identity('coverage', plan!.id, unit.id, item.id), groupIds: groups.filter(group => group.coverageIds.includes(item.id)).map(group => group.id) })) || []
  return { contextKey, promptId, prompt, planId: plan?.id, designId: design?.id, unitId: unit?.id, unit, blocks, groups, requirements, occurrences, relations, gaps, coverage }
}

/** 单项要求可关联多个正文出现项；返回全部真实坐标，不选任意首次命中代替完整影响。 */
export function requirementOccurrences(graph: ReturnType<typeof generationInstructionGraph>, requirementId: string) {
  return graph.occurrences.filter(occurrence => occurrence.requirementId === requirementId)
}
