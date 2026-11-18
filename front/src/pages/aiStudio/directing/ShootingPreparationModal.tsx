import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { Alert, Button, Input, Modal, Select, Space, Spin, Tag } from 'antd'
import { ApiError, StudioDirectingService, type ShootingCheckRead, type ShootingExplanationRead, type ShootingIssue, type ShootingNote, type ShootingPreparation_Input as ShootingPreparation } from '../../../services/generated'
import { useWorkspaceDraft } from './WorkspaceDrafts'
import { directingError, excerptMatches } from './common'
import { sourceSlice, textareaSpan } from './sourceSelection'

const notesBasis = (value: ShootingPreparation) => JSON.stringify((value.notes || []).map(note => ({ id: note.id, text: note.text, excerpt: note.excerpt || '', scope: note.scope || null, previous_scope_text: note.previous_scope_text || '', choice: note.choice || 'adopt', source: note.source || 'user' })))
const categories = { position: '站位', path: '行进路线', visibility: '视线与遮挡', continuity: '状态连续性', source: '原文理解' }
const choices = [{ value: 'adopt', label: '采用为参考' }, { value: 'delegate', label: '交由生成设计' }, { value: 'skip', label: '暂不处理' }, { value: 'review', label: '待复核' }]

type Props = {
  projectId: string; chapterId: string; sourceVersion: string; sourceText: string
  isLatest: boolean; readOnly: boolean; onClose: () => void
}

/** Read the selected basis before allowing edits. */
export function ShootingPreparationModal(props: Props) {
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
  return <Modal className="management-scene-dialog" title="本章拍摄解释" zIndex={1900} open onCancel={onClose} footer={null}>
    {error ? <Alert type="error" message={error} action={<Button onClick={() => { setError(''); setAttempt(current => current + 1) }}>重试</Button>} /> : <Spin />}
  </Modal>
}

