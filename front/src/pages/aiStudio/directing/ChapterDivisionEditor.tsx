import { useUiText } from '../../../uiText'
import { useEffect, useRef, useState, type MutableRefObject, type FocusEvent } from 'react'
import { Button, Drawer, Input, Modal, Select, Space, Tooltip, Alert, message, Dropdown } from 'antd'
import { PlusOutlined, SelectOutlined, ScissorOutlined, MergeCellsOutlined, EditOutlined, CheckOutlined, CloseOutlined, UndoOutlined } from '@ant-design/icons'
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
  const uiText = useUiText()
  const draft = { ...inputDraft, members: orderedDivisionMembers(inputDraft.members) }
  const [selection, setSelection] = useState<SourceSpan>()
  useEffect(() => { setSelection(undefined) }, [activeId, chapter.source_version, chapter.current_version?.id])
  const [phase, setPhase] = useState<'create' | 'split' | 'range'>()
  const [newName, setNewName] = useState('')
  const [rename, setRename] = useState<{ key?: string; value: string; original: string }>()
  const [nameError, setNameError] = useState('')
  const composing = useRef(false)
  const [review, setReview] = useState<{ plan: DivisionPlan; action: DivisionAssignment; title: string; splitKey?: string; baseline: ChapterDivisionDraft }>()
  const [reviewCache, setReviewCache] = useState<typeof review>()
  const resultNames = useRef(new Map<string, string>())
  const keepResultNames = (plan: DivisionPlan): DivisionPlan => ({ ...plan, draft: { ...plan.draft, members: plan.draft.members.map(row => ({ ...row, title: resultNames.current.get(`${row.span?.start}:${row.span?.end}`) ?? row.title })) } })
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
  const resetInteraction = () => { setPhase(undefined); setNewName(''); setRename(undefined); setNameError(''); setSelection(undefined); setReview(undefined); setReviewCache(undefined); resultNames.current.clear() }
  const nameInvalid = !!rename && !rename.value.trim()
  const blocked = review || reviewCache || phase || selection ? uiText("请先确认或取消当前操作") : nameInvalid ? uiText("请补全场次名称") : undefined
  const interactionDirty = !!review || !!reviewCache || !!selection || !!newName || !!rename && rename.value !== rename.original
  useEffect(() => { onInteractionChange?.({ dirty: interactionDirty, blocked }) }, [onInteractionChange, interactionDirty, blocked, selection, newName, rename])
  const prepareName = () => {
    if (nameInvalid) { setNameError(uiText("请输入场次名称")); return undefined }
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
    if (reviewCache || phase || selection || nameInvalid) Modal.confirm({ title: uiText("放弃本次操作？"), content: uiText("此前已确认的本章草稿保持不变。"), okText: uiText("放弃本次操作"), cancelText: uiText("继续当前操作"), onOk: () => { resetInteraction(); action() } })
    else if (finishName()) { resetInteraction(); action() }
  }
  const selectScene = (key: string) => { if (key !== activeId) transition(() => { preservePosition.current = false; onActive(key) }) }
  const beginPhase = (value: 'create' | 'split' | 'range') => {
    const begin = () => { setPhase(value); setNewName(''); setOperationError('') }
    if (nameInvalid || reviewCache) transition(begin)
    else if (!rename || finishName()) begin()
  }
  const beginCreate = () => beginPhase('create')
  const commitPlan = (plan: DivisionPlan) => {
    setUndo({ draft: inputDraft, activeId }); preservePosition.current = true
    onChange(plan.draft); resetInteraction(); onActive(plan.activeKey); void message.success(uiText("已更新本章草稿"))
  }
  const propose = (action: DivisionAssignment, title: string, splitKey?: string, replaceCache = false) => {
    if (readOnly || busy || review) return
    try {
      const cached = replaceCache ? undefined : reviewCache
      const sameAction = (value: DivisionAssignment) => JSON.stringify([value.mode, value.span, value.targetKey, value.edge, value.title])
      if (cached?.baseline === inputDraft && sameAction(cached.action) === sameAction(action)) { setReview(cached); return }
      if (cached) { transition(() => propose(action, title, splitKey, true)); return }
      setReviewCache(undefined); resultNames.current.clear()
      const plan = planDivisionAssignment(draft, chapter.raw_text, action)
      if (!plan.changed) { void message.info(uiText("范围未变化")); resetInteraction(); return }
      setOperationError('')
      if (plan.affected.length) setReview({ plan, action, title, splitKey, baseline: inputDraft })
      else commitPlan(plan)
    } catch (cause) { setOperationError(cause instanceof Error ? cause.message : uiText("操作失败，输入已保留")) }
  }
  const applySpan = (span: SourceSpan) => {
    if (current) propose({ mode: 'range', targetKey: current.key, span, key: crypto.randomUUID() }, '确认范围调整')
  }
  const retainIdentity = (id: string, replaceCache = false) => {
    if (!current) return
    if (!replaceCache && reviewCache?.baseline === inputDraft && reviewCache.title === '确认关联变更' && reviewCache.plan.draft.members.find(row => row.key === current.key)?.sequence_id === (id || undefined)) { setReview(reviewCache); return }
    if (reviewCache && !replaceCache) { transition(() => retainIdentity(id, true)); return }
    setReviewCache(undefined)
    resultNames.current.clear()
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
    if (!contiguous) { setOperationError(uiText("两场之间仍有未选原文，不能合并")); return }
    propose({ mode: 'append', targetKey: neighbor.key, span: current.span, key: crypto.randomUUID() }, '确认合并场次')
  }
  const primary = phase === 'create' ? '创建场次' : phase === 'split' ? '确认拆分' : phase === 'range' ? current?.span ? '确认范围调整' : '确认定位' : '新建场次'
  const sourceActions = !readOnly && <Space wrap className="chapter-source-actions">
    <Button className="chapter-stage-primary" icon={<PlusOutlined aria-hidden />} disabled={!chapter.raw_text.trim() || (phase === 'create' ? !selection || !newName.trim() || !sourceSlice(chapter.raw_text, selection).trim() : phase === 'split' ? !canSplit : phase === 'range' ? !selection : false)} onClick={() => {
      if (!phase) beginCreate()
      else if (phase === 'create' && selection) propose({ mode: 'new', span: selection, title: newName, key: crypto.randomUUID() }, '确认新建场次')
      else if (phase === 'split' && current?.span && selection) propose({ mode: 'new', span: { start: selection.start, end: current.span.end }, title: `${current.title}（拆分）`, key: crypto.randomUUID() }, '确认拆分场次', current.key)
      else if (phase === 'range' && selection) applySpan(selection)
    }}>{uiText(primary)}</Button>
    {phase ? <Button onClick={resetInteraction}>{uiText(phase === 'create' ? '取消新建' : phase === 'split' ? '取消拆分' : '取消范围调整')}</Button> : <>
      {reviewCache && <Tooltip title={uiText("继续当前操作")}><Button aria-label={uiText("继续当前操作")} icon={<EditOutlined aria-hidden />} onClick={() => setReview(reviewCache)} /></Tooltip>}
      <Dropdown trigger={['click']} menu={{ items: selection ? [
        { key: 'before', label: targets?.before ? uiText("并入前场 · {{title}}", { title: targets.before.title }) : uiText("并入前场（无连续目标）"), disabled: !targets?.before, onClick: () => append(targets!.before!.key, 'before') },
        { key: 'after', label: targets?.after ? uiText("并入后场 · {{title}}", { title: targets.after.title }) : uiText("并入后场（无连续目标）"), disabled: !targets?.after, onClick: () => append(targets!.after!.key, 'after') },
        ...(targets?.covered || []).map(row => ({ key: row.key, label: uiText("合并并保留 {{title}}", { title: row.title }), onClick: () => append(row.key) })),
      ] : ([-1, 1] as const).map(direction => {
        const neighbor = draft.members[index + direction]
        const available = !!current?.span && !!neighbor?.span && (direction < 0 ? neighbor.span.end === current.span.start : current.span.end === neighbor.span.start)
        return { key: String(direction), label: available ? uiText("与{{value1}}场合并 · {{title}}", { value1: uiText(direction < 0 ? '前' : '后'), title: neighbor!.title }) : uiText("与{{value1}}场合并（无连续目标）", { value1: uiText(direction < 0 ? '前' : '后') }), disabled: !available, onClick: () => mergeScene(direction) }
      }) }}><Tooltip title={uiText("并入／合并场次")}><Button aria-label={uiText("并入／合并场次")} icon={<MergeCellsOutlined aria-hidden />} /></Tooltip></Dropdown>
      {(selection || reviewCache) && <Tooltip title={uiText("取消本次操作")}><Button aria-label={uiText("取消本次操作")} icon={<CloseOutlined aria-hidden />} onClick={resetInteraction} /></Tooltip>}
      <Tooltip title={uiText("拆分当前场次")}><Button aria-label={uiText("拆分当前场次")} icon={<ScissorOutlined aria-hidden />} disabled={!current?.span} onClick={() => beginPhase('split')} /></Tooltip>
      <Tooltip title={current?.span ? uiText("调整范围") : uiText("重新定位")}><Button aria-label={current?.span ? uiText("调整范围") : uiText("重新定位")} icon={<SelectOutlined aria-hidden />} disabled={!current} onClick={() => beginPhase('range')} /></Tooltip>
      <Tooltip title={uiText("撤销上一步")}><Button aria-label={uiText("撤销上一步")} icon={<UndoOutlined aria-hidden />} disabled={!undo} onClick={() => transition(() => { if (undo) { preservePosition.current = true; onChange(undo.draft); onActive(undo.activeId); setUndo(undefined) } })} /></Tooltip>
    </>}
    {phase === 'create' && <Input aria-label={uiText("新场次名称")} placeholder={uiText("场次名称")} value={newName} onChange={event => setNewName(event.target.value)} />}
    {phase === 'split' && <span role="status">{canSplit ? uiText("断点：{{value1}}｜{{value2}}", { value1: sourceSlice(chapter.raw_text, { start: Math.max(current!.span!.start, selection!.start - 8), end: selection!.start }), value2: sourceSlice(chapter.raw_text, { start: selection!.start, end: Math.min(current!.span!.end, selection!.start + 8) }) }) : uiText("请选择场次内部断点后的文字")}</span>}
    {nameInvalid && <Button type="text" onClick={() => { if (drawerMode) setEditing(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.chapter-scene-name-row input')?.focus()) }}>{uiText("完善场次名称")}</Button>}
    {operationError && <Alert type="error" message={operationError} />}
  </Space>
  const finishOnRowBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (rename && !composing.current && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) finishName()
  }
  const nameInput = rename && <>
            <Input autoFocus aria-label={rename?.key ? uiText("场次标题") : uiText("新场次名称")} status={nameError ? 'error' : undefined} value={rename?.value || ''} onChange={event => { setRename({ ...rename!, value: event.target.value }); setNameError('') }}
              onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
              onKeyDown={event => {
                if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
                if (event.key === 'Enter') { event.preventDefault(); finishName() }
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRename(undefined); setNameError('') }
              }} />
            <Button aria-label={uiText("确认改名")} icon={<CheckOutlined aria-hidden />} onPointerDown={event => event.preventDefault()} onClick={finishName} />
            <Button aria-label={uiText("取消改名")} icon={<CloseOutlined aria-hidden />} onPointerDown={event => event.preventDefault()} onClick={() => { setRename(undefined); setNameError('') }} />
  </>
  const editorPanel = <aside className="chapter-division-list" aria-label={uiText("划场场次列表")}>
    <div className="chapter-division-members">{!drawerMode && <h3>{readOnly ? uiText("历史场次") : uiText("本章场次")}</h3>}
      {draft.members.map((row, index) => <div className="chapter-division-member" key={row.key}>
        <div className="chapter-scene-name-row" onBlur={finishOnRowBlur}>
          {rename?.key === row.key ? <>
            {nameInput}
          </> : <>
            <Button className="chapter-scene-select" aria-pressed={current?.key === row.key} onClick={() => selectScene(row.key)}>{index + 1}. {row.title || uiText("未命名")}{!row.span ? uiText(" · 待定位") : ''}</Button>
            {!readOnly && <Button aria-label={uiText("编辑场次名称")} icon={<EditOutlined aria-hidden />} onClick={() => transition(() => { onActive(row.key); setRename({ key: row.key, value: row.title, original: row.title }) })} />}
          </>}
        </div>
        {rename?.key === row.key && nameError && <small role="alert">{nameError}</small>}
        {current?.key === row.key && !readOnly && <Button type="text" danger onClick={() => transition(() => { setReview({ plan: { draft: removeDivisionMember(draft, current.key), activeKey: draft.members.find(row => row.key !== current.key)?.key || '', affected: [current], fragmented: [], changed: true }, title: '确认移出场次', action: { mode: 'range', key: current.key, span: current.span || { start: 0, end: 1 } }, baseline: inputDraft }) })}>{uiText("移出本章草稿")}</Button>}
      </div>)}
      {!draft.members.length && <p>{uiText("尚无场次，可框选原文新建。")}</p>}

    </div>
  </aside>
  return <>
    <WorkspaceWriteBoundary busy={!!review}>
    {drawerMode && <Button ref={editTrigger} onClick={() => setEditing(true)}>{uiText("本章场次")}</Button>}
    <div ref={layoutRef} className={`chapter-division-layout${drawerMode ? ' with-editor-drawer' : ''}`}>
      <ChapterSourceSelection projectId={projectId} chapterId={readOnly ? `${chapter.chapter_id}:history:${chapter.current_version?.id}` : chapter.chapter_id} raw={chapter.raw_text}
        marks={draft.members.filter(row => row.span).map((row, index) => ({ id: row.key, label: `${index + 1} · ${row.title || uiText("未命名")}`, span: row.span! }))}
        pendingSpan={selection} span={selection || current?.span} focusId={current?.key} onScene={selectScene} onSelect={setSelection} readOnly={readOnly || !!review} preserveFocusScroll={preservePosition.current} actions={<>{sourceActions}{current && !readOnly && (old?.source_changed || current.suggested_excerpt || !current.sequence_id) && <details>
        <summary>{uiText("核对来源与关联")}</summary>
        {excerpt && <p className="chapter-source-excerpt">{excerpt}</p>}
        {!!matches.length && <Select aria-label={uiText("原文出现位置")} placeholder={uiText("选择原文位置")} value={matches.some(item => sameSpan(item, current.span)) ? current.span?.start : undefined}
          style={{ width: '100%' }} options={matches.map((item, index) => ({ value: item.start, label: uiText("第 {{value1}} 次出现 · {{value2}}", { value1: index + 1, value2: sourceSlice(chapter.raw_text, item) }) }))} onChange={start => applySpan(matches.find(item => item.start === start)!)} />}
        <Select aria-label={uiText("保留场次身份")} style={{ width: '100%' }} value={current.sequence_id || ''}
          options={[{ value: '', label: uiText("新增场次") }, ...identities.filter(row => draft.baseline.some(item => item.sequence_id === row.id) || restoredBaseline.some(item => item.sequence_id === row.id)).map(row => ({ value: row.id, label: uiText("沿用：{{title}}", { title: row.title }), disabled: draft.members.some(other => other.key !== current.key && other.sequence_id === row.id) }))]} onChange={id => retainIdentity(id)} />
      </details>}</>} />
      {!drawerMode && editorPanel}

    </div>
    </WorkspaceWriteBoundary>
    {review && <DivisionOperationReview projectId={projectId} chapterId={chapter.chapter_id} raw={chapter.raw_text} before={review.baseline} plan={review.plan} title={uiText(review.title)} splitKey={review.splitKey}
      onChange={plan => {
        for (const row of plan.draft.members) {
          if (row.title !== review.plan.draft.members.find(old => old.key === row.key)?.title) resultNames.current.set(`${row.span?.start}:${row.span?.end}`, row.title)
        }
        setReview({ ...review, plan })
      }} onCancel={() => { setReviewCache(review); setReview(undefined) }} onRetain={(key, after) => {
        if (review.splitKey) {
          const original = draft.members.find(row => row.key === key)!
          const plan = planDivisionAssignment(draft, chapter.raw_text, review.action)
          if (after) plan.draft.members = plan.draft.members.map(row => row.key === key ? { ...row, sequence_id: undefined, title: `${original.title}（拆分）` } : row.key === plan.activeKey ? { ...row, sequence_id: original.sequence_id, title: original.title } : row)
          setReview({ ...review, plan: keepResultNames(plan) })
        } else {
          const retainAfter = new Set(review.action.retainAfter || [])
          if (after) retainAfter.add(key); else retainAfter.delete(key)
          const action = { ...review.action, retainAfter: [...retainAfter] }
          setReview({ ...review, action, plan: keepResultNames(planDivisionAssignment(draft, chapter.raw_text, action)) })
        }
      }} onConfirm={() => {
        if (draftRef.current !== review.baseline) { setOperationError(uiText("划分基线已变化，请重新预览")); setReview(undefined); return }
        commitPlan(review.plan)
      }} />}
    {drawerMode && <Drawer aria-label={uiText("本章场次")} className="management-division-drawer" title={uiText("本章场次")} width="min(340px, 100vw)" open={editing} onClose={() => setEditing(false)}
      afterOpenChange={open => {
        if (open) document.querySelector<HTMLInputElement>('.ant-drawer-open .chapter-scene-name-row input')?.focus({ preventScroll: true })
        else editTrigger.current?.focus({ preventScroll: true })
      }}><WorkspaceWriteBoundary busy={busy || !!review}>{editorPanel}</WorkspaceWriteBoundary></Drawer>}
  </>
}
