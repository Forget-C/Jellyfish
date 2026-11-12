import { useEffect, useRef, useState, type MutableRefObject, type FocusEvent } from 'react'
import { Button, Drawer, Input, Modal, Radio, Select, Space, Tooltip } from 'antd'
import { PlusOutlined, SelectOutlined, ScissorOutlined, MergeCellsOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons'
import type { ChapterSequences, DivisionBaseline, SequenceRead, SourceSpan } from '../../../services/generated'
import { ChapterSourceSelection } from './ChapterSourceSelection'
import { WorkspaceWriteBoundary } from './WorkspaceDrafts'
import { excerptMatches } from './common'
import { changeDivisionSpan, orderedDivisionMembers, removeDivisionMember, type ChapterDivisionDraft } from './chapterDivision'
import { sameSpan, sourceSlice } from './sourceSelection'

export type DivisionInteraction = { prepare: () => ChapterDivisionDraft | undefined; discard: () => void }
export type DivisionInteractionStatus = { dirty: boolean; blocked?: string }

/** 手动、AI 和历史方案共用原文选区与场次编辑；历史浏览只改变选中项。 */
export function ChapterDivisionEditor({ projectId, chapter, draft: inputDraft, activeId, onActive, onChange, interactionRef, onInteractionChange, readOnly = false, management = false, busy = false, historicalMembers = [], restoredBaseline = [] }: {
  projectId: string; chapter: ChapterSequences; draft: ChapterDivisionDraft; activeId?: string
  interactionRef?: MutableRefObject<DivisionInteraction | undefined>; onInteractionChange?: (status: DivisionInteractionStatus) => void
  onActive: (id?: string) => void
  onChange: (draft: ChapterDivisionDraft) => void; readOnly?: boolean; management?: boolean; busy?: boolean; historicalMembers?: SequenceRead[]; restoredBaseline?: DivisionBaseline[]
}) {
  const draft = { ...inputDraft, members: orderedDivisionMembers(inputDraft.members) }
  const [selection, setSelection] = useState<SourceSpan>()
  useEffect(() => { setSelection(undefined) }, [activeId, chapter.source_version, chapter.current_version?.id])
  const [phase, setPhase] = useState<'create' | 'split' | 'merge'>()
  const [newName, setNewName] = useState('')
  const [rename, setRename] = useState<{ key?: string; value: string; original: string }>()
  const [nameError, setNameError] = useState('')
  const composing = useRef(false)
  const [operation, setOperation] = useState<'split' | 'merge'>()
  const [retain, setRetain] = useState('first')
  const layoutRef = useRef<HTMLDivElement>(null)
  const editTrigger = useRef<HTMLButtonElement>(null)
  const [width, setWidth] = useState(0)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!management || !layoutRef.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(layoutRef.current)
    return () => observer.disconnect()
  }, [management])
  const drawerMode = management && width > 0 && width < 900
  useEffect(() => { if (!drawerMode) setEditing(false) }, [drawerMode])
  const current = draft.members.find(row => row.key === activeId)
  const identities = [...chapter.sequences, ...historicalMembers.filter(row => !chapter.sequences.some(current => current.id === row.id))]
  const old = identities.find(row => row.id === current?.sequence_id)
  const excerpt = current?.suggested_excerpt || old?.source_text
  const matches = excerpt ? excerptMatches(chapter.raw_text, excerpt) : []
  const resetInteraction = () => { setPhase(undefined); setNewName(''); setRename(undefined); setNameError(''); setSelection(undefined); setOperation(undefined) }
  const nameInvalid = !!rename && !rename.value.trim()
  const blocked = phase || selection ? '请先确认或取消当前操作' : nameInvalid ? '请补全场次名称' : undefined
  const interactionDirty = !!selection || !!newName || !!rename && rename.value !== rename.original
  useEffect(() => { onInteractionChange?.({ dirty: interactionDirty, blocked }) }, [onInteractionChange, interactionDirty, blocked, selection, newName, rename])
  const prepareName = () => {
    if (nameInvalid) { setNameError('请输入场次名称'); return undefined }
    return rename?.key ? { ...draft, members: draft.members.map(row => row.key === rename.key ? { ...row, title: rename.value.trim() } : row) } : draft
  }
  const finishName = () => {
    const value = prepareName()
    if (!value) return false
    if (rename?.key) onChange(value)
    else if (rename) setNewName(rename.value.trim())
    setRename(undefined); setNameError(''); return true
  }
  if (interactionRef) interactionRef.current = { prepare: () => {
    if (blocked) return undefined
    const value = prepareName()
    if (value && rename) { onChange(value); setRename(undefined) }
    return value
  }, discard: resetInteraction }
  const transition = (action: () => void) => {
    if (!interactionDirty) { resetInteraction(); action(); return }
    if (phase || selection || nameInvalid) Modal.confirm({ title: '放弃本次操作？', content: '此前已确认的本章草稿保持不变。', okText: '放弃本次操作', cancelText: '继续当前操作', onOk: () => { resetInteraction(); action() } })
    else if (finishName()) { resetInteraction(); action() }
  }
  const selectScene = (key: string) => { if (key !== activeId) transition(() => onActive(key)) }
  const beginCreate = () => transition(() => { setPhase('create'); setRename({ value: '', original: '' }); if (drawerMode) setEditing(true) })
  const applySpan = (span: SourceSpan) => {
    if (readOnly) return
    if (current) onChange(changeDivisionSpan(draft, current.key, span))
    else {
      const key = crypto.randomUUID(); onChange({ ...draft, members: [...draft.members, { key, title: '', span }] }); onActive(key)
    }
  }
  const retainIdentity = (id: string) => {
    if (!current) return
    const members = draft.members.map(row => row.key === current.key ? { ...row, sequence_id: id || undefined,
      reconfirm_source: row.reconfirm_source || identities.find(old => old.id === id)?.source_changed || undefined } : row)
    const retained = new Set(members.map(row => row.sequence_id))
    onChange({ ...draft, members,
      exited_sequence_ids: draft.baseline.filter(row => !retained.has(row.sequence_id)).map(row => row.sequence_id),
      restored_baseline: restoredBaseline.filter(row => retained.has(row.sequence_id)),
      lineage: draft.lineage.map(origin => ({ ...origin, target_keys: origin.sequence_id === id
        ? [...new Set([...origin.target_keys, current.key])]
        : origin.sequence_id === current.sequence_id ? origin.target_keys.filter(key => key !== current.key) : origin.target_keys })) })
  }
  const index = draft.members.findIndex(row => row.key === current?.key)
  const next = draft.members[index + 1]
  const canSplit = !!current?.span && !!selection && selection.start > current.span.start && selection.start < current.span.end
  const canMerge = !!current?.span && !!next?.span && current.span.end <= next.span.start
  // 身份只由明确选择沿用；来源映射跟随拆分／合并，已有成果不迁移。
  const applyOperation = () => {
    if (!current?.span || readOnly || busy) return
    if (operation === 'split' && selection && canSplit) {
      const key = crypto.randomUUID()
      const first = { ...current, span: { start: current.span.start, end: selection.start }, sequence_id: retain === 'first' ? current.sequence_id : undefined }
      const second = { ...current, key, title: `${current.title}（拆分）`, span: { start: selection.start, end: current.span.end }, sequence_id: retain === 'second' ? current.sequence_id : undefined }
      onChange({ ...draft, members: draft.members.flatMap(row => row.key === current.key ? [first, second] : [row]),
        lineage: draft.lineage.map(origin => ({ ...origin, target_keys: origin.target_keys.includes(current.key) ? [...new Set([...origin.target_keys, key])] : origin.target_keys })) })
    } else if (operation === 'merge' && next?.span && canMerge) {
      const retained = retain === 'second' ? next : current
      const merged = { ...retained, key: current.key, title: current.title, span: { start: current.span.start, end: next.span.end } }
      const members = draft.members.filter(row => row.key !== next.key).map(row => row.key === current.key ? merged : row)
      const ids = new Set(members.map(row => row.sequence_id))
      onChange({ ...draft, members, exited_sequence_ids: draft.baseline.filter(row => !ids.has(row.sequence_id)).map(row => row.sequence_id),
        restored_baseline: draft.restored_baseline?.filter(row => ids.has(row.sequence_id)),
        lineage: draft.lineage.map(origin => ({ ...origin, target_keys: [...new Set(origin.target_keys.map(key => key === next.key ? current.key : key))] })) })
    }
    resetInteraction()
  }
  const canCreate = !!selection && !draft.members.some(row => row.span && selection.start < row.span.end && row.span.start < selection.end)
  const createFromSelection = () => {
    if (!selection || !canCreate || !newName.trim()) { setNameError('请填写名称并选择未分配原文'); return }
    const key = crypto.randomUUID(); onChange({ ...draft, members: [...draft.members, { key, title: newName.trim(), span: selection }] }); resetInteraction(); onActive(key)
  }
  const selectionLabel = phase === 'create' ? '创建场次' : phase === 'split' ? '确认拆分' : phase === 'merge' ? '确认合并' : !selection ? '应用选区' : !current ? '新建场次' : !current.span ? '确认定位' : '更新场次范围'
  const primaryDisabled = phase === 'create' ? !canCreate || !newName.trim() : phase === 'split' ? !canSplit : phase === 'merge' ? !canMerge : !selection || !current && !canCreate
  const sourceActions = !readOnly && <Space wrap className="chapter-source-actions">
    <Button className="chapter-stage-primary" icon={<SelectOutlined aria-hidden />} disabled={primaryDisabled} onClick={() => {
      if (phase === 'create') createFromSelection()
      else if (phase) { setRetain('first'); setOperation(phase) }
      else if (current && selection) { applySpan(selection); setSelection(undefined) }
      else { setPhase('create'); setRename({ value: '', original: '' }); if (drawerMode) setEditing(true) }
    }}>{selectionLabel}</Button>
    {phase || selection ? <Button onClick={resetInteraction}>取消{phase === 'create' ? '新建' : phase === 'split' ? '拆分' : phase === 'merge' ? '合并' : '范围调整'}</Button> : <>
      <Tooltip title="拆分当前场次"><Button aria-label="拆分当前场次" icon={<ScissorOutlined aria-hidden />} disabled={!current?.span} onClick={() => { setPhase('split'); setSelection(undefined) }} /></Tooltip>
      <Tooltip title="与下一场合并"><Button aria-label="与下一场合并" icon={<MergeCellsOutlined aria-hidden />} disabled={!canMerge} onClick={() => setPhase('merge')} /></Tooltip>
    </>}
    {phase === 'merge' && <span>{current?.title} ＋ {next?.title}</span>}
    {(phase === 'create' && !newName.trim() || nameInvalid) && <Button type="text" onClick={() => {
      if (phase === 'create' && !rename) setRename({ value: newName, original: newName })
      if (drawerMode) setEditing(true)
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.chapter-scene-name-row input')?.focus())
    }}>完善场次名称</Button>}
  </Space>
  const finishOnRowBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (rename && !composing.current && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) finishName()
  }
  const nameInput = rename && <>
            <Input autoFocus aria-label={rename?.key ? '场次标题' : '新场次名称'} status={nameError ? 'error' : undefined} value={rename?.value || ''} onChange={event => { setRename({ ...rename!, value: event.target.value }); setNameError('') }}
              onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
              onKeyDown={event => {
                if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
                if (event.key === 'Enter') { event.preventDefault(); finishName() }
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRename(undefined); setNameError('') }
              }} />
            <Button aria-label="确认改名" icon={<CheckOutlined aria-hidden />} onPointerDown={event => event.preventDefault()} onClick={finishName} />
            <Button aria-label="取消改名" icon={<CloseOutlined aria-hidden />} onPointerDown={event => event.preventDefault()} onClick={() => { setRename(undefined); setNameError('') }} />
  </>
  const editorPanel = <aside className="chapter-division-list" aria-label="划场场次列表">
    <div className="chapter-division-members">{!drawerMode && <h3>{readOnly ? '历史场次' : '本章场次'}</h3>}
      {draft.members.map((row, index) => <div className="chapter-division-member" key={row.key}>
        <div className="chapter-scene-name-row" onBlur={finishOnRowBlur}>
          {rename?.key === row.key ? <>
            {nameInput}
          </> : <>
            <Button className="chapter-scene-select" aria-pressed={current?.key === row.key} onClick={() => selectScene(row.key)}>{index + 1}. {row.title || '未命名'}{!row.span ? ' · 待定位' : ''}</Button>
            {!readOnly && <Button aria-label="编辑场次名称" icon={<EditOutlined aria-hidden />} onClick={() => transition(() => { onActive(row.key); setRename({ key: row.key, value: row.title, original: row.title }) })} />}
          </>}
        </div>
        {rename?.key === row.key && nameError && <small role="alert">{nameError}</small>}
        {current?.key === row.key && !readOnly && <Button type="text" danger onClick={() => transition(() => { onChange(removeDivisionMember(draft, current.key)); onActive(draft.members.find(row => row.key !== current.key)?.key) })}>移出本章草稿</Button>}
      </div>)}
      {!draft.members.length && <p>尚无场次，可框选原文新建。</p>}
      {phase === 'create' && <div className="chapter-scene-name-row" onBlur={finishOnRowBlur}>
        {rename && !rename.key ? nameInput : <><span>{newName || '新场次'}</span><Button aria-label="编辑新场次名称" icon={<EditOutlined aria-hidden />} onClick={() => setRename({ value: newName, original: newName })} /></>}
        {nameError && <small role="alert">{nameError}</small>}
      </div>}
      {!readOnly && <Button block icon={<PlusOutlined aria-hidden />} disabled={!chapter.raw_text.trim()} onClick={beginCreate}>新建场次</Button>}
      {current && !readOnly && (old?.source_changed || current.suggested_excerpt || !current.sequence_id) && <details>
        <summary>核对来源与关联</summary>
        {excerpt && <p className="chapter-source-excerpt">{excerpt}</p>}
        {!!matches.length && <Select aria-label="原文出现位置" placeholder="选择原文位置" value={matches.some(item => sameSpan(item, current.span)) ? current.span?.start : undefined}
          style={{ width: '100%' }} options={matches.map((item, index) => ({ value: item.start, label: `第 ${index + 1} 次出现 · ${sourceSlice(chapter.raw_text, item)}` }))} onChange={start => applySpan(matches.find(item => item.start === start)!)} />}
        <Select aria-label="保留场次身份" style={{ width: '100%' }} value={current.sequence_id || ''}
          options={[{ value: '', label: '新增场次' }, ...identities.filter(row => draft.baseline.some(item => item.sequence_id === row.id) || restoredBaseline.some(item => item.sequence_id === row.id)).map(row => ({ value: row.id, label: `沿用：${row.title}`, disabled: draft.members.some(other => other.key !== current.key && other.sequence_id === row.id) }))]} onChange={retainIdentity} />
      </details>}
    </div>
  </aside>
  return <>
    {drawerMode && <Button ref={editTrigger} onClick={() => setEditing(true)}>本章场次</Button>}
    <div ref={layoutRef} className={`chapter-division-layout${drawerMode ? ' with-editor-drawer' : ''}`}>
      <ChapterSourceSelection projectId={projectId} chapterId={readOnly ? `${chapter.chapter_id}:history:${chapter.current_version?.id}` : chapter.chapter_id} raw={chapter.raw_text}
        marks={draft.members.filter(row => row.span).map((row, index) => ({ id: row.key, label: `${index + 1} · ${row.title || '未命名'}`, span: row.span! }))}
        pendingSpan={selection} span={selection || current?.span} focusId={current?.key} onScene={selectScene} onSelect={setSelection} readOnly={readOnly} actions={sourceActions} />
      {!drawerMode && editorPanel}

    </div>
    <Modal title={operation === 'split' ? '拆分场次' : '合并场次'} open={!!operation} onCancel={() => setOperation(undefined)} onOk={applyOperation} okText={operation === 'split' ? '确认拆分' : '确认合并'} cancelText="取消">
      <p>{operation === 'split' ? '选择哪一场沿用原场次的关联，另一场将新增。' : '选择沿用哪一场的关联；其他场次退出当前划分，已有成果不会自动迁移。'}</p>
      {operation === 'merge' && current?.span && next?.span && current.span.end < next.span.start && <p>两场之间的未分配原文将纳入合并范围。</p>}
      <Radio.Group aria-label="沿用场次关联" value={retain} onChange={event => setRetain(event.target.value)} options={[
        { value: 'first', label: operation === 'split' ? '前一场沿用' : current?.title },
        { value: 'second', label: operation === 'split' ? '后一场沿用' : next?.title },
      ]} />
    </Modal>
    {drawerMode && <Drawer aria-label="本章场次" className="management-division-drawer" title="本章场次" width="min(340px, 100vw)" open={editing} onClose={() => setEditing(false)}
      afterOpenChange={open => {
        if (open) document.querySelector<HTMLInputElement>('.ant-drawer-open .chapter-scene-name-row input')?.focus({ preventScroll: true })
        else editTrigger.current?.focus({ preventScroll: true })
      }}><WorkspaceWriteBoundary busy={busy}>{editorPanel}</WorkspaceWriteBoundary></Drawer>}
  </>
}
