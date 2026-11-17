import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Space, Tag } from 'antd'
import { ApiError, StudioDirectingService, type ShootingCheckRead, type ShootingPreparation } from '../../../services/generated'
import { useWorkspaceDraft } from './WorkspaceDrafts'
import { directingError } from './common'

const notesBasis = (value: ShootingPreparation) => JSON.stringify((value.notes || []).map(note => ({ id: note.id, text: note.text, excerpt: note.excerpt || '', choice: note.choice || 'adopt', source: note.source || 'user' })))
const empty = (): ShootingPreparation => ({ notes: [], check_task_id: null })
const categories = { position: '站位', path: '行进路线', visibility: '视线与遮挡', continuity: '状态连续性', source: '原文理解' }
const choices = [{ value: 'adopt', label: '采用为参考' }, { value: 'delegate', label: '交由生成设计' }, { value: 'skip', label: '暂不处理' }, { value: 'review', label: '待复核' }]

/** 编辑局部说明，保存路径由场次宿主决定；检查只产生报告。 */
export function ShootingPreparationModal({ projectId, chapterId, sceneKey, title, sourceText, sourceVersion, sourceStart, value, readOnly, draft, onSave, onClose }: {
  projectId: string; chapterId: string; sceneKey: string; title: string; sourceText: string
  sourceVersion?: string; sourceStart?: number
  value?: ShootingPreparation; readOnly: boolean; draft: boolean
  onSave: (value: ShootingPreparation) => Promise<void>; onClose: () => void
}) {
  const [preparation, setPreparation] = useState<ShootingPreparation>(() => structuredClone(value || empty()))
  const [check, setCheck] = useState<ShootingCheckRead>()
  const [busy, setBusy] = useState(false)
  const frozenSave = useRef<ShootingPreparation>()
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [discoveredId, setDiscoveredId] = useState<string>()
  const checkId = preparation.check_task_id || discoveredId
  useEffect(() => {
    if (preparation.check_task_id || readOnly) return
    let live = true
    void StudioDirectingService.directingShootingCheckLatest({ projectId, chapterId, draftKey: sceneKey }).then(response => {
      if (live && response.data) { setDiscoveredId(response.data.task_id); setCheck(response.data) }
    }).catch(cause => { if (live) setError(directingError(cause)) })
    return () => { live = false }
  }, [projectId, chapterId, sceneKey, preparation.check_task_id, readOnly])
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
  const dirty = JSON.stringify(preparation) !== JSON.stringify(value || empty())
  const close = () => {
    if (uncertain) return
    if (!readOnly && dirty) Modal.confirm({ zIndex: 2000, title: '放弃未保存的拍摄说明？', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose })
    else onClose()
  }
  const start = async () => {
    setBusy(true); setError('')
    try {
      const response = await StudioDirectingService.directingShootingCheckSubmit({ projectId, chapterId, requestBody: {
        request_id: crypto.randomUUID(), draft_key: sceneKey, source_text: sourceText, source_version: sourceVersion, source_start: sourceStart, preparation } })
      if (!response.data) throw new Error('未收到检查任务')
      setCheck(response.data); setPreparation(current => ({ ...current, check_task_id: response.data!.task_id }))
    } catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  const save = async () => {
    if ((preparation.notes || []).some(note => !note.text.trim())) { setError('请填写说明内容，或删除空条目'); return false }
    setBusy(true); setError('')
    try {
      if (!frozenSave.current) frozenSave.current = { ...preparation, check_task_id: checkId || preparation.check_task_id }
      await onSave(frozenSave.current); frozenSave.current = undefined; setUncertain(false); onClose(); return true
    } catch (cause) {
      const unknown = !(cause instanceof ApiError && cause.status >= 400 && cause.status < 500)
      if (!unknown) frozenSave.current = undefined
      setUncertain(unknown)
      setError(directingError(cause)); return false
    } finally { setBusy(false) }
  }
  useWorkspaceDraft({ name: '场次拍摄说明', dirty: !readOnly && dirty, busy: busy || uncertain, save, discard: onClose })
  const editingLocked = readOnly || busy || uncertain
  const notes = preparation.notes || []
  const covered = (readOnly ? preparation.check_covered !== false : check?.basis_current !== false) && check?.source_text === sourceText && !!check && notesBasis(check.preparation) === notesBasis(preparation)
  return <Modal className="management-scene-dialog" width={960} styles={{ body: { maxHeight: 'calc(100dvh - 240px)', overflowY: 'auto' } }} title={`${title} · 拍摄准备`} zIndex={1900} open onCancel={close} closable={!busy && !uncertain} maskClosable={!busy && !uncertain} keyboard={!busy && !uncertain}
    footer={<Space><Button aria-label={readOnly ? '关闭' : '取消'} disabled={busy || uncertain} onClick={close}>{readOnly ? '关闭' : '取消'}</Button>
      {!readOnly && <Button aria-label={draft ? '保存到场次草稿' : '保存'} type="primary" loading={busy} onClick={() => void save()}>{draft ? '保存到场次草稿' : '保存'}</Button>}</Space>}>
    <details><summary>本场采用的原文</summary><p className="chapter-source-excerpt">{sourceText || '尚未确定范围'}</p></details>
    <h3>场次拍摄说明</h3><p>供分镜生成理解场次的参考说明；采用不代表强制逐条执行。</p>
    {!notes.length && <p>暂无说明，可直接生成分镜。</p>}
    {notes.map((note, index) => <div key={note.id} style={{ marginBottom: 16 }}>
      <Input.TextArea aria-label="说明内容" value={note.text} disabled={editingLocked} autoSize={{ minRows: 2, maxRows: 8 }}
        onChange={event => setPreparation(current => ({ ...current, notes: notes.map((row, i) => i === index ? { ...row, text: event.target.value } : row) }))} />
      {note.excerpt && <small>对应原文：{note.excerpt}</small>}
      <Space><Select aria-label="说明采用方式" value={note.choice || 'adopt'} options={choices} disabled={editingLocked} style={{ minWidth: 150 }}
        onChange={choice => setPreparation(current => ({ ...current, notes: notes.map((row, i) => i === index ? { ...row, choice } : row) }))} />
        {!readOnly && <Button disabled={editingLocked} onClick={() => setPreparation(current => ({ ...current, notes: notes.filter((_, i) => i !== index) }))}>删除说明</Button>}</Space>
    </div>)}
    {!readOnly && <Button disabled={editingLocked} onClick={() => setPreparation(current => ({ ...current, notes: [...notes, { id: crypto.randomUUID(), text: '', choice: 'adopt', source: 'user', excerpt: '' }] }))}>新增说明</Button>}
    <h3>生成前拍摄检查</h3>
    {!readOnly && <Button loading={busy} disabled={uncertain || active || !sourceText.trim() || notes.some(note => !note.text.trim())} onClick={() => void start()}>{active ? '检查中…' : check?.status === 'failed' ? '重试检查' : '开始检查'}</Button>}
    {!sourceText.trim() && <p>请先确定场次原文范围再检查。</p>}
    {uncertain && <Alert type="warning" message="保存结果尚未确认，请再次点击保存以核对同一提交。" />}
    {error && <Alert type="error" message={error} />}
    {check?.error && <Alert type="warning" message={`检查失败：${check.error}`} />}
    {check?.report && <><p>{covered ? '报告对应当前内容' : '当前内容尚未完整检查，以下为先前内容的报告'}</p>
      {!check.report.issues?.length && <p>本次未发现需要提示的问题。</p>}
      {check.report.issues?.map(issue => <div key={issue.id} style={{ marginBottom: 16 }}>
        <Tag>{categories[issue.category]}</Tag><Tag>{({ conflict: '明确冲突', insufficient_basis: '关键待明确', optional: '可选建议' })[issue.kind]}</Tag>
        <p>{issue.problem}</p>{issue.note_id && <small>对应说明：{notes.find(note => note.id === issue.note_id)?.text || '该说明已调整或移除'}</small>}{issue.excerpt && <blockquote>{issue.excerpt}</blockquote>}{issue.suggestion && <p>{issue.suggestion}</p>}
        {!readOnly && issue.suggestion && <Button disabled={editingLocked || check.source_text !== sourceText} onClick={() => setPreparation(current => ({ ...current,
          notes: [...notes, { id: crypto.randomUUID(), text: issue.suggestion || '', excerpt: issue.excerpt || '', source: 'check', choice: 'adopt' }] }))}>加入场次拍摄说明</Button>}
      </div>)}</>}
    {!check && !checkId && <p>尚未检查；可以直接维护说明并保存。</p>}
  </Modal>
}