function ShootingExplanationEditor({ projectId, chapterId, sourceText, sourceVersion, isLatest, value, readOnly, onClose }: Props & { value: ShootingExplanationRead }) {
  const [baseline, setBaseline] = useState(value)
  const [conflict, setConflict] = useState<ShootingExplanationRead>()
  const [preparation, setPreparation] = useState(value.preparation)
  const [selection, setSelection] = useState<ShootingNote['scope']>()
  const [check, setCheck] = useState<ShootingCheckRead>()
  const [busy, setBusy] = useState(false)
  const frozenSave = useRef<{ request_id: string; preparation: ShootingPreparation }>()
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [discoveredId, setDiscoveredId] = useState<string>()
  const checkId = discoveredId || preparation.check_task_id
  useEffect(() => {
    if (readOnly) return
    let live = true
    void StudioDirectingService.directingShootingCheckLatest({ projectId, chapterId, sourceVersion }).then(response => {
      if (live && response.data) { setDiscoveredId(response.data.task_id); setCheck(response.data) }
    }).catch(cause => { if (live) setError(directingError(cause)) })
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
  const dirty = JSON.stringify(preparation) !== JSON.stringify(baseline.preparation)
  const close = () => {
    if (uncertain) return
    if (!readOnly && dirty) Modal.confirm({ zIndex: 2000, title: '放弃未保存的拍摄解释？', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose })
    else onClose()
  }
  const start = async () => {
    setBusy(true); setError('')
    try {
      const response = await StudioDirectingService.directingShootingCheckSubmit({ projectId, chapterId, requestBody: {
        request_id: crypto.randomUUID(), source_version: sourceVersion, preparation } })
      if (!response.data) throw new Error('未收到检查任务')
      setDiscoveredId(response.data.task_id)
      setCheck(response.data); setPreparation(current => ({ ...current, check_task_id: response.data!.task_id }))
    } catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  const save = async () => {
    if (conflict) return false
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
  useWorkspaceDraft({ name: '本章拍摄解释', dirty: !readOnly && dirty, busy: busy || uncertain, save, discard: onClose })
  const editingLocked = readOnly || busy || uncertain
  const notes = preparation.notes || []
  const setNote = (index: number, update: Partial<ShootingNote>) =>
    setPreparation(current => ({ ...current, notes: (current.notes || []).map((note, position) => position === index ? { ...note, ...update } : note) }))
  const captureSelection = (event: SyntheticEvent<HTMLTextAreaElement>) =>
    setSelection(textareaSpan(sourceText, event.currentTarget.selectionStart, event.currentTarget.selectionEnd))
  const addIssue = (issue: ShootingIssue, delegate: boolean) => {
    const matches = issue.excerpt ? excerptMatches(sourceText, issue.excerpt) : []
    const related = notes.find(note => note.id === issue.note_id)
    const scope = matches.length === 1 ? matches[0] : !issue.excerpt ? related?.scope : undefined
    const previousScope = scope ? '' : issue.excerpt || related?.previous_scope_text || ''
    const note: ShootingNote = { id: crypto.randomUUID(), text: delegate ? issue.problem : issue.suggestion || issue.problem,
      excerpt: issue.excerpt || related?.excerpt, scope, previous_scope_text: previousScope,
      source: 'check', choice: previousScope ? 'review' : delegate ? 'delegate' : 'adopt' }
    setPreparation(current => ({ ...current, notes: [...(current.notes || []), note] }))
  }
  const covered = (readOnly ? preparation.check_covered !== false : check?.basis_current !== false) && check?.source_text === sourceText && !!check && notesBasis(check.preparation) === notesBasis(preparation)
  return <Modal className="management-scene-dialog" width={960} styles={{ body: { maxHeight: 'calc(100dvh - 240px)', overflowY: 'auto' } }} title="本章拍摄解释" zIndex={1900} open onCancel={close} closable={!busy && !uncertain} maskClosable={!busy && !uncertain} keyboard={!busy && !uncertain}
    footer={<Space><Button aria-label={readOnly ? '关闭' : '取消'} disabled={busy || uncertain} onClick={close}>{readOnly ? '关闭' : '取消'}</Button>
      {!readOnly && <Button aria-label="保存" type="primary" loading={busy} disabled={!!conflict} onClick={() => void save()}>保存</Button>}</Space>}>
    <p>{isLatest ? '当前使用最新原文' : '当前使用历史版本原文'}</p>
    <details><summary>原文与范围选择</summary>
      <Input.TextArea aria-label="章节原文选区" readOnly value={sourceText} autoSize={{ minRows: 4, maxRows: 10 }}
        onSelect={captureSelection} onMouseUp={captureSelection} onKeyUp={captureSelection} />
      <span>{selection ? `已选：${sourceSlice(sourceText, selection)}` : '选中文字后，可把选区设为某条解释的适用范围或引用依据。'}</span>
    </details>
    {!notes.length && <p>暂无拍摄解释。</p>}
    {notes.map((note, index) => <div key={note.id} style={{ marginBottom: 16 }}>
      <Input.TextArea aria-label="说明内容" value={note.text} disabled={editingLocked} autoSize={{ minRows: 2, maxRows: 8 }}
        onChange={event => setPreparation(current => ({ ...current, notes: notes.map((row, i) => i === index ? { ...row, text: event.target.value } : row) }))} />
      <p>{note.scope ? `适用范围：${sourceSlice(sourceText, note.scope)}` : note.previous_scope_text ? `原适用范围待重新定位：${note.previous_scope_text}` : '适用范围：全章'}</p>
      {note.excerpt && <p>引用依据：{note.excerpt}</p>}
      {!readOnly && <Space wrap>
        <Button disabled={!selection || editingLocked} onClick={() => setNote(index, { scope: selection, previous_scope_text: '' })}>用选区设范围</Button>
        {(note.scope || note.previous_scope_text) && <Button disabled={editingLocked} onClick={() => setNote(index, { scope: null, previous_scope_text: '' })}>设为全章</Button>}
        <Button disabled={!selection || editingLocked} onClick={() => selection && setNote(index, { excerpt: sourceSlice(sourceText, selection) })}>用选区设依据</Button>
        {note.excerpt && <Button disabled={editingLocked} onClick={() => setNote(index, { excerpt: '' })}>移除引用</Button>}
      </Space>}
      <Space><Select aria-label="说明采用方式" value={note.choice || 'adopt'} options={choices} disabled={editingLocked} style={{ minWidth: 150 }}
        onChange={choice => setPreparation(current => ({ ...current, notes: notes.map((row, i) => i === index ? { ...row, choice } : row) }))} />
        {!readOnly && <Button disabled={editingLocked} onClick={() => setPreparation(current => ({ ...current, notes: notes.filter((_, i) => i !== index) }))}>删除说明</Button>}</Space>
    </div>)}
    {!readOnly && <Button disabled={editingLocked} onClick={() => setPreparation(current => ({ ...current, notes: [...notes, { id: crypto.randomUUID(), text: '', choice: 'adopt', source: 'user', excerpt: '' }] }))}>新增说明</Button>}
    <h3>生成前拍摄检查</h3>
    {!readOnly && <Button loading={busy} disabled={uncertain || active || !sourceText.trim() || notes.some(note => !note.text.trim())} onClick={() => void start()}>{active ? '检查中…' : check?.status === 'failed' ? '重试检查' : '开始检查'}</Button>}
    {!sourceText.trim() && <p>请先填写章节原文。</p>}
    {uncertain && <Alert type="warning" message="保存结果尚未确认，请再次点击保存以核对同一提交。" />}
    {error && <Alert type="error" message={error} />}
    {conflict && <Alert type="warning" message="核对其他编辑保存的内容" description={<>
      {(conflict.preparation.notes || []).map(note => <p key={note.id}>{note.text}</p>)}
      <Space wrap><Button onClick={() => {
        setBaseline(conflict); setPreparation(conflict.preparation); setConflict(undefined); setError('')
      }}>载入最新内容</Button><Button onClick={() => {
        setBaseline(conflict); setConflict(undefined); setError('')
      }}>保留我的内容，继续编辑</Button></Space>
    </>} />}
    {check?.error && <Alert type="warning" message={`检查失败：${check.error}`} />}
    {check?.report && <><p>{covered ? '报告对应当前内容' : '当前内容尚未完整检查，以下为先前内容的报告'}</p>
      {!check.report.issues?.length && <p>本次未发现需要提示的问题。</p>}
      {check.report.issues?.map(issue => <div key={issue.id} style={{ marginBottom: 16 }}>
        <Tag>{categories[issue.category]}</Tag><Tag>{({ conflict: '明确冲突', insufficient_basis: '关键待明确', optional: '可选建议' })[issue.kind]}</Tag>
        <p>{issue.problem}</p>{issue.note_id && <small>对应说明：{notes.find(note => note.id === issue.note_id)?.text || '该说明已调整或移除'}</small>}{issue.excerpt && <blockquote>{issue.excerpt}</blockquote>}{issue.suggestion && <p>{issue.suggestion}</p>}
        {!readOnly && issue.category !== 'source' && <Space>
          {issue.suggestion && <Button disabled={editingLocked || check.source_text !== sourceText} onClick={() => addIssue(issue, false)}>加入拍摄解释</Button>}
          <Button disabled={editingLocked || check.source_text !== sourceText} onClick={() => addIssue(issue, true)}>交由分镜设计</Button>
        </Space>}
      </div>)}</>}
    {!check && !checkId && <p>尚未检查；可以直接维护说明并保存。</p>}
  </Modal>
}
