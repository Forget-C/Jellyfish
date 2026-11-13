import { useEffect, useRef, useState, type MutableRefObject, type FocusEvent } from 'react'
import { Button, Drawer, Input, Modal, Select, Space, Tooltip, Alert, message } from 'antd'
import { PlusOutlined, SelectOutlined, ScissorOutlined, MergeCellsOutlined, EditOutlined, CheckOutlined, CloseOutlined, UndoOutlined, ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons'
import type { ChapterSequences, DivisionBaseline, SequenceRead, SourceSpan } from '../../../services/generated'
import { ChapterSourceSelection } from './ChapterSourceSelection'
import { WorkspaceWriteBoundary } from './WorkspaceDrafts'
import { excerptMatches } from './common'
import { orderedDivisionMembers, removeDivisionMember, type ChapterDivisionDraft } from './chapterDivision'
import { DivisionOperationReview } from './DivisionOperationReview'
import { divisionAssignmentTargets, planDivisionAssignment, type DivisionAssignment, type DivisionPlan } from './divisionOperations'
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
  const [phase, setPhase] = useState<'create' | 'split' | 'range'>()
  const [newName, setNewName] = useState('')
  const [rename, setRename] = useState<{ key?: string; value: string; original: string }>()
  const [nameError, setNameError] = useState('')
  const composing = useRef(false)
  const [review, setReview] = useState<{ plan: DivisionPlan; action: DivisionAssignment; title: string; splitKey?: string; baseline: ChapterDivisionDraft }>()
  const [undo, setUndo] = useState<{ draft: ChapterDivisionDraft; activeId?: string }>()
  const [operationError, setOperationError] = useState('')
  const preservePosition = useRef(false)
  const draftRef = useRef(inputDraft)
  draftRef.current = inputDraft
  useEffect(() => { setUndo(undefined); setReview(undefined) }, [chapter.source_version, chapter.current_version?.id])
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
  const resetInteraction = () => { setPhase(undefined); setNewName(''); setRename(undefined); setNameError(''); setSelection(undefined); setReview(undefined) }
  const nameInvalid = !!rename && !rename.value.trim()
  const blocked = review || phase || selection ? '请先确认或取消当前操作' : nameInvalid ? '请补全场次名称' : undefined
  const interactionDirty = !!review || !!selection || !!newName || !!rename && rename.value !== rename.original
  useEffect(() => { onInteractionChange?.({ dirty: interactionDirty, blocked }) }, [onInteractionChange, interactionDirty, blocked, selection, newName, rename])
  const prepareName = () => {
    if (nameInvalid) { setNameError('请输入场次名称'); return undefined }
    return rename?.key ? { ...draft, members: draft.members.map(row => row.key === rename.key ? { ...row, title: rename.value.trim() } : row) } : draft
  }
  const finishName = () => {
    const value = prepareName()
    if (!value) return false
    if (rename?.key) { setUndo(undefined); onChange(value) }
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
  const selectScene = (key: string) => { if (key !== activeId) transition(() => { preservePosition.current = false; onActive(key) }) }
  const beginPhase = (value: 'create' | 'split' | 'range') => {
    const begin = () => { setPhase(value); setNewName(''); setOperationError('') }
    if (nameInvalid) transition(begin)
    else if (!rename || finishName()) begin()
  }
  const beginCreate = () => beginPhase('create')
  const commitPlan = (plan: DivisionPlan) => {
    setUndo({ draft: inputDraft, activeId }); preservePosition.current = true
    onChange(plan.draft); resetInteraction(); onActive(plan.activeKey); void message.success('已更新本章草稿')
  }
  const propose = (action: DivisionAssignment, title: string, splitKey?: string) => {
    if (readOnly || busy || review) return
    try {
      const plan = planDivisionAssignment(draft, chapter.raw_text, action)
      if (!plan.changed) { void message.info('范围未变化'); resetInteraction(); return }
      setOperationError('')
      if (plan.affected.length) setReview({ plan, action, title, splitKey, baseline: inputDraft })
      else commitPlan(plan)
    } catch (cause) { setOperationError(cause instanceof Error ? cause.message : '操作失败，输入已保留') }
  }
  const applySpan = (span: SourceSpan) => {
    if (current) propose({ mode: 'range', targetKey: current.key, span, key: crypto.randomUUID() }, '确认范围调整')
  }
  const retainIdentity = (id: string) => {
    if (!current) return
    const members = draft.members.map(row => row.key === current.key ? { ...row, sequence_id: id || undefined,
      reconfirm_source: row.reconfirm_source || identities.find(old => old.id === id)?.source_changed || undefined } : row)
    const retained = new Set(members.map(row => row.sequence_id))
    const value = { ...draft, members,
      exited_sequence_ids: draft.baseline.filter(row => !retained.has(row.sequence_id)).map(row => row.sequence_id),
      restored_baseline: restoredBaseline.filter(row => retained.has(row.sequence_id)),
      lineage: draft.lineage.map(origin => ({ ...origin, target_keys: origin.sequence_id === id
        ? [...new Set([...origin.target_keys, current.key])]
        : origin.sequence_id === current.sequence_id ? origin.target_keys.filter(key => key !== current.key) : origin.target_keys })) }
    setReview({ plan: { draft: value, activeKey: current.key, affected: [current], fragmented: [], changed: true }, title: '确认关联变更', action: { mode: 'range', key: current.key, span: current.span || { start: 0, end: 1 } }, baseline: inputDraft })
  }
  const index = draft.members.findIndex(row => row.key === current?.key)
  const targets = selection ? divisionAssignmentTargets(draft, selection) : undefined
  const canSplit = !!current?.span && !!selection && selection.start > current.span.start && selection.start < current.span.end
  const append = (targetKey: string, edge?: 'before' | 'after') => {
    if (selection) propose({ mode: 'append', targetKey, edge, span: selection, key: crypto.randomUUID() }, '确认并入场次')
  }
  const mergeScene = (direction: -1 | 1) => {
    const neighbor = draft.members[index + direction]
    if (!current?.span || !neighbor?.span) return
    const contiguous = direction < 0 ? neighbor.span.end === current.span.start : current.span.end === neighbor.span.start
    if (!contiguous) { setOperationError('两场之间仍有未选原文，不能合并'); return }
    propose({ mode: 'append', targetKey: neighbor.key, span: current.span, key: crypto.randomUUID() }, '确认合并场次')
  }
  const primary = phase === 'create' ? '创建场次' : phase === 'split' ? '确认拆分' : phase === 'range' ? current?.span ? '确认范围调整' : '确认定位' : '新建场次'
  const sourceActions = !readOnly && <Space wrap className="chapter-source-actions">
    <Button className="chapter-stage-primary" icon={<PlusOutlined aria-hidden />} disabled={!chapter.raw_text.trim() || (phase === 'create' ? !selection || !newName.trim() || !sourceSlice(chapter.raw_text, selection).trim() : phase === 'split' ? !canSplit : phase === 'range' ? !selection : false)} onClick={() => {
      if (!phase) beginCreate()
      else if (phase === 'create' && selection) propose({ mode: 'new', span: selection, title: newName, key: crypto.randomUUID() }, '确认新建场次')
      else if (phase === 'split' && current?.span && selection) propose({ mode: 'new', span: { start: selection.start, end: current.span.end }, title: `${current.title}（拆分）`, key: crypto.randomUUID() }, '确认拆分场次', current.key)
      else if (phase === 'range' && selection) applySpan(selection)
    }}>{primary}</Button>
    {phase ? <Button onClick={resetInteraction}>取消{phase === 'create' ? '新建' : phase === 'split' ? '拆分' : '范围调整'}</Button> : <>
      {selection && <>
        <Tooltip title={targets?.before ? '仅并入连续相接的前场' : '选区前方没有连续相接的有效场次'}><Button icon={<ArrowLeftOutlined aria-hidden />} disabled={!targets?.before} onClick={() => append(targets!.before!.key, 'before')}>并入前场{targets?.before ? ` · ${targets.before.title}` : ''}</Button></Tooltip>
        <Tooltip title={targets?.after ? '仅并入连续相接的后场' : '选区后方没有连续相接的有效场次'}><Button icon={<ArrowRightOutlined aria-hidden />} disabled={!targets?.after} onClick={() => append(targets!.after!.key, 'after')}>并入后场{targets?.after ? ` · ${targets.after.title}` : ''}</Button></Tooltip>
        {!!targets?.covered.length && <Select<string> aria-label="合并并保留场次" placeholder="合并并保留…" value={undefined} options={targets.covered.map(row => ({ value: row.key, label: `合并并保留 ${row.title}` }))} onChange={key => append(key)} />}
        <Button onClick={resetInteraction}>取消选区</Button>
      </>}
      <Tooltip title="拆分当前场次"><Button aria-label="拆分当前场次" icon={<ScissorOutlined aria-hidden />} disabled={!current?.span} onClick={() => beginPhase('split')} /></Tooltip>
      <Button icon={<SelectOutlined aria-hidden />} disabled={!current} onClick={() => beginPhase('range')}>{current?.span ? '调整范围' : '重新定位'}</Button>
      {([-1, 1] as const).map(direction => {
        const neighbor = draft.members[index + direction]
        const available = !!current?.span && !!neighbor?.span && (direction < 0 ? neighbor.span.end === current.span.start : current.span.end === neighbor.span.start)
        return <Tooltip key={direction} title={available ? `合并并保留「${neighbor!.title}」` : '没有连续相接的邻场'}><Button icon={<MergeCellsOutlined aria-hidden />} disabled={!available} onClick={() => mergeScene(direction)}>与{direction < 0 ? '前' : '后'}场合并</Button></Tooltip>
      })}
      <Button icon={<UndoOutlined aria-hidden />} disabled={!undo} onClick={() => transition(() => { if (undo) { preservePosition.current = true; onChange(undo.draft); onActive(undo.activeId); setUndo(undefined) } })}>撤销上一步</Button>
    </>}
    {phase === 'create' && <Input aria-label="新场次名称" placeholder="场次名称" value={newName} onChange={event => setNewName(event.target.value)} />}
    {phase === 'split' && <span role="status">{canSplit ? `断点：${sourceSlice(chapter.raw_text, { start: Math.max(current!.span!.start, selection!.start - 8), end: selection!.start })}｜${sourceSlice(chapter.raw_text, { start: selection!.start, end: Math.min(current!.span!.end, selection!.start + 8) })}` : '请选择场次内部断点后的文字'}</span>}
    {nameInvalid && <Button type="text" onClick={() => { if (drawerMode) setEditing(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.chapter-scene-name-row input')?.focus()) }}>完善场次名称</Button>}
    {operationError && <Alert type="error" message={operationError} />}
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
        {current?.key === row.key && !readOnly && <Button type="text" danger onClick={() => transition(() => { setReview({ plan: { draft: removeDivisionMember(draft, current.key), activeKey: draft.members.find(row => row.key !== current.key)?.key || '', affected: [current], fragmented: [], changed: true }, title: '确认移出场次', action: { mode: 'range', key: current.key, span: current.span || { start: 0, end: 1 } }, baseline: inputDraft }) })}>移出本章草稿</Button>}
      </div>)}
      {!draft.members.length && <p>尚无场次，可框选原文新建。</p>}

    </div>
  </aside>
  return <>
    <WorkspaceWriteBoundary busy={!!review}>
    {drawerMode && <Button ref={editTrigger} onClick={() => setEditing(true)}>本章场次</Button>}
    <div ref={layoutRef} className={`chapter-division-layout${drawerMode ? ' with-editor-drawer' : ''}`}>
      <ChapterSourceSelection projectId={projectId} chapterId={readOnly ? `${chapter.chapter_id}:history:${chapter.current_version?.id}` : chapter.chapter_id} raw={chapter.raw_text}
        marks={draft.members.filter(row => row.span).map((row, index) => ({ id: row.key, label: `${index + 1} · ${row.title || '未命名'}`, span: row.span! }))}
        pendingSpan={selection} span={selection || current?.span} focusId={current?.key} onScene={selectScene} onSelect={setSelection} readOnly={readOnly || !!review} preserveFocusScroll={preservePosition.current} actions={<>{sourceActions}{current && !readOnly && (old?.source_changed || current.suggested_excerpt || !current.sequence_id) && <details>
        <summary>核对来源与关联</summary>
        {excerpt && <p className="chapter-source-excerpt">{excerpt}</p>}
        {!!matches.length && <Select aria-label="原文出现位置" placeholder="选择原文位置" value={matches.some(item => sameSpan(item, current.span)) ? current.span?.start : undefined}
          style={{ width: '100%' }} options={matches.map((item, index) => ({ value: item.start, label: `第 ${index + 1} 次出现 · ${sourceSlice(chapter.raw_text, item)}` }))} onChange={start => applySpan(matches.find(item => item.start === start)!)} />}
        <Select aria-label="保留场次身份" style={{ width: '100%' }} value={current.sequence_id || ''}
          options={[{ value: '', label: '新增场次' }, ...identities.filter(row => draft.baseline.some(item => item.sequence_id === row.id) || restoredBaseline.some(item => item.sequence_id === row.id)).map(row => ({ value: row.id, label: `沿用：${row.title}`, disabled: draft.members.some(other => other.key !== current.key && other.sequence_id === row.id) }))]} onChange={retainIdentity} />
      </details>}</>} />
      {!drawerMode && editorPanel}

    </div>
    </WorkspaceWriteBoundary>
    {review && <DivisionOperationReview projectId={projectId} chapterId={chapter.chapter_id} raw={chapter.raw_text} before={review.baseline} plan={review.plan} title={review.title} splitKey={review.splitKey}
      onChange={plan => setReview({ ...review, plan })} onCancel={() => setReview(undefined)} onRetain={(key, after) => {
        if (review.splitKey) {
          const original = draft.members.find(row => row.key === key)!
          const plan = planDivisionAssignment(draft, chapter.raw_text, review.action)
          if (after) plan.draft.members = plan.draft.members.map(row => row.key === key ? { ...row, sequence_id: undefined, title: `${original.title}（拆分）` } : row.key === plan.activeKey ? { ...row, sequence_id: original.sequence_id, title: original.title } : row)
          setReview({ ...review, plan })
        } else {
          const retainAfter = new Set(review.action.retainAfter || [])
          if (after) retainAfter.add(key); else retainAfter.delete(key)
          const action = { ...review.action, retainAfter: [...retainAfter] }
          setReview({ ...review, action, plan: planDivisionAssignment(draft, chapter.raw_text, action) })
        }
      }} onConfirm={() => {
        if (draftRef.current !== review.baseline) { setOperationError('划分基线已变化，请重新预览'); setReview(undefined); return }
        commitPlan(review.plan)
      }} />}
    {drawerMode && <Drawer aria-label="本章场次" className="management-division-drawer" title="本章场次" width="min(340px, 100vw)" open={editing} onClose={() => setEditing(false)}
      afterOpenChange={open => {
        if (open) document.querySelector<HTMLInputElement>('.ant-drawer-open .chapter-scene-name-row input')?.focus({ preventScroll: true })
        else editTrigger.current?.focus({ preventScroll: true })
      }}><WorkspaceWriteBoundary busy={busy || !!review}>{editorPanel}</WorkspaceWriteBoundary></Drawer>}
  </>
}
