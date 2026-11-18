import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Drawer, Input, Modal, Select, Space, Spin } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { ApiError, StudioDirectingService, type ShootingCheckRead, type ShootingExplanationRead, type ShootingNote, type SourceSpan, type ShootingPreparation_Input as ShootingPreparation } from '../../../services/generated'
import { useWorkspaceDraft } from './WorkspaceDrafts'
import { directingError } from './common'
import { sameSpan, sourceSlice } from './sourceSelection'
import { WorkbenchDialogActions } from './ui/WorkbenchModal'
import { explanationScopes, intersectingScopes, ShootingExplanationSource } from './ShootingExplanationSource'
import { ShootingExplanationReview } from './ShootingExplanationReview'
import './ui/workbenchUi.css'
import './shooting-explanation.css'

const notesBasis = (value: ShootingPreparation) => JSON.stringify((value.notes || []).map(note => ({ id: note.id, text: note.text, excerpt: note.excerpt || '', scope: note.scope || null, previous_scope_text: note.previous_scope_text || '', choice: note.choice || 'adopt', source: note.source || 'user' })))
const choices = [{ value: 'adopt', label: '采用为参考' }, { value: 'delegate', label: '交由生成设计' }, { value: 'skip', label: '暂不处理' }, { value: 'review', label: '待复核' }]
const labelDrawer = (node: HTMLDivElement | null) => node?.closest('[role="dialog"]')?.setAttribute('aria-label', '本章拍摄解释')

type Props = {
  projectId: string; chapterId: string; sourceVersion: string; sourceText: string
  isLatest: boolean; readOnly: boolean; onClose: () => void
}

/** Read the selected basis before allowing edits. */
export function ShootingExplanationDrawer(props: Props) {
  const { projectId, chapterId, sourceVersion, onClose } = props
  const [value, setValue] = useState<ShootingExplanationRead>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    void StudioDirectingService.directingShootingExplanations({ projectId, chapterId, sourceVersion }).then(response => {
      if (!response.data) throw new Error('拍摄解释读取失败')
      if (live) setValue(response.data)
    }).catch(cause => { if (live) setError(directingError(cause)) })
    return () => { live = false }
  }, [projectId, chapterId, sourceVersion, attempt])
  if (value) return <ShootingExplanationEditor {...props} value={value} />
  return <Drawer className="app-detail-drawer shooting-explanation-drawer" width="min(840px, 100vw)" title="本章拍摄解释" aria-label="本章拍摄解释" zIndex={1900} open onClose={onClose}>
    <div ref={labelDrawer}>{error ? <Alert showIcon type="error" message={error} action={<Button onClick={() => { setError(''); setAttempt(current => current + 1) }}>重试</Button>} /> : <div className="shooting-explanation-loading" role="status" aria-label="读取拍摄解释"><Spin /></div>}</div>
  </Drawer>
}

