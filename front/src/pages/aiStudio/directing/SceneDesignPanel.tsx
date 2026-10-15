import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button, Select, Space } from 'antd'
import { WorkbenchModal } from './ui/WorkbenchModal'
import { CanvasQuickEditor } from './CanvasQuickEditor'
import { DesignObjectSummary } from './DesignObjectSummary'
import type { EditableSceneDesign_Output, EditableGenerationUnit_Output } from '../../../services/generated'
import { DesignFields, designAt, patchDesign } from './DesignFields'
import type { DesignPath } from './DesignFields'
import { designLabels } from './designLabels'
import { departmentNames, designObjects } from './designWorkspace'
import { SceneAssetLinks } from './SceneAssetLinks'
import { sceneUnitReferenceConflicts } from './sceneUnitReferences'
import type { UnitReferenceConflict } from './sceneUnitReferences'

const roles = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'sound', 'prompt', 'participants', 'events', 'criteria']
const referenceKeys: Record<string, string[]> = {
  participants: ['participant_id', 'participant_ids'], events: ['event_id', 'event_ids', 'trigger_event_id', 'received_event_ids'],
  criteria: ['criterion_ids'], 'direction.beats': ['beat_id', 'beat_ids'], 'direction.anchors': ['anchor_id', 'anchor_ids'],
  'direction.blocking_states': ['blocking_state_ids'], 'direction.shots': ['shot_id'], 'sound.dialogues': ['dialogue_ids'],
}
const mandatory: Record<string, string[]> = {
  'direction.blocking_states': ['participant_id'], 'performance.situations': ['participant_id'],
  'performance.beats': ['participant_id', 'beat_id'], 'staging.activities': ['participant_id'],
  cinematography: ['shot_id'], 'sound.dialogues': ['participant_id'],
}
const pathLabel = (path: DesignPath) => path.map(key => typeof key === 'number' ? String(key + 1) : designLabels[key] || key).join(' / ')
// 保存响应会补齐 Note 的空来源和 nullable 字段；这些序列化差异不改变工作单身份。
const objectSnapshot = (value: unknown) => JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item
  return Object.fromEntries(Object.keys(item).sort().filter(key => item[key] != null &&
    !(key === 'sources' && Array.isArray(item[key]) && !item[key].length)).map(key => [key, item[key]]))
})
export type DesignTarget = { assetKind?: 'character' | 'scene' | 'prop'; shotId?: string; object?: boolean; path: DesignPath; identity?: Record<string, unknown>; snapshot?: string }
export type DesignFocusRequest = { target: DesignTarget; trigger: HTMLElement; serial: number; side?: boolean }
export function targetFor(value: EditableSceneDesign_Output, path: DesignPath): DesignTarget {
  const row = designAt(value, path)
  if (typeof path[path.length - 1] !== 'number') return { path }
  const keys = row?.id ? ['id'] : ['shot_id', 'participant_id', 'beat_id'].filter(key => row?.[key] != null)
  const rows = designAt(value, path.slice(0, -1)) as Record<string, unknown>[]
  // 同一人物可以有多项镜内活动，人物身份不能冒充工作单唯一身份。
  if (!keys.length || rows.filter(item => keys.every(key => item[key] === row[key])).length !== 1) return { path, snapshot: objectSnapshot(row) }
  return { path, identity: Object.fromEntries(keys.map(key => [key, row[key]])) }
}
export function resolveTarget(value: EditableSceneDesign_Output, target: DesignTarget): DesignPath | undefined {
  if (target.snapshot) {
    const rows = designAt(value, target.path.slice(0, -1)) as unknown[] | undefined
    const matches = rows?.flatMap((row, index) => objectSnapshot(row) === target.snapshot ? [index] : []) || []
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
export function SceneDesignPanel({ navigationOpen, onNavigationOpenChange: setNavigationOpen, projectId, value, saved, units, disabled, onChange, focusRequest, onSelectShot, onFocusHandled, open, onOpenChange: setOpen, onLocateUnit, hideTriggers = false }: {
  navigationOpen: boolean
  onNavigationOpenChange: (open: boolean) => void
  projectId: string
  value: EditableSceneDesign_Output
  saved?: EditableSceneDesign_Output
  units: EditableGenerationUnit_Output[]
  onLocateUnit: (conflict: UnitReferenceConflict) => void
  disabled: boolean
  onChange: (value: EditableSceneDesign_Output) => void
  focusRequest?: DesignFocusRequest
  onSelectShot?: (id: string) => void
  onFocusHandled?: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
  hideTriggers?: boolean
}) {
  const [target, setTarget] = useState<DesignTarget>({ path: ['direction'] })
  const [sideOpen, setSideOpen] = useState(false)
  const resolved = resolveTarget(value, target)
  const path = resolved || target.path
  const object = target.object && resolved ? designObjects(value).find(row => JSON.stringify(row.path) === JSON.stringify(resolved)) : undefined
  const navigationTrigger = useRef<HTMLButtonElement>(null)
  const editorTrigger = useRef<HTMLElement>()
  const [pending, setPending] = useState<{ path: DesignPath; row: Record<string, unknown>; required: string[] }>()
  const [references, setReferences] = useState<DesignTarget[]>([])
  const [unitReferences, setUnitReferences] = useState<UnitReferenceConflict[]>([])
  const [error, setError] = useState('')
  const options = (key: string) => {
    const rows = key === 'participant_id' ? value.participants : key === 'beat_id' ? value.direction.beats : value.direction.shots
    return rows.map((row, index) => ({ value: row.id, label: 'name' in row ? row.name : `${key === 'beat_id' ? '节拍' : '镜头'} ${index + 1}` }))
  }
  const add = (target: DesignPath, template: unknown) => {
    if (disabled) return
    const row = structuredClone(template) as Record<string, unknown>
    const required = mandatory[target.join('.')] || []
    // 模板只提供字段形状，不继承模板中的人物、节拍等虚构关联。
    for (const key of Object.keys(row)) {
      if (key === 'id') row[key] = crypto.randomUUID()
      else if (key.endsWith('_ids')) row[key] = key === 'participant_ids' ? null : []
      else if (key.endsWith('_id')) row[key] = null
    }
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
    setReferences([]); setError('')
  }
  const navigate = (next: DesignPath | DesignTarget) => { setTarget(Array.isArray(next) ? targetFor(value, next) : next); setPending(undefined); setReferences([]); setUnitReferences([]); setError('') }
  const openEditor = (trigger: HTMLElement, next?: DesignPath | DesignTarget) => {
    editorTrigger.current = trigger
    if (next) {
      navigate(next)
      const resolvedPath = Array.isArray(next) ? next : resolveTarget(value, next)
      if (resolvedPath?.[0] === 'direction' && resolvedPath[1] === 'shots' && resolvedPath.length === 3) {
        const shot = designAt(value, resolvedPath)
        if (shot?.id) onSelectShot?.(shot.id)
      }
    }
    setOpen(true)
  }
  useEffect(() => {
    if (focusRequest) {
      if (focusRequest.side) {
        editorTrigger.current = focusRequest.trigger
        navigate(focusRequest.target)
        setOpen(false); setSideOpen(true)
      } else openEditor(focusRequest.trigger, focusRequest.target)
      onFocusHandled?.()
    }
  }, [focusRequest])
  const groups = [
    { label: '镜头', path: ['direction', 'shots'], rows: value.direction.shots.map(row => ({ id: row.id, name: row.visible_result.text })) },
    { label: '人物与物件', path: ['participants'], rows: value.participants.map(row => ({ id: row.id, name: row.name })) },
    { label: '节拍', path: ['direction', 'beats'], rows: value.direction.beats.map(row => ({ id: row.id, name: row.objective.text })) },
    { label: '事件', path: ['events'], rows: value.events.map(row => ({ id: row.id, name: row.description.text })) },
    { label: '空间锚点', path: ['direction', 'anchors'], rows: value.direction.anchors.map(row => ({ id: row.id, name: row.description.text })) },
    { label: '验收要求', path: ['criteria'], rows: value.criteria.map(row => ({ id: row.id, name: row.requirement.text })) },
  ]
  const closeNavigation = () => { setNavigationOpen(false); navigationTrigger.current?.focus({ preventScroll: true }) }
  const editorBody = () => <>
      {!object && <Space wrap>{roles.map(role => <Button key={role} onClick={() => navigate([role])} className="canvas-choice" aria-pressed={path[0] === role}>
        {departmentNames[role] || designLabels[role]}
      </Button>)}</Space>}
      {!object && <Button onClick={() => navigate(['assets'])} className="canvas-choice" aria-pressed={path[0] === 'assets'}>项目资产关联</Button>}
      {object && <DesignObjectSummary value={value} saved={saved} object={object} showText={false} editing onSelectShot={id => { onSelectShot?.(id); setOpen(false); setSideOpen(false) }} />}
      <h3>{path[0] === 'assets' ? '项目资产关联' : pathLabel(pending?.path || path)}</h3>
      {error && <Alert type="warning" message={error} description={<Space wrap>{references.map((reference, i) =>
        <Button key={i} onClick={() => navigate(reference)}>定位：{pathLabel(reference.path)}</Button>)}
        {unitReferences.map(reference => <Button key={`${reference.unitId}:${reference.coverageId || reference.referenceId}`} onClick={() => onLocateUnit(reference)}>定位{reference.label}</Button>)}
      </Space>} />}
      {!resolved ? <Alert type="warning" message="原对象不可用，请重新选择" description="当前内容已保留；请从关系导航或栏目明确选择对象。" /> : path[0] === 'assets' ? <SceneAssetLinks assetKind={target.assetKind} shotId={target.shotId} projectId={projectId} value={value} disabled={disabled} onChange={onChange} /> : pending ? <div>
        <p>明确选择工作单所属对象；不会自动建立或猜测关联。</p>
        {pending.required.map(key => <div key={key} className="design-field"><label>{designLabels[key]}</label>
          <Select aria-label={`新建${designLabels[key]}`} style={{ width: '100%' }} disabled={disabled} placeholder="请选择已有对象"
            options={options(key)} value={pending.row[key] as string | undefined}
            onChange={next => setPending({ ...pending, row: { ...pending.row, [key]: next } })} />
          {!options(key).length && <p>暂无可选对象，请先在对应栏目建立对象。</p>}
        </div>)}
        <Space><Button onClick={() => { setPending(undefined); setError('') }}>返回编辑</Button>
          <Button disabled={disabled || pending.required.some(key => !pending.row[key])} onClick={confirmAdd}>建立工作单</Button></Space>
      </div> : <DesignFields value={value} path={path} fields={object?.fields} allowStructure={!object} disabled={disabled} onChange={next => {
        setTarget({ ...targetFor(next, path), object: target.object }); onChange(next)
      }} onAdd={add} onRemove={remove} />}
  </>
  return <>
    {!hideTriggers && <Button onClick={event => openEditor(event.currentTarget, ['direction'])}>编辑六岗设计</Button>}
    {!hideTriggers && <Button ref={navigationTrigger} aria-expanded={navigationOpen} onClick={() => setNavigationOpen(!navigationOpen)}>关系导航</Button>}
    {navigationOpen && createPortal(<aside className="director-relations-navigation" aria-label="场次关系导航" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); closeNavigation() }
    }}>
      <header><h2>场次关系</h2><Button onClick={closeNavigation}>关闭关系导航</Button></header>
      <Button onClick={event => openEditor(event.currentTarget, ['direction'])}>全场共享设计</Button>
      <Button onClick={event => openEditor(event.currentTarget, ['assets'])}>查看项目资产关联</Button>
      {groups.map(group => <details key={group.label} open>
        <summary>{group.label} · {group.rows.length}</summary>
        {!group.rows.length && <p>当前不存在{group.label}</p>}
        {group.rows.map((row, index) => <Button key={row.id} aria-label={`定位${group.label}：${row.name || `${group.label} ${index + 1}`}`}
          onClick={event => openEditor(event.currentTarget, { path: [...group.path, index], identity: { id: row.id } })}>
          {index + 1} · {row.name || '未填写'}
        </Button>)}
      </details>)}
    </aside>, document.querySelector('.canvas-workbench') || document.body)}
    <WorkbenchModal width={880} title={object?.label || '全场六岗设计'} open={open}
      afterClose={() => (editorTrigger.current?.isConnected ? editorTrigger.current : navigationTrigger.current)?.focus({ preventScroll: true })}
      onCancel={() => { setOpen(false); setPending(undefined) }} footer={<Button onClick={() => { setOpen(false); setPending(undefined) }}>完成编辑</Button>}>
      {editorBody()}
    </WorkbenchModal>
    {sideOpen && <CanvasQuickEditor title={object?.label || '设计卡片'} onClose={() => { setSideOpen(false); setPending(undefined) }}>
      {editorBody()}
    </CanvasQuickEditor>}
  </>
}
