import type { CompilationDecision, GenerationUnit_Output, ReferenceBinding_Input, SceneDesign_Input, WorkspaceRead } from '../../../services/generated'
import { revisionName } from './workspaceUsage'
import { designLabels } from './designLabels'
import { referenceGroups, referencePurposes, referenceRoles } from './referenceInput'

export type ReadableEntity = { id: string; kind: string; label: string; path?: string; value?: unknown; references?: ReferenceBinding_Input[] }
export type ReadableContext = { design?: SceneDesign_Input; entities: ReadableEntity[]; unit?: GenerationUnit_Output; snapshotLabel?: string; identity?: string }
export type ReadableSegment = { start: number; end: number; label: string; entity?: ReadableEntity; unresolved?: boolean }
const number = (index: number) => String(index + 1).padStart(2, '0')
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const fields: Record<string, string> = { participant_id: '人物', participant_ids: '人物', shot_id: '镜头', beat_id: '节拍', beat_ids: '节拍', event_id: '事件', event_ids: '事件', received_event_ids: '事件', trigger_event_id: '事件', anchor_id: '空间锚点', anchor_ids: '空间锚点', blocking_state_ids: '调度状态', criterion_ids: '验收标准', dialogue_ids: '对白', character_id: '角色资产', prop_id: '道具资产', location_asset_id: '场所资产' }
const collections: Record<string, string> = { participants: '人物', events: '事件', criteria: '验收标准', shots: '镜头', beats: '节拍', anchors: '空间锚点', blocking_states: '调度状态', continuity: '连续性', dialogues: '对白' }
const enums: Record<string, Record<string, string>> = {
  purpose: referencePurposes, input_role: referenceRoles,
  execution: { postproduction: '待后期处理', generated: '同期生成', unknown: '待确定' },
  domain: { space: '空间', appearance: '外观', hands_props: '手部与道具', environment: '环境', camera: '摄影', dialogue_sound: '对白与声音' },
}

/** 仅从指令所属的固定设计和单元取名，不读取项目资产的当前状态。 */
export function readableContext(design?: SceneDesign_Input, unit?: GenerationUnit_Output): ReadableContext {
  const entities: ReadableEntity[] = []
  const addRows = (rows: unknown[], path: string, kind: string) => rows.forEach((value, index) => {
    const row = value as Record<string, unknown>
    if (typeof row.id !== 'string') return
    const name = typeof row.name === 'string' ? row.name : undefined
    const duplicate = name && rows.filter(item => (item as { name?: string }).name === name).length > 1
    entities.push({ id: row.id, kind, label: name ? `${name}${duplicate ? ` · ${kind} ${number(index)}` : ''}` : `${kind} ${number(index)}`, path: `${path}/${index}`, value })
  })
  if (design) {
    addRows(design.participants, '/participants', '人物')
    addRows(design.events, '/events', '事件')
    addRows(design.criteria, '/criteria', '验收标准')
    for (const key of ['shots', 'beats', 'anchors', 'blocking_states'] as const) addRows(design.direction[key], `/direction/${key}`, collections[key])
    addRows(design.continuity, '/continuity', '连续性')
    addRows(design.sound.dialogues, '/sound/dialogues', '对白')
    for (const [index, person] of design.participants.entries()) for (const key of ['character_id', 'prop_id'] as const) {
      if (person[key]) entities.push({ id: person[key]!, kind: fields[key], label: `${person.name} · 关联${key === 'character_id' ? '角色' : '道具'}`, path: `/participants/${index}/${key}`, value: person[key] })
    }
    if (design.direction.location_asset_id) entities.push({ id: design.direction.location_asset_id, kind: '场所资产', label: '本场场所资产', path: '/direction/location_asset_id', value: design.direction.location_asset_id })
  }
  referenceGroups(unit?.references || []).forEach((refs, index) => {
    const ref = refs[0]
    const name = ref.asset_origin?.name || design?.participants.filter(person => ref.participant_ids.includes(person.id)).map(person => person.name).join('、') || `参考 ${number(index)}`
    const label = `${name} · ${referencePurposes[ref.purpose]} · 参考 ${number(index)}`
    const groupId = ref.subject_group_id || ref.id
    for (const id of new Set([groupId, ...refs.map(item => item.id)])) entities.push({ id, kind: '参考', label, references: id === groupId ? refs : refs.filter(item => item.id === id), value: id === groupId ? refs : refs.find(item => item.id === id) })
  })
  return { design, unit, entities }
}