function ShootingExplanationEditor({ projectId, chapterId, sourceText, sourceVersion, isLatest, value, readOnly, onClose }: Props & { value: ShootingExplanationRead }) {
  const [baseline, setBaseline] = useState(value)
  const [conflict, setConflict] = useState<ShootingExplanationRead>()
  const [preparation, setPreparation] = useState(value.preparation)
  const [selection, setSelection] = useState<SourceSpan>()
  const [position, setPosition] = useState<number>()
  const [focused, setFocused] = useState<SourceSpan>()
  const [editing, setEditing] = useState<{ id?: string; scope?: SourceSpan | null; preview?: SourceSpan; text: string }>()
  const [review, setReview] = useState(false)
  const [handled, setHandled] = useState<Record<string, string[]>>({})
  const autoReview = useRef<string>()
  const intervened = useRef(false)
  const explanationList = useRef<HTMLElement>(null)
  const sourcePanel = useRef<HTMLElement>(null)
  const editorCard = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [check, setCheck] = useState<ShootingCheckRead>()
  const [busy, setBusy] = useState(false)
  const frozenSave = useRef<{ request_id: string; preparation: ShootingPreparation }>()
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [discoveredId, setDiscoveredId] = useState<string>()
  const submittedHere = useRef(false)
  const checkId = discoveredId || preparation.check_task_id
  useEffect(() => {
    if (readOnly) return
    let live = true
    void StudioDirectingService.directingShootingCheckLatest({ projectId, chapterId, sourceVersion }).then(response => {
      if (live && !submittedHere.current && response.data) { setDiscoveredId(response.data.task_id); setCheck(response.data) }
    }).catch(cause => { if (live && !submittedHere.current) setError(directingError(cause)) })
    return () => { live = false }
  }, [projectId, chapterId, sourceVersion, preparation.check_task_id, readOnly])
  const active = check?.status === 'queued' || check?.status === 'running'
  useEffect(() => {
    if (!checkId) { setCheck(undefined); return }
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      try {
        const response = await StudioDirectingService.directingShootingCheckRead({ projectId, chapterId, taskId: checkId })
        if (!live) return
        if (!response.data) throw new Error('检查状态读取失败')
        setCheck(response.data); setError('')
        if (['queued', 'running'].includes(response.data.status)) timer = setTimeout(() => void read(), 1200)
      } catch (cause) { if (live) { setError(directingError(cause)); timer = setTimeout(() => void read(), 3000) } }
    }
    void read()
    return () => { live = false; clearTimeout(timer) }
  }, [projectId, chapterId, checkId])
  useEffect(() => {
    if (!check?.report || autoReview.current !== check.task_id) return
    autoReview.current = undefined
    if (!intervened.current && !editing && !busy && !uncertain && !conflict && check.report.issues?.some(issue => issue.proposed_change)) setReview(true)
  }, [check, editing, busy, uncertain, conflict])
  const dirty = !!editing || JSON.stringify(preparation) !== JSON.stringify(baseline.preparation)
  const close = () => {
    if (uncertain) return
    if (!readOnly && dirty) Modal.confirm({ zIndex: 2000, title: '放弃未保存的拍摄解释？', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose })
    else onClose()
  }
  const start = async () => {
    intervened.current = false
    setBusy(true); setError('')
    try {
      const response = await StudioDirectingService.directingShootingCheckSubmit({ projectId, chapterId, requestBody: {
        request_id: crypto.randomUUID(), source_version: sourceVersion, preparation } })
      if (!response.data) throw new Error('未收到检查任务')
      submittedHere.current = true
      setDiscoveredId(response.data.task_id)
      autoReview.current = response.data.task_id
      setCheck(response.data)
    } catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  const save = async () => {
    if (conflict || editing || review) return false
    intervened.current = true
    if ((preparation.notes || []).some(note => !note.text.trim())) { setError('请填写说明内容，或删除空条目'); return false }
    setBusy(true); setError('')
    try {
      if (!frozenSave.current) frozenSave.current = { request_id: crypto.randomUUID(), preparation: { ...preparation, check_task_id: checkId || preparation.check_task_id } }
      const response = await StudioDirectingService.directingShootingExplanationsSave({ projectId, chapterId, requestBody: {
        ...frozenSave.current, source_version: sourceVersion, expected_version: baseline.version } })
      if (!response.data) throw new Error('未收到保存结果')
      frozenSave.current = undefined; setUncertain(false); onClose(); return true
    } catch (cause) {
      const unknown = !(cause instanceof ApiError && cause.status >= 400 && cause.status < 500)
      if (!unknown) frozenSave.current = undefined
      setUncertain(unknown)
      setError(directingError(cause))
      if (cause instanceof ApiError && cause.status === 409) {
        try {
          const response = await StudioDirectingService.directingShootingExplanations({ projectId, chapterId, sourceVersion })
          if (response.data) setConflict(response.data)
        } catch (readError) { setError(directingError(readError)) }
      }
      return false
    } finally { setBusy(false) }
  }
  useWorkspaceDraft({ name: '本章拍摄解释', dirty: !readOnly && dirty, busy: busy || uncertain || review, save, discard: onClose })
  const editingLocked = readOnly || busy || uncertain
  const notes = preparation.notes || []
  const setNote = (index: number, update: Partial<ShootingNote>) =>
    setPreparation(current => ({ ...current, notes: (current.notes || []).map((note, position) => position === index ? { ...note, ...update } : note) }))
  const showExplanation = (offset: number) => {
    setPosition(offset); setFocused(undefined)
    if (window.matchMedia('(max-width: 767px)').matches) {
      explanationList.current?.scrollIntoView({ block: 'start' })
      explanationList.current?.focus({ preventScroll: true })
    }
  }
  const revealScope = (scope: SourceSpan) => {
    setFocused(scope)
    requestAnimationFrame(() => sourcePanel.current?.querySelector(`[data-source-position="${scope.start}"]`)?.scrollIntoView({ block: 'nearest' }))
  }
  const scopeConflicts = (scope: SourceSpan, id?: string) => {
    if (sameSpan(notes.find(note => note.id === id)?.scope, scope)) return []
    return intersectingScopes(notes.filter(note => note.id !== id), scope)
  }
  const proposeScope = (scope: SourceSpan, entry = editing) => {
    if (!entry) return
    const conflicts = scopeConflicts(scope, entry.id)
    setEditing({ ...entry, preview: scope, scope: conflicts.length ? undefined : scope })
    if (window.matchMedia('(max-width: 767px)').matches) {
      requestAnimationFrame(() => editorCard.current?.scrollIntoView({ block: 'start' }))
    }
  }
  const begin = (scope?: SourceSpan, id?: string) => {
    const entry = { id, text: '' }
    setFocused(undefined)
    if (scope) proposeScope(scope, entry)
    else setEditing(entry)
  }
  const confirmEdit = () => {
    if (!editing || editing.scope === undefined || (!editing.id && !editing.text.trim())) return
    const scope = editing.scope
    if (editing.id) {
      setPreparation(current => ({ ...current, notes: notes.map(note => note.id === editing.id ? { ...note, scope, previous_scope_text: '' } : note) }))
    } else {
      setPreparation(current => ({ ...current, notes: [...notes, { id: crypto.randomUUID(), text: editing.text.trim(), scope, choice: 'adopt', source: 'user' }] }))
    }
    setPosition(scope?.start); setFocused(scope || undefined); setEditing(undefined); setSelection(undefined)
    window.getSelection()?.removeAllRanges()
  }
  const conflicts = editing?.preview && editing.scope === undefined
    ? scopeConflicts(editing.preview, editing.id) : []
  const scopes = explanationScopes(notes)
  const legacyScopes = scopes.filter(scope => scopes.some(other =>
    !sameSpan(scope, other) && scope.start < other.end && other.start < scope.end))
  const visibleNotes = position === undefined ? notes : notes.filter(note => note.scope && note.scope.start <= position && position < note.scope.end)
  const covered = check?.basis_current !== false && (readOnly ? preparation.check_covered !== false : true)
    && check?.source_text === sourceText && !!check && notesBasis(check.preparation) === notesBasis(preparation)
  const issueCount = check?.report?.issues?.length || 0
  const noteCard = (note: ShootingNote) => {
    const index = notes.findIndex(item => item.id === note.id)
    return <div key={note.id} className="shooting-card">
      <Input.TextArea aria-label="说明内容" value={note.text} readOnly={readOnly} disabled={!readOnly && editingLocked} autoSize={{ minRows: 2, maxRows: 8 }}
        onChange={event => setNote(index, { text: event.target.value })} />
      <div className="shooting-meta">
        {note.scope ? <Button type="link" className="shooting-scope-link" onClick={() => revealScope(note.scope!)}>适用范围：{sourceSlice(sourceText, note.scope)}</Button>
          : <p>{note.previous_scope_text ? `原选段待重新定位：${note.previous_scope_text}` : '适用范围：全章'}</p>}
        {note.excerpt && <p>引用依据：{note.excerpt}</p>}
      </div>
      <Space wrap>
        {!readOnly && <Button disabled={editingLocked || !!editing} onClick={() => begin(undefined, note.id)}>{note.previous_scope_text ? '重新选段' : '调整范围'}</Button>}
        {!readOnly && selection && !editing && <Button disabled={editingLocked} onClick={() => setNote(index, { excerpt: sourceSlice(sourceText, selection) })}>用选区设依据</Button>}
        {!readOnly && note.excerpt && <Button disabled={editingLocked} onClick={() => setNote(index, { excerpt: '' })}>移除引用</Button>}
        <Select aria-label="说明采用方式" value={note.choice || 'adopt'} options={choices} disabled={editingLocked} onChange={choice => setNote(index, { choice })} />
        {!readOnly && <Button type="text" danger disabled={editingLocked || !!editing} onClick={() => setPreparation(current => ({ ...current, notes: notes.filter(item => item.id !== note.id) }))}>删除说明</Button>}
      </Space>
    </div>
  }
  return <>
    <Drawer className="app-detail-drawer shooting-explanation-drawer" width="min(840px, 100vw)"
      title="本章拍摄解释" aria-label="本章拍摄解释" open zIndex={1900} onClose={close} closable={!busy && !uncertain}
      keyboard={!busy && !uncertain && !review} maskClosable={false}
      footer={<WorkbenchDialogActions secondary={<Button aria-label={readOnly ? '关闭' : '取消'} disabled={busy || uncertain} onClick={close}>{readOnly ? '关闭' : '取消'}</Button>}>
        {!readOnly && <Button aria-label="保存" type="primary" loading={busy} disabled={!!conflict || !!editing} onClick={() => void save()}>保存</Button>}
      </WorkbenchDialogActions>}>
      <div className="shooting-drawer-body" ref={labelDrawer} onPointerDownCapture={() => { intervened.current = true }}
        onKeyDownCapture={() => { intervened.current = true }} onInputCapture={() => { intervened.current = true }}>
        <section className="shooting-drawer-section" ref={sourcePanel} aria-label="章节原文">
          <div className="shooting-heading">
            <div><h3>章节原文</h3><p className="shooting-meta">{isLatest ? '当前使用最新原文' : '当前使用历史版本原文'}</p></div>
            {!readOnly && <Space wrap>
              <Button loading={active} disabled={editingLocked || active || !!editing || !sourceText.trim() || notes.some(note => !note.text.trim())} onClick={() => void start()}>AI 分析全文</Button>
              <Button icon={<PlusOutlined aria-hidden />} disabled={editingLocked || !!editing} onClick={() => begin(selection)}>选段添加解释</Button>
            </Space>}
          </div>
          {editing && <p role="status" className="shooting-meta">请选择连续原文，或在下方设为全章。</p>}
          <div className="shooting-section-scroll">
            <ShootingExplanationSource text={sourceText} notes={notes} focused={focused} selection={editing?.preview || selection}
              returnFocus={returnFocus} onSelect={scope => { setSelection(scope); if (editing) proposeScope(scope) }}
              onMark={offset => { if (!editing) { setSelection(undefined); showExplanation(offset) } }} />
          </div>
        </section>
        <section className="shooting-drawer-section" ref={explanationList} tabIndex={-1} aria-label="拍摄解释">
          <div className="shooting-heading">
            <h3>{position === undefined ? '拍摄解释' : '此处的解释'}</h3>
            <Space wrap>
              {position !== undefined && <><Button onClick={() => { setPosition(undefined); setFocused(undefined) }}>全部解释</Button>
                <Button className="shooting-return-source" onClick={() => {
                  const target = returnFocus.current?.isConnected ? returnFocus.current : sourcePanel.current?.querySelector<HTMLElement>('[data-source-position]')
                  target?.scrollIntoView({ block: 'nearest' }); target?.focus({ preventScroll: true })
                }}>返回原文</Button></>}
              {issueCount > 0 && <Button disabled={editingLocked} onClick={() => setReview(true)}>查看分析结果（{issueCount}）</Button>}
            </Space>
          </div>
          <div className="shooting-section-scroll shooting-stack">
            {uncertain && <Alert type="warning" showIcon message="保存结果尚未确认，请再次点击保存以核对同一提交。" />}
            {error && <Alert type="error" showIcon message={error} />}
            {check?.error && <Alert type="warning" showIcon message={`分析失败：${check.error}`} />}
            {check?.report && <p className="shooting-meta" role="status">{issueCount ? covered ? '报告对应当前内容' : '当前解释已变动，请对照分析结果核对' : '本次分析没有发现需要确认的内容。'}</p>}
            {conflict && <Alert type="warning" showIcon message="核对其他编辑保存的内容" description={<div className="shooting-stack">
              {(conflict.preparation.notes || []).map(note => <p key={note.id}>{note.text}</p>)}
              <Space wrap><Button onClick={() => {
                setBaseline(conflict); setPreparation(conflict.preparation); setConflict(undefined); setError(''); setPosition(undefined)
              }}>载入最新内容</Button><Button onClick={() => {
                setBaseline(conflict); setConflict(undefined); setError('')
              }}>保留我的内容，继续编辑</Button></Space>
            </div>} />}
            {editing && <div className="shooting-card" ref={editorCard}>
              <strong>{editing.id ? '调整解释范围' : '添加拍摄解释'}</strong>
              <p>{editing.scope === null ? '适用范围：全章' : editing.preview ? sourceSlice(sourceText, editing.preview) : '尚未选择原文'}</p>
              {conflicts.length > 0 && <Alert type="warning" showIcon message="所选文字与已有选段相交" description={<Space wrap>
                {conflicts.map(scope => <Button key={scope.start + ':' + scope.end} className="shooting-range-option"
                  onClick={() => setEditing({ ...editing, scope, preview: scope })}>使用已有选段 · {sourceSlice(sourceText, { start: scope.start, end: Math.min(scope.end, scope.start + 32) })}{scope.end - scope.start > 32 ? '…' : ''}</Button>)}
                <Button onClick={() => { setEditing({ ...editing, scope: undefined, preview: undefined }); setSelection(undefined); window.getSelection()?.removeAllRanges() }}>重新选择</Button>
              </Space>} />}
              {!editing.id && <Input.TextArea aria-label="新增解释内容" placeholder="补充人物路线、具体动作或空间关系" autoSize={{ minRows: 2, maxRows: 6 }}
                value={editing.text} onChange={event => setEditing({ ...editing, text: event.target.value })} />}
              <Space wrap><Button onClick={() => setEditing({ ...editing, scope: null, preview: undefined })}>适用全章</Button>
                <Button className="shooting-return-source" onClick={() => {
                  const offset = editing.preview?.start ?? 0
                  sourcePanel.current?.querySelector(`[data-source-position="${offset}"]`)?.scrollIntoView({ block: 'center' })
                }}>返回原文</Button>
                <Button onClick={() => { setEditing(undefined); setSelection(undefined); window.getSelection()?.removeAllRanges() }}>取消本次选择</Button>
                <Button disabled={editing.scope === undefined || (!editing.id && !editing.text.trim())} onClick={confirmEdit}>确认解释</Button></Space>
            </div>}
            {position !== undefined && !readOnly && !editing && visibleNotes.length > 0 && <Button
              disabled={editingLocked} onClick={() => begin(visibleNotes[0].scope || undefined)}>在此添加解释</Button>}
            {visibleNotes.length ? <>
              {visibleNotes.filter(note => !note.scope || !legacyScopes.some(scope => sameSpan(scope, note.scope))).map(noteCard)}
              {visibleNotes.some(note => legacyScopes.some(scope => sameSpan(scope, note.scope))) && <div className="shooting-stack">
                <strong>需整理的选段</strong>
                {visibleNotes.filter(note => legacyScopes.some(scope => sameSpan(scope, note.scope))).map(noteCard)}
              </div>}
            </> : <p className="shooting-meta">暂无拍摄解释。</p>}
          </div>
        </section>
      </div>
    </Drawer>
    {review && check?.report && <ShootingExplanationReview key={check.task_id} check={check} notes={notes}
      readOnly={readOnly || check.source_text !== sourceText || busy || uncertain} handled={handled[check.task_id] || []}
      onClose={() => setReview(false)} onApply={(updated, issueIds, keepOpen) => {
        setPreparation(current => ({ ...current, notes: updated, check_task_id: check.task_id }))
        setHandled(current => ({ ...current, [check.task_id]: [...(current[check.task_id] || []), ...issueIds] }))
        setPosition(undefined); setReview(keepOpen)
      }} />}
  </>
}
