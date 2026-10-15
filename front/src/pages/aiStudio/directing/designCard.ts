import type { SceneDesign_Input } from '../../../services/generated'
import type { DesignObject } from './designWorkspace'
import { designObjects, directorDesignGraph, shotGraph, shotIssues, shotRelationPath } from './designWorkspace'
import { designAt } from './designValue'
import { designLabels } from './designLabels'

/** 卡片只投影原字段；共享范围必须来自完整引用路径，不能由同名人物推断。 */
export function designCard(value: SceneDesign_Input, object: DesignObject, saved?: SceneDesign_Input) {
  if (object.kind === 'missing') return { text: '关联对象已不存在，请在引用对象中核对关系。', references: [], subject: '', issues: ['关联对象缺失'], shots: [], scope: '缺失引用', shared: false, dirty: false }
  const row = designAt(value, object.path)
  const project = (item: any) => object.fields ? Object.fromEntries(object.fields.map(key => [key, item?.[key]])) : item
  const lines: string[] = [], issues: string[] = [], references: string[] = []
  const registry = designObjects(value)
  const visit = (item: unknown, names: string[]) => {
    const label = names.map(name => designLabels[name] || name).join(' / ')
    if (!item || typeof item !== 'object') {
      if (typeof item === 'string' && item.trim() || typeof item === 'number') lines.push(`${label}：${({ hands_props: '手部与道具', space: '空间', appearance: '造型', environment: '环境', camera: '摄影', dialogue_sound: '对白与声音', postproduction: '待后期', generated: '同期生成', unknown: '待确定' } as Record<string, string>)[String(item)] || item}`)
      return
    }
    if ('state' in item) {
      const note = item as { state: string; text?: string; reason?: string }
      if (note.state === 'unset' || note.state === 'unknown') issues.push(`${label} · ${note.state === 'unset' ? '未填写' : '待确定'}`)
      if (note.text || note.reason) lines.push(`${label}：${note.text || note.reason}`)
      else if (note.state === 'none' || note.state === 'not_applicable') lines.push(`${label}：${note.state === 'none' ? '明确没有' : '不适用'}`)
      return
    }
    if (Array.isArray(item)) { item.forEach((child, index) => visit(child, [...names, String(index + 1)])); return }
    Object.entries(item).forEach(([key, child]) => {
      const prefix = ({ participant_id: 'participant', participant_ids: 'participant', beat_id: 'beat', beat_ids: 'beat', shot_id: 'shot', event_id: 'event', event_ids: 'event', received_event_ids: 'event', trigger_event_id: 'event', anchor_id: 'anchor', anchor_ids: 'anchor', blocking_state_ids: 'blocking', criterion_ids: 'criterion', dialogue_ids: 'dialogue' } as Record<string, string>)[key]
      if (prefix && child != null) {
        const targets = (Array.isArray(child) ? child : [child]).map(id => {
          const target = registry.find(node => node.key === `${prefix}:${id}`)
          if (!target) issues.push(`${designLabels[key] || key} · 关联缺失`)
          return target?.label || `缺失引用 · ${id}`
        })
        if (targets.length) references.push(`${designLabels[key] || key}：${targets.join('、')}`)
        return
      }
      if (key === 'id' || key.endsWith('_id') || key.endsWith('_ids') || key === 'sources' && object.kind !== 'sound') return
      visit(child, [...names, key])
    })
  }
  visit(project(row), [])
  if (object.key.startsWith('shot:')) issues.push(...shotIssues(value, object.key.slice(5)))
  const shots = value.direction.shots.flatMap((shot, index) => {
    const related = directorDesignGraph(value, { scope: 'shot', shotId: shot.id }).relatedKeys
    if (!related.has(object.key) || !object.key.includes(':')) return []
    const graph = shotGraph(value, shot.id)
    const path = shotRelationPath(graph, shot.id, object.key)
    const eventId = row?.trigger_event_id || row?.event_id
    const event = eventId && registry.find(node => node.key === `event:${eventId}`)
    const person = row?.participant_id && value.participants.find(person => person.id === row.participant_id)
    const via = path.map(edge => edge.label).join(' → ') || (eventId ? `事件依据 → ${row.trigger_event_id ? '触发事件' : '变化事件'}：${event?.label || eventId}`
      : object.key.startsWith('situation:') ? `相关人物情境：${person?.name || row.participant_id}` : '相关设计工作单引用')
    return [{ id: shot.id, label: `镜头 ${String(index + 1).padStart(2, '0')}`, via: object.key === `shot:${shot.id}` ? '' : via }]
  })
  const shared = !object.key.includes(':')
  const scope = shared ? '全场适用' : shots.length ? `关联 ${shots.length} 个镜头` : '未建立镜头关联'
  const subject = [row?.participant_id && value.participants.find(person => person.id === row.participant_id)?.name,
    row?.beat_id && (value.direction.beats.some(beat => beat.id === row.beat_id) ? `节拍 ${value.direction.beats.findIndex(beat => beat.id === row.beat_id) + 1}` : '所属节拍缺失')].filter(Boolean).join(' · ')
  // 无 ID 的工作单以契约唯一键寻找保存基线，避免数组重排误报其它对象的修改。
  let savedRow = saved && designAt(saved, object.path)
  if (saved && typeof object.path[object.path.length - 1] === 'number') {
    const keys = row?.id ? ['id'] : ['shot_id', 'participant_id', 'beat_id'].filter(key => row?.[key] != null)
    const rows = designAt(saved, object.path.slice(0, -1)) as any[] | undefined
    if (keys.length) {
      const matches = rows?.filter(item => keys.every(key => item[key] === row[key])) || []
      savedRow = matches.length === 1 ? matches[0] : matches.find(item => JSON.stringify(item) === JSON.stringify(row)) || savedRow
    }
  }
  return { text: lines.join('\n'), references, subject, issues: [...new Set(issues)], shots, scope, shared,
    dirty: !!saved && JSON.stringify(project(row)) !== JSON.stringify(project(savedRow)) }
}