/** 按被查看的指令回溯版本，不使用当前编辑器选择的设计或计划。 */
export function contextForPrompt(workspace: WorkspaceRead, promptId?: string): ReadableContext {
  const prompt = workspace.prompts.find(row => row.id === promptId)
  const plan = workspace.plans.find(row => row.id === prompt?.content.plan_revision_id)
  const design = workspace.designs.find(row => row.id === plan?.content.design_revision_id)
  const unit = plan?.content.units.find(row => row.id === prompt?.content.unit_id)
  return { ...readableContext(design?.content, unit), identity: JSON.stringify([workspace.sequence.id, promptId, plan?.id, design?.id]), snapshotLabel: `固定依据：${prompt ? revisionName(workspace.prompts, prompt.id, '指令') : '指令缺失'} · ${plan ? `计划 ${workspace.plans.indexOf(plan) + 1}` : '计划缺失'} · ${design ? `设计 ${workspace.designs.indexOf(design) + 1}` : '设计缺失'}` }
}

export function fixedValue(value: unknown, pointer: string): unknown {
  return pointer.startsWith('/') ? pointer.slice(1).split('/').reduce<unknown>((node, raw) => {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    return node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, key) ? (node as Record<string, unknown>)[key] : undefined
  }, value) : undefined
}

/** 数组位置必须在固定快照中真实存在；未知字段保留原名称。 */
export function readablePath(path: string, context: ReadableContext) {
  if (!path.startsWith('/')) return `无法识别的字段路径：${path}`
  const parts = path.slice(1).split('/')
  return parts.map((key, index) => {
    if (!/^\d+$/.test(key)) return designLabels[key] || key
    const pointer = '/' + parts.slice(0, index + 1).join('/')
    const value = fixedValue(context.design, pointer) as Record<string, unknown> | undefined
    if (!value) return `未找到第 ${Number(key) + 1} 项`
    const direct = context.entities.find(entity => entity.path === pointer)
    if (direct) return direct.label
    for (const field of ['shot_id', 'participant_id', 'beat_id']) {
      const entity = context.entities.find(item => item.id === value[field] && item.kind === fields[field])
      if (entity) return entity.label
    }
    return `第 ${Number(key) + 1} 项`
  }).join(' → ')
}

/** 所有编译依据范围以原文为坐标；重复、重叠摘录均保留。 */
export function decisionRanges(text: string, decisions: CompilationDecision[]) {
  return decisions.flatMap((decision, index) => {
    const excerpt = decision.text_excerpt
    const ranges: Array<{ start: number; end: number; index: number }> = []
    if (!excerpt) return ranges
    let start = text.indexOf(excerpt)
    while (start >= 0) { ranges.push({ start, end: start + excerpt.length, index }); start = text.indexOf(excerpt, start + 1) }
    return ranges
  })
}

