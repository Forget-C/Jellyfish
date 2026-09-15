import { Button, Input, InputNumber, Select, Typography } from 'antd'
import type { Note_Input, SceneDesign_Input } from '../../../services/generated'
import { humanNote } from './common'
import { emptyDesign } from './designTemplate'
import { designLabels } from './designLabels'

import { designAt, noteText, patchDesign } from './designValue'
import type { DesignPath } from './designValue'
export { designAt, noteText, patchDesign } from './designValue'
export type { DesignPath } from './designValue'
const states = [{ value: 'unset', label: '未填写' }, { value: 'proposal', label: '设计建议' }, { value: 'fact', label: '已知事实' }, { value: 'unknown', label: '待确定' }, { value: 'not_applicable', label: '不适用' }, { value: 'none', label: '明确没有' }]

/** 对象字段写入原契约路径，保留 Note 状态及来源；不存在可编辑的摘要副本。 */
export function DesignFields({ value, path, onChange, disabled = false, fields }: { value: SceneDesign_Input; path: DesignPath; onChange: (next: SceneDesign_Input) => void; disabled?: boolean; fields?: string[] }) {
  const blank = emptyDesign()
  const change = (target: DesignPath, next: unknown) => onChange(patchDesign(value, target, next))
  const options = (key: string) => {
    const rows = key.includes('participant') ? value.participants : key.includes('beat') ? value.direction.beats : key.includes('event') ? value.events : key.includes('anchor') ? value.direction.anchors : key.includes('blocking') ? value.direction.blocking_states : key.includes('criterion') ? value.criteria : key.includes('dialogue') ? value.sound.dialogues : key === 'shot_id' ? value.direction.shots : []
    return rows.map((row, index) => ({ value: row.id, label: 'name' in row ? row.name : `${key.includes('shot') ? '镜头' : key.includes('beat') ? '节拍' : key.includes('event') ? '事件' : key.includes('criterion') ? '验收要求' : key.includes('anchor') ? '锚点' : key.includes('dialogue') ? '对白' : '调度'} ${index + 1} · ${noteText(Object.values(row).find(v => v && typeof v === 'object' && 'state' in v)) || '待填写'}` }))
  }
  const render = (current: unknown, target: DesignPath, template: unknown): React.ReactNode => {
    const key = String(target[target.length - 1]); const label = designLabels[key] || key
    if (current && typeof current === 'object' && !Array.isArray(current) && 'state' in current) {
      const note = current as Note_Input
      return <div className="design-field"><div className="design-field-label"><label>{label}</label><Select aria-label={`${label}状态`} size="small" value={note.state || 'unset'} options={states} disabled={disabled} onChange={state => change(target, ['none', 'not_applicable'].includes(state) ? { state, reason: note.reason || '', sources: note.sources } : ['unset', 'unknown'].includes(state) ? { state } : { ...humanNote(note.text || ''), state })} /></div>
        <Input.TextArea aria-label={label} disabled={disabled} value={note.text || note.reason || ''} autoSize={{ minRows: 1, maxRows: 8 }} onChange={event => change(target, ['none', 'not_applicable'].includes(note.state || '') ? { ...note, reason: event.target.value } : { ...humanNote(event.target.value), state: note.state === 'fact' ? 'fact' : 'proposal' })} />
        {!!note.sources?.length && <details className="design-source"><summary>字段来源 · {note.sources.length}</summary>{note.sources.map((source, i) => <p key={i}>{source.kind} · {source.reference} · {source.version}</p>)}</details>}
      </div>
    }
    if (Array.isArray(current)) {
      if (key.endsWith('_ids')) {
        const choices = options(key)
        return <Select mode="multiple" aria-label={label} disabled={disabled} value={current} options={[...choices, ...current.filter(id => !choices.some(c => c.value === id)).map(id => ({ value: id, label: `缺失引用 · ${id}` }))]} onChange={next => change(target, next)} style={{ width: '100%' }} />
      }
      return <div className="design-field-array">{current.map((row, index) => <section key={index}><div className="design-field-label"><strong>{label} {index + 1}</strong>{!disabled && <Button size="small" danger onClick={() => change(target, current.filter((_, i) => i !== index))}>移除</Button>}</div>{render(row, [...target, index], Array.isArray(template) ? template[0] : undefined)}</section>)}
        {!disabled && <Button onClick={() => { const next = structuredClone((Array.isArray(template) ? template[0] : undefined) || current[0] || { state: 'unset' }); if (next && typeof next === 'object' && 'id' in next) next.id = 'item-' + crypto.randomUUID().slice(0, 8); change(target, [...current, next]) }}>添加{label}</Button>}</div>
    }
    if (current && typeof current === 'object') return <>{Object.entries(current).filter(([name]) => !['sources', 'style_revision_id'].includes(name) || (target[0] === 'sound' && name === 'sources')).filter(([name]) => target.length !== path.length || !fields || fields.includes(name)).map(([name, child]) => <div className="design-field" key={name}>{!(child && typeof child === 'object' && 'state' in child) && <label>{designLabels[name] || name}</label>}{render(child, [...target, name], (template as Record<string, unknown>)?.[name])}</div>)}</>
    if (['id', 'character_id', 'prop_id', 'location_asset_id'].includes(key)) return <Typography.Text type="secondary">{typeof current === 'string' && current ? current : '未关联资产'}</Typography.Text>
    if (key.endsWith('_id')) {
      const choices = options(key)
      return <Select aria-label={label} allowClear disabled={disabled} value={current as string} options={typeof current === 'string' && !choices.some(c => c.value === current) ? [...choices, { value: current, label: `缺失引用 · ${current}` }] : choices} onChange={next => change(target, next ?? null)} style={{ width: '100%' }} />
    }
    if (key === 'domain' || key === 'execution') return <Select aria-label={label} disabled={disabled} value={current as string} style={{ width: '100%' }} options={(key === 'domain' ? ['space', 'appearance', 'hands_props', 'environment', 'camera', 'dialogue_sound'] : ['postproduction', 'generated', 'unknown']).map(item => ({ value: item, label: ({ space: '空间', appearance: '造型', hands_props: '手部与道具', environment: '环境', camera: '摄影', dialogue_sound: '对白与声音', postproduction: '待后期', generated: '同期生成', unknown: '待确定' } as Record<string, string>)[item] }))} onChange={next => change(target, next)} />
    if (typeof current === 'number' || ['delay_ms', 'estimated_duration_ms'].includes(key)) return <InputNumber aria-label={label} disabled={disabled} min={key === 'estimated_duration_ms' ? 1 : 0} precision={0} value={typeof current === 'number' ? current : null} onChange={next => change(target, next)} />
    return <Input aria-label={label} disabled={disabled} value={typeof current === 'string' ? current : ''} onChange={event => change(target, event.target.value || null)} />
  }
  return <div className="design-fields">{render(designAt(value, path), path, designAt(blank, path.map(key => typeof key === 'number' ? 0 : key)))}</div>
}
