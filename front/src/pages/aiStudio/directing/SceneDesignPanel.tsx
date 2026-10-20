import { useEffect, useState } from 'react'
import { Alert, Button, Select, Space } from 'antd'
import { WorkbenchModal } from './ui/WorkbenchModal'
import { WorkbenchButton } from './ui/WorkbenchButton'
import { DesignObjectSummary } from './DesignObjectSummary'
import { DesignApplicabilityEditor } from './DesignApplicabilityEditor'
import type { EditableSceneDesign_Output, EditableGenerationUnit_Output } from '../../../services/generated'
import { DesignFields, designAt, patchDesign } from './DesignFields'
import type { DesignPath } from './DesignFields'
import { designLabels } from './designLabels'
import { designObjects } from './designWorkspace'
import { designObjectSnapshot } from './designValue'
import { emptyDesign } from './designTemplate'
import { sceneUnitReferenceConflicts } from './sceneUnitReferences'
import type { UnitReferenceConflict } from './sceneUnitReferences'

const referenceKeys: Record<string, string[]> = {
  participants: ['participant_id', 'participant_ids'], events: ['event_id', 'event_ids', 'trigger_event_id', 'received_event_ids'],
  criteria: ['criterion_ids'], 'direction.beats': ['beat_id', 'beat_ids'], 'direction.anchors': ['anchor_id', 'anchor_ids'],
  'direction.blocking_states': ['blocking_state_ids'], 'direction.shots': ['shot_id'], 'sound.dialogues': ['dialogue_ids'],
}
const applicabilityKinds: Record<string, string> = {
  'direction.immutable_facts': 'immutable_fact', 'direction.beats': 'beat',
  'direction.shots': 'shot', events: 'event', criteria: 'criterion',
  'performance.beats': 'performance_beat', 'staging.activities': 'staging_activity',
  cinematography: 'camera', continuity: 'continuity',
}
const mandatory: Record<string, string[]> = {
  'direction.blocking_states': ['participant_id'], 'performance.situations': ['participant_id'],
  'performance.beats': ['participant_id', 'beat_id'], 'staging.activities': ['participant_id'],
  cinematography: ['shot_id'], 'sound.dialogues': ['participant_id'],
}
const pathLabel = (path: DesignPath) => path.map(key => typeof key === 'number' ? String(key + 1) : designLabels[key] || key).join(' / ')
export type DesignTarget = { assetKind?: 'character' | 'scene' | 'prop'; shotId?: string; object?: boolean; fields?: string[]; label?: string; path: DesignPath; identity?: Record<string, unknown>; snapshot?: string; sessionRow?: unknown }
export type DesignFocusRequest = { target: DesignTarget; trigger: HTMLElement; serial: number; side?: boolean; defaults?: Record<string, string>; createPath?: DesignPath }
export function targetFor(value: EditableSceneDesign_Output, path: DesignPath, explicitlySelected = false): DesignTarget {
  const row = designAt(value, path)
  if (typeof path[path.length - 1] !== 'number') return { path }
  const keys = row?.id ? ['id'] : ['shot_id', 'participant_id', 'beat_id'].filter(key => row?.[key] != null)
  const rows = designAt(value, path.slice(0, -1)) as Record<string, unknown>[]
  // 同一人物可以有多项镜内活动，人物身份不能冒充工作单唯一身份。
  if (!keys.length || rows.filter(item => keys.every(key => item[key] === row[key])).length !== 1) {
    const snapshot = designObjectSnapshot(row)
    // 当前明确点击可编辑重复行；对象引用只在本次会话有效，不用于刷新恢复。
    return explicitlySelected && rows.filter(item => designObjectSnapshot(item) === snapshot).length > 1 ? { path, sessionRow: row } : { path, snapshot }
  }
  return { path, identity: Object.fromEntries(keys.map(key => [key, row[key]])) }
}
export function resolveTarget(value: EditableSceneDesign_Output, target: DesignTarget): DesignPath | undefined {
  if (target.sessionRow) {
    const rows = designAt(value, target.path.slice(0, -1)) as unknown[] | undefined
    const index = rows?.findIndex(row => row === target.sessionRow) ?? -1
    return index < 0 ? undefined : [...target.path.slice(0, -1), index]
  }
  if (target.snapshot) {
    const rows = designAt(value, target.path.slice(0, -1)) as unknown[] | undefined
    const matches = rows?.flatMap((row, index) => designObjectSnapshot(row) === target.snapshot ? [index] : []) || []
    return matches.length === 1 ? [...target.path.slice(0, -1), matches[0]] : undefined
  }
  if (!target.identity) return target.path
  const identity = Object.entries(target.identity)
  if (!identity.length) return undefined
  const parent = target.path.slice(0, -1)
  const rows = designAt(value, parent) as Record<string, unknown>[] | undefined
  const matches = rows?.flatMap((row, index) => identity.every(([key, item]) => row[key] === item) ? [index] : []) || []
  return matches.length === 1 ? [...parent, matches[0]] : undefined
}

