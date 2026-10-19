import { useState } from 'react'
import { Input, Select } from 'antd'
import type { DesignApplicability, DesignSubject, EditableGenerationUnit_Output, EditableSceneDesign_Output } from '../../../services/generated'
import { WorkbenchButton } from './ui/WorkbenchButton'
import { designAt, noteText } from './designValue'
import type { DesignObject } from './designWorkspace'
import { designLabels } from './designLabels'

const subjectKinds: Record<string, DesignSubject['kind']> = {
  overview: 'direction', space: 'direction', beat: 'beat', shot: 'shot', criterion: 'criterion',
  event: 'event', performance: 'performance_beat', activity: 'staging_activity',
  camera: 'camera', continuity: 'continuity', prompt: 'prompt', sound: 'sound',
}
const constraintFields: Record<string, string[]> = {
  direction: ['spatial_basis', 'shootable_area', 'axis', 'scale', 'control_level'],
  performance_beat: ['avoid'], camera: ['technical_parameters', 'adjacent_requirements', 'prohibitions'],
  continuity: ['before', 'after', 'following_constraint'], immutable_fact: ['text'],
  prompt: ['binding_requirements', 'sound_strategy', 'prohibitions'], sound: ['music_constraints'],
}
type Candidate = { subject: DesignSubject; label: string }
const subjectKey = (subject: DesignSubject) => JSON.stringify([subject.kind, subject.id, subject.field])

