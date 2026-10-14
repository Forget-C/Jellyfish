import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button, Popover } from 'antd'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { SceneDeliveryCreate, SceneDeliveryRead, SceneVersionRead } from '../../../services/generated'
import { directingError } from './common'

/** 保存成功后交付固定修订；未知提交保留原请求，后续编辑不进入原授权。 */
export function SceneDeliveryPanel({ feedbackHost, projectId, chapterId, sequenceId, versionId, disabled, hasItems, onSave, onBusy }: {
  feedbackHost?: HTMLElement | null
  projectId: string; chapterId: string; sequenceId: string; versionId: string; disabled: boolean; hasItems: boolean
  onSave: () => Promise<SceneVersionRead | undefined>; onBusy: (busy: boolean) => void
}) {
  const key = `scene-delivery:${projectId}:${sequenceId}:${versionId}`
  const readPending = (): SceneDeliveryCreate | undefined => {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const value = JSON.parse(raw) as SceneDeliveryCreate
    if (!value || typeof value.request_id !== 'string' || !value.request_id || !Number.isInteger(value.expected_revision) || value.expected_revision < 1) throw new Error('交付凭据无法解析')
    return value
  }
  const [initial] = useState(() => { try { return { request: readPending(), error: '' } } catch { return { request: undefined, error: '本地交付凭据无法读取，请恢复后重读。' } } })
  const [pending, setPending] = useState(initial.request)
  const [storageError, setStorageError] = useState(initial.error)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [current, setCurrent] = useState<SceneDeliveryRead | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    setLoading(true); setReadError('')
    void StudioDirectingService.directingChapterDeliveries({ projectId, chapterId }).then(result => {
      if (!result.data) throw new Error('章节使用内容尚未核实')
      if (active) setCurrent(result.data.sequences.find(row => row.sequence_id === sequenceId)?.delivery || null)
    }).catch(cause => { if (active) setReadError(directingError(cause)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, chapterId, sequenceId, attempt])
  const clear = (request: SceneDeliveryCreate) => {
    if (readPending()?.request_id === request.request_id) localStorage.removeItem(key)
    if (mounted.current) setPending(undefined)
  }
  const submit = async () => {
    if (busy || disabled || storageError) return
    setBusy(true); onBusy(true); setError('')
    let request = pending
    try {
      if (!request) {
        const saved = await onSave()
        if (!saved || saved.id !== versionId) throw new Error('保存尚未成功，章节使用内容未更新；请核实保存结果后重试。')
        request = { request_id: crypto.randomUUID(), expected_revision: saved.revision }
        try { localStorage.setItem(key, JSON.stringify(request)) }
        catch { if (mounted.current) setStorageError('内容已保存，但交付凭据写入失败，本次未交付。'); return }
        if (mounted.current) setPending(request)
      }
      const result = await StudioDirectingService.directingCreateSceneDelivery({ projectId, sequenceId, versionId, requestBody: request })
      if (!result.data) throw new Error('交付结果尚未核实，请核实原请求')
      clear(request)
      if (mounted.current) setAttempt(value => value + 1)
    } catch (cause) {
      if (cause instanceof ApiError && [400, 409, 422].includes(cause.status) && request) {
        try { clear(request) } catch { if (mounted.current) setStorageError('交付凭据尚未清理，请恢复存储后重读。') }
      }
      if (mounted.current) setError(directingError(cause))
    } finally { if (mounted.current) setBusy(false); onBusy(false) }
  }
  const retryStorage = () => {
    try { setPending(readPending()); setStorageError('') } catch { setStorageError('本地交付凭据仍无法读取，请恢复后重读。') }
  }
  const submitAction = <Button loading={busy} disabled={disabled || !!storageError || loading || !!readError || (!pending && !hasItems)} onClick={() => void submit()}>
    {pending ? '核实原交付请求' : current ? '更新到章节' : '用于章节'}
  </Button>
  return <span>
    {feedbackHost && (pending || storageError || error) && createPortal(<Alert type="warning" message={pending ? '章节交付待核实' : storageError || error}
      action={storageError ? <Button onClick={retryStorage}>重读交付凭据</Button> : submitAction} />, feedbackHost)}
    {submitAction}
    {!loading && !readError && current && <Popover trigger="click" content={<div style={{ maxWidth: 420 }}><p>来源版本：{current.version_title}</p><p>更新时间：{new Date(current.created_at).toLocaleString()}</p><p>交付画幅：{current.content.output_aspect_ratio}</p><p>普通编辑不会更新章节使用内容。交付不代表验收通过或成片导出。</p></div>}><Button type="text">章节当前使用：{current.version_title}</Button></Popover>}
    {readError && <Alert type="warning" message="章节使用读取失败" description={readError} action={<Button onClick={() => setAttempt(value => value + 1)}>重读章节使用</Button>} />}
    {error && <Alert type="warning" message={error} />}
    {storageError && <Alert type="warning" message={storageError} action={<Button onClick={retryStorage}>重读交付凭据</Button>} />}
  </span>
}