/** 单个编辑区复用六岗字段；创建关系须明确选对象，删除先定位真实引用。 */
export function SceneDesignPanel({ value, saved, units, disabled, onChange, focusRequest, onFocusHandled, onLocateUnit, onSideClose, sideContext, onNavigateTarget, saveStatus, relationshipGraph }: {
  value: EditableSceneDesign_Output
  relationshipGraph?: import('../../../services/generated').SceneRelationshipGraph
  saved?: EditableSceneDesign_Output
  units: EditableGenerationUnit_Output[]
  disabled: boolean
  onChange: (value: EditableSceneDesign_Output) => void
  focusRequest?: DesignFocusRequest
  onFocusHandled?: () => void
  onLocateUnit: (conflict: UnitReferenceConflict) => void
  onSideClose?: () => void
  sideContext?: string
  saveStatus: string
  onNavigateTarget: (target: DesignTarget, trigger: HTMLElement) => void
}) {
  const [target, setTarget] = useState<DesignTarget>({ path: ['direction'] })
  const [sideOpen, setSideOpen] = useState(false)
  const resolved = resolveTarget(value, target)
  const path = resolved || target.path
  const foundObject = target.object && resolved ? designObjects(value).find(row => JSON.stringify(row.path) === JSON.stringify(resolved)) : undefined
  const object = foundObject && { ...foundObject, fields: target.fields || foundObject.fields, label: target.label || foundObject.label }
  const [addDefaults, setAddDefaults] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<{ path: DesignPath; row: Record<string, unknown>; required: string[] }>()
  const [references, setReferences] = useState<DesignTarget[]>([])
  const [unitReferences, setUnitReferences] = useState<UnitReferenceConflict[]>([])
  const [error, setError] = useState('')
  const options = (key: string) => {
    const rows = key === 'participant_id' ? value.participants : key === 'beat_id' ? value.direction.beats : value.direction.shots
    return rows.map((row, index) => ({ value: row.id, label: 'name' in row ? row.name : `${key === 'beat_id' ? '节拍' : '镜头'} ${index + 1}` }))
  }
  const add = (target: DesignPath, template: unknown, defaults = addDefaults) => {
    if (disabled) return
    const row = structuredClone(template) as Record<string, unknown>
    if (target[0] === 'direction' && ['immutable_facts', 'open_questions'].includes(String(target[1]))) row.id = crypto.randomUUID()
    const required = mandatory[target.join('.')] || []
    // 模板只提供字段形状，不继承模板中的人物、节拍等虚构关联。
    for (const key of Object.keys(row)) {
      if (key === 'id') row[key] = crypto.randomUUID()
      else if (key.endsWith('_ids')) row[key] = key === 'participant_ids' ? null : []
      else if (key.endsWith('_id')) row[key] = null
    }
    required.forEach(key => { if (defaults[key]) row[key] = defaults[key] })
    setError(''); setReferences([])
    if (required.length) setPending({ path: target, row, required })
    else onChange(patchDesign(value, target, [...designAt(value, target), row]))
  }
  const confirmAdd = () => {
    if (!pending || disabled || pending.required.some(key => !pending.row[key])) return
    const rows = designAt(value, pending.path) as Record<string, unknown>[]
    const uniqueKeys = pending.path.join('.') === 'cinematography' ? ['shot_id'] : pending.path.join('.') === 'performance.beats' ? ['participant_id', 'beat_id'] : []
    if (uniqueKeys.length && rows.some(row => uniqueKeys.every(key => row[key] === pending.row[key]))) {
      setError('该对象已有工作单，请返回编辑已有内容。'); return
    }
    onChange(patchDesign(value, pending.path, [...rows, pending.row]))
    setPending(undefined); setError('')
  }
  const remove = (target: DesignPath, index: number) => {
    if (disabled) return
    setUnitReferences([])
    const rows = designAt(value, target) as Record<string, unknown>[]
    const row = rows[index]
    if (row?.id && value.applicability?.some(item => item.subject.kind === applicabilityKinds[target.join('.')] && item.subject.id === row.id)) {
      setError('对象仍被设计适用性引用，请先在此卡解除适用性后再删除。')
      return
    }
    const keys = referenceKeys[target.join('.')] || []
    const found: DesignPath[] = []
    const visit = (item: unknown, at: DesignPath) => {
      if (at.length >= target.length + 1 && target.every((key, i) => at[i] === key) && at[target.length] === index) return
      if (!item || typeof item !== 'object') return
      if (Array.isArray(item)) { item.forEach((child, i) => visit(child, [...at, i])); return }
      for (const [key, child] of Object.entries(item)) {
        if (row.id && keys.includes(key) && (child === row.id || Array.isArray(child) && child.includes(row.id))) found.push(at)
        else visit(child, [...at, key])
      }
    }
    visit(value, [])
    if (found.length) { setReferences(found.map(item => targetFor(value, item))); setError('对象仍被引用，请定位并解除关联后再删除。'); return }
    const next = patchDesign(value, target, rows.filter((_, i) => i !== index))
    const downstream = sceneUnitReferenceConflicts({ design: value, units }, next)
    if (downstream.length) { setReferences([]); setUnitReferences(downstream); setError('对象仍被单元引用，请先处理下游引用。'); return }
    onChange(next)
    if (JSON.stringify(path) === JSON.stringify([...target, index])) { setSideOpen(false); onSideClose?.() }
    setReferences([]); setError('')
  }
  const navigate = (next: DesignPath | DesignTarget) => { setTarget(Array.isArray(next) ? targetFor(value, next) : next); setPending(undefined); setReferences([]); setUnitReferences([]); setError('') }
  useEffect(() => { setSideOpen(false); onSideClose?.() }, [sideContext])
  useEffect(() => {
    if (focusRequest) {
      setAddDefaults(focusRequest.defaults || {})
      navigate(focusRequest.target)
      setSideOpen(true)
      onFocusHandled?.()
      if (focusRequest.createPath) add(focusRequest.createPath, designAt(emptyDesign(), focusRequest.createPath)[0], focusRequest.defaults || {})
    }
  }, [focusRequest])
  const editorBody = () => <>
      {object && <DesignObjectSummary value={value} saved={saved} object={object} relationshipGraph={relationshipGraph} showText={false} editing onSelectShot={id => { const index = value.direction.shots.findIndex(row => row.id === id); if (index >= 0) onNavigateTarget(targetFor(value, ['direction', 'shots', index]), document.activeElement as HTMLElement); setSideOpen(false) }} />}
      <h3>{pathLabel(pending?.path || path)}</h3>
      {error && <Alert type="warning" message={error} description={<Space wrap>{references.map((reference, i) =>
        <Button key={i} onClick={event => { onNavigateTarget(reference, event.currentTarget); setSideOpen(false) }}>定位：{pathLabel(reference.path)}</Button>)}
        {unitReferences.map(reference => <Button key={`${reference.unitId}:${reference.coverageId || reference.referenceId}`} onClick={() => onLocateUnit(reference)}>定位{reference.label}</Button>)}
      </Space>} />}
      {!resolved ? <Alert type="warning" message="原对象不可用，请重新选择" description="当前内容已保留；请从关系导航或栏目明确选择对象。" /> : pending ? <div>
        <p>明确选择工作单所属对象；不会自动建立或猜测关联。</p>
        {pending.required.map(key => <div key={key} className="design-field"><label>{designLabels[key]}</label>
          <Select aria-label={`新建${designLabels[key]}`} style={{ width: '100%' }} disabled={disabled} placeholder="请选择已有对象"
            options={options(key)} value={pending.row[key] as string | undefined}
            onChange={next => setPending({ ...pending, row: { ...pending.row, [key]: next } })} />
          {!options(key).length && <p>暂无可选对象，请先在对应栏目建立对象。</p>}
        </div>)}
        <Space><Button onClick={() => { setPending(undefined); setError('') }}>返回编辑</Button>
          <Button disabled={disabled || pending.required.some(key => !pending.row[key])} onClick={confirmAdd}>建立工作单</Button></Space>
      </div> : <DesignFields value={value} path={path} fields={target.fields || object?.fields} allowStructure disabled={disabled} onChange={next => {
        setTarget({ ...targetFor(next, path, true), object: target.object, fields: target.fields, label: target.label }); onChange(next)
      }} onAdd={add} onRemove={remove} />}
      {object && !pending && <DesignApplicabilityEditor value={value} units={units} object={object} disabled={disabled} onChange={onChange} />}
      {object && typeof path[path.length - 1] === 'number' && <WorkbenchButton variant="danger" disabled={disabled} onClick={() => remove(path.slice(0, -1), path[path.length - 1] as number)}>删除此卡</WorkbenchButton>}
  </>
  return <>
    <WorkbenchModal title={<span className="director-modal-title">{object?.label || '设计卡片'}<small role="status">{saveStatus}</small></span>}
      open={sideOpen} footer={null} maskClosable={false} onCancel={() => { setSideOpen(false); setPending(undefined); onSideClose?.() }}>
      {editorBody()}
    </WorkbenchModal>
  </>
}