/** 在唯一原工作单上编辑字段适用性；未完成的选择只留在组件本地。 */
export function DesignApplicabilityEditor({ value, units, object, disabled, onChange }: {
  value: EditableSceneDesign_Output
  units: EditableGenerationUnit_Output[]
  object: DesignObject
  disabled: boolean
  onChange: (next: EditableSceneDesign_Output) => void
}) {
  const [draft, setDraft] = useState<DesignApplicability>()
  const prefix = object.key.split(':')[0]
  const kind = subjectKinds[prefix]
  const row = designAt(value, object.path)
  const objectId = typeof row?.id === 'string' ? row.id : undefined
  const fields = object.fields || Object.keys(row || {})
  const candidates: Candidate[] = kind && (['direction', 'prompt', 'sound'].includes(kind) || objectId) ? fields.flatMap(field => {
    const note = row?.[field]
    if (!note || typeof note !== 'object' || Array.isArray(note) || !('state' in note)) return []
    return [{ subject: { kind, id: objectId, field }, label: designLabels[field] || field }]
  }) : []
  if (prefix === 'overview') value.direction.immutable_facts.forEach((fact, index) => {
    if (fact.id) candidates.push({ subject: { kind: 'immutable_fact', id: fact.id, field: 'text' },
      label: `不可改事实 ${index + 1} · ${noteText(fact) || '未填写'}` })
  })
  const candidateKeys = new Set(candidates.map(candidate => subjectKey(candidate.subject)))
  const applicability = value.applicability || []
  const saved = applicability.filter(item => candidateKeys.has(subjectKey(item.subject)))
  const shotOptions = value.direction.shots.flatMap((shot, index) => {
    if (draft?.subject.kind === 'shot' && draft.subject.id !== shot.id ||
        draft?.subject.kind === 'camera' && row?.shot_id !== shot.id ||
        draft?.subject.kind === 'beat' && !shot.beat_ids.includes(draft.subject.id || '') ||
        draft?.subject.kind === 'performance_beat' && !shot.beat_ids.includes(row?.beat_id)) return []
    return [{ value: shot.id, label: `镜头 ${index + 1}` }]
  })
  const occurrenceOptions = units.flatMap(unit => unit.coverage.filter(item =>
    (!draft || !['shot', 'camera', 'beat', 'performance_beat'].includes(draft.subject.kind) || shotOptions.some(shot => shot.value === item.shot_id)) &&
    (draft?.subject.kind !== 'event' || item.event_ids.includes(draft.subject.id || '')) &&
    (draft?.subject.kind !== 'beat' && draft?.subject.kind !== 'performance_beat' || item.beat_ids.includes(draft.subject.kind === 'beat' ? draft.subject.id || '' : row?.beat_id))
  ).map(item => ({
    value: JSON.stringify([unit.id, item.id]), label: `${unit.id} · ${shotOptions.find(shot => shot.value === item.shot_id)?.label || item.shot_id} · ${item.id}`,
  })))
  const chosen = draft && candidates.find(candidate => subjectKey(candidate.subject) === subjectKey(draft.subject))
  const canApply = !!chosen && (!draft || (draft.scope === 'scene_rule' || draft.scope === 'shots' && !!draft.shot_ids?.length || draft.scope === 'occurrences' && !!draft.occurrences?.length)) &&
    (draft?.purpose !== 'constraint' || !!draft.phase)
  const start = (candidate: Candidate) => {
    const existing = saved.find(item => subjectKey(item.subject) === subjectKey(candidate.subject))
    setDraft(existing ? structuredClone(existing) : { subject: candidate.subject, purpose: 'design', scope: 'shots', shot_ids: [], occurrences: [] })
  }
  const apply = () => {
    if (!draft || !canApply) return
    const next = [...applicability]
    const index = next.findIndex(item => subjectKey(item.subject) === subjectKey(draft.subject))
    if (index < 0) next.push(draft)
    else next[index] = draft
    onChange({ ...value, applicability: next })
    setDraft(undefined)
  }
  if (!candidates.length) return null
  return <section className="design-applicability-editor">
    <h4>适用范围</h4><p>关联镜头只确定可用范围；生产单元仍需明确选择本次执行项。</p>
    {saved.map(item => <div key={subjectKey(item.subject)}><span>{candidates.find(candidate => subjectKey(candidate.subject) === subjectKey(item.subject))?.label} · {item.scope === 'scene_rule' ? '全场规则' : item.scope === 'shots' ? `镜头 ${item.shot_ids?.join('、')}` : `出现项 ${item.occurrences?.map(row => `${row.unit_id}/${row.coverage_item_id}`).join('、')}`} · {item.purpose === 'constraint' ? `${item.phase} 约束` : '设计'}</span>
      <WorkbenchButton variant="quiet" disabled={disabled} onClick={() => start(candidates.find(candidate => subjectKey(candidate.subject) === subjectKey(item.subject))!)}>修改</WorkbenchButton>
      <WorkbenchButton variant="danger" disabled={disabled} onClick={() => onChange({ ...value, applicability: applicability.filter(row => subjectKey(row.subject) !== subjectKey(item.subject)) })}>解除适用性</WorkbenchButton>
    </div>)}
    {!disabled && <Select aria-label="选择适用字段" placeholder="选择字段设置范围" value={undefined} style={{ width: '100%' }} options={candidates.map(candidate => ({ value: subjectKey(candidate.subject), label: candidate.label }))} onChange={key => start(candidates.find(candidate => subjectKey(candidate.subject) === key)!)} />}
    {draft && <div className="design-applicability-draft">
      <p>{chosen?.label}</p>
      <label>内容用途</label><Select aria-label="内容用途" value={draft.purpose} options={[{ value: 'design', label: '镜头适用设计' }, ...constraintFields[draft.subject.kind]?.includes(draft.subject.field) ? [{ value: 'constraint', label: '执行约束' }] : []]} onChange={purpose => setDraft({ ...draft, purpose, scope: purpose === 'design' && draft.scope === 'scene_rule' ? 'shots' : draft.scope, phase: purpose === 'design' ? null : draft.phase, condition: purpose === 'design' ? null : draft.condition })} />
      <label>适用位置</label><Select aria-label="适用位置" value={draft.scope} options={[...(draft.purpose === 'constraint' && ['direction', 'immutable_fact', 'prompt', 'sound'].includes(draft.subject.kind) ? [{ value: 'scene_rule', label: '全场规则' }] : []), { value: 'shots', label: '指定镜头' }, { value: 'occurrences', label: '单元出现项' }]} onChange={scope => setDraft({ ...draft, scope, shot_ids: [], occurrences: [] })} />
      {draft.scope === 'shots' && <Select mode="multiple" aria-label="适用镜头" value={draft.shot_ids || []} options={shotOptions} style={{ width: '100%' }} onChange={shot_ids => setDraft({ ...draft, shot_ids })} />}
      {draft.scope === 'occurrences' && <Select mode="multiple" aria-label="适用单元出现项" value={(draft.occurrences || []).map(row => JSON.stringify([row.unit_id, row.coverage_item_id]))} options={occurrenceOptions} style={{ width: '100%' }} onChange={keys => setDraft({ ...draft, occurrences: keys.map(key => { const [unit_id, coverage_item_id] = JSON.parse(key) as string[]; return { unit_id, coverage_item_id } }) })} />}
      {draft.purpose === 'constraint' && <><label>制作阶段</label><Select aria-label="制作阶段" value={draft.phase || undefined} options={[{ value: 'video', label: '视频' }, { value: 'sound', label: '声音' }, { value: 'postproduction', label: '后期' }]} onChange={phase => setDraft({ ...draft, phase })} /><label>全场一致的条件（可选）</label><Input aria-label="适用条件" value={draft.condition || ''} onChange={event => setDraft({ ...draft, condition: event.target.value || null })} /></>}
      <WorkbenchButton variant="primary" disabled={!canApply} onClick={apply}>应用适用性</WorkbenchButton><WorkbenchButton variant="quiet" onClick={() => setDraft(undefined)}>取消</WorkbenchButton>
    </div>}
  </section>
}