/** 转换已知编译语法和唯一的显式标识；普通单词及歧义内容保持原样。 */
export function readableSegments(text: string, context: ReadableContext, options: { compiled?: boolean } = {}): ReadableSegment[] {
  const replacements: ReadableSegment[] = []
  const add = (start: number, end: number, label: string, entity?: ReadableEntity, unresolved = false) => {
    if (!replacements.some(row => row.start < end && row.end > start)) replacements.push({ start, end, label, entity, unresolved })
  }
  const resolve = (id: string, kind?: string) => {
    const candidates = context.entities.filter(entity => entity.id === id && (!kind || entity.kind === kind))
    return candidates.length === 1 ? candidates[0] : undefined
  }
  for (const match of text.matchAll(/\/(?:[a-z_]+|\d+)(?:\/(?:[a-z_]+|\d+))+/g)) {
    const start = match.index!, end = start + match[0].length
    if (/[a-zA-Z0-9_/:.-]/.test(text[start - 1] || '') || /[a-zA-Z0-9_/-]/.test(text[end] || '')) continue
    const value = fixedValue(context.design, match[0])
    if (value !== undefined) {
      const entity = { id: match[0], kind: '设计字段', label: readablePath(match[0], context), path: match[0], value }
      add(start, end, entity.label, entity)
    }
  }
  let offset = 0
  for (const line of text.split('\n')) {
    const compiled = options.compiled === true
    const coverage = compiled && /^镜头 (\d+) \[([^\]]+)\]/.exec(line)
    if (coverage) {
      const entity = resolve(coverage[2], '镜头')
      add(offset, offset + coverage[0].length, entity ? `${entity.label} · 本单元第 ${coverage[1]} 段` : coverage[0], entity, !entity)
    }
    const header = compiled && /^【([a-z_]+)\[(\d+)\]:/.exec(line)
    if (header) add(offset + 1, offset + 1 + header[1].length, designLabels[header[1]] || header[1])
    const field = compiled && /^([a-z_]+)(?:\[\d+\])?：/.exec(line)
    if (field && designLabels[field[1]]) add(offset, offset + field[1].length, designLabels[field[1]])
    if (compiled) {
      for (const match of line.matchAll(/\b(id|participant_id|beat_id|shot_id)=([^,\s】]+)/g)) {
        const kind = match[1] === 'id' ? header ? collections[header[1]] : undefined : fields[match[1]]
        const entity = kind ? resolve(match[2], kind) : undefined
        const start = offset + match.index!
        add(start, start + match[1].length, designLabels[match[1]] || match[1])
        add(start + match[1].length + 1, start + match[0].length, entity?.label || match[2], entity, !entity)
      }
      if (field && fields[field[1]]) {
        for (const match of line.slice(field[0].length).matchAll(/[\p{L}\p{N}_.:-]+/gu)) {
          const entity = resolve(match[0], fields[field[1]])
          const start = offset + field[0].length + match.index!
          if (match[0] !== 'None') add(start, start + match[0].length, entity?.label || match[0], entity, !entity)
          else add(start, start + match[0].length, '未指定')
        }
      }
      const enumField = field && enums[field[1]]
      if (field && enumField) {
        const raw = line.slice(field[0].length).trim()
        if (enumField[raw]) add(offset + line.indexOf(raw, field[0].length), offset + line.length, enumField[raw])
      }
      if (line.startsWith('参考 @')) for (const match of line.matchAll(/(用途 |输入位置 )([a-z_]+)/g)) {
        const values = match[1] === '用途 ' ? referencePurposes : referenceRoles
        const label = (values as Record<string, string>)[match[2]]
        if (label) add(offset + match.index! + match[1].length, offset + match.index! + match[0].length, label)
      }
      if (line.startsWith('人物：')) for (const match of line.matchAll(/([^；：=]+)=/g)) {
        const entity = resolve(match[1], '人物')
        if (entity) add(offset + match.index!, offset + match.index! + match[1].length, entity.label, entity)
      }
    }
    for (const match of line.matchAll(/@([\p{L}\p{N}_.:-]+)/gu)) {
      if (/[a-zA-Z0-9_.:@/-]/.test(line[match.index! - 1] || '')) continue
      const entity = resolve(match[1], '参考')
      add(offset + match.index!, offset + match.index! + match[0].length, entity?.label || match[0], entity, !entity)
    }
    offset += line.length + 1
  }
  // 自由文本只转换含数字/分隔符的显式身份，防止把 he、sound 等正常词汇当作 ID。
  const ids = [...new Set(context.entities.map(entity => entity.id))].filter(id => /^[a-zA-Z0-9_.:-]+$/.test(id) && /[a-zA-Z]/.test(id) && /[\d_.:-]/.test(id)).sort((a, b) => b.length - a.length)
  if (ids.length) for (const match of text.matchAll(new RegExp(ids.map(escape).join('|'), 'gu'))) {
    const start = match.index!, end = start + match[0].length
    if (/[a-zA-Z0-9_.:@/-]/.test(text[start - 1] || '') || /[a-zA-Z0-9_.:@/-]/.test(text[end] || '')) continue
    const entity = resolve(match[0])
    if (entity) add(start, end, entity.label, entity)
  }
  const parts: ReadableSegment[] = []
  let start = 0
  for (const row of replacements.sort((a, b) => a.start - b.start)) {
    if (start < row.start) parts.push({ start, end: row.start, label: text.slice(start, row.start) })
    parts.push(row); start = row.end
  }
  if (start < text.length) parts.push({ start, end: text.length, label: text.slice(start) })
  return parts
}
