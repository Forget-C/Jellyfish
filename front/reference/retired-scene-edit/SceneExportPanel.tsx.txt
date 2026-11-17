import { WorkbenchDetails } from './ui/WorkbenchDetails'
import { WorkbenchModal as Modal, WorkbenchDialogActions } from './ui/WorkbenchModal'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button, Popover, Select, Space } from 'antd'
import { ApiError, FilmService, StudioDirectingService } from '../../../services/generated'
import type { SceneExportRead, SceneExportRequest, SceneVersionRead, SceneVersionContent_Output, SceneExportInspection } from '../../../services/generated'
import { resolveAssetUrl } from '../assets/utils'
import { directingError } from './common'

type Intent = { request: SceneExportRequest; retryTaskId?: string }
const terminal = ['succeeded', 'failed', 'cancelled']
const statuses: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }

/** 保存后提交固定修订；跨画布保持挂载，未知结果只能核实原凭据。 */
export function SceneExportPanel({ feedbackHost, triggerHost, projectId, sequenceId, versionId, dirty, disabled, onSave, onBusy, focusTaskId, currentClipIds, onLocate, historical, content, historyOnly = false, onClose }: {
  feedbackHost?: HTMLElement | null; triggerHost?: HTMLElement | null
  historyOnly?: boolean; onClose?: () => void
  content: SceneVersionContent_Output
  historical: boolean
  currentClipIds: string[]; onLocate: (clipId: string) => void
  focusTaskId?: string
  projectId: string; sequenceId: string; versionId: string; dirty: boolean; disabled: boolean
  onSave: () => Promise<SceneVersionRead | undefined>; onBusy: (busy: boolean) => void
}) {
  const key = `scene-export:${projectId}:${sequenceId}:${versionId}`
  const readPending = (): Intent | undefined => {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const value = JSON.parse(raw) as Intent
    if (!value?.request?.request_id || typeof value.request.request_id !== 'string' || !Number.isInteger(value.request.expected_revision) || value.request.expected_revision < 1 ||
      (value.request.size !== undefined && ![720, 1080].includes(value.request.size)) ||
      (value.retryTaskId !== undefined && (typeof value.retryTaskId !== 'string' || !value.retryTaskId))) throw new Error('导出凭据无法解析')
    return value
  }
  const [initial] = useState(() => { try { return { pending: readPending(), error: '' } } catch { return { pending: undefined, error: '本地导出凭据无法读取，请恢复后重读。' } } })
  const [pending, setPending] = useState(initial.pending)
  const [size, setSize] = useState<1080 | 720>(initial.pending?.request.size || 1080)
  const [inspection, setInspection] = useState<{ key: string; data?: SceneExportInspection; error?: string }>()
  const [inspectionAttempt, setInspectionAttempt] = useState(0)
  const inspectionKey = JSON.stringify({ timeline: content.timeline, output_aspect_ratio: content.output_aspect_ratio, size })
  const measured = inspection?.key === inspectionKey ? inspection : undefined
  useEffect(() => {
    if (historyOnly) return
    let active = true
    let request: ReturnType<typeof StudioDirectingService.directingInspectSceneExport> | undefined
    const timer = window.setTimeout(() => {
      request = StudioDirectingService.directingInspectSceneExport({ projectId, sequenceId, versionId, requestBody: JSON.parse(inspectionKey) })
      void request.then(response => {
        if (!response.data) throw new Error('媒体尺寸尚未核实')
        if (active) setInspection({ key: inspectionKey, data: response.data })
      }).catch(cause => { if (active) setInspection({ key: inspectionKey, error: directingError(cause) }) })
    }, 300)
    return () => { active = false; window.clearTimeout(timer); request?.cancel() }
  }, [projectId, sequenceId, versionId, inspectionKey, inspectionAttempt, historyOnly])
  const [storageError, setStorageError] = useState(initial.error)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [rows, setRows] = useState<SceneExportRead[]>()
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [open, setOpen] = useState(!!focusTaskId)
  const [selectedId, setSelectedId] = useState<string | undefined>(focusTaskId)
  const [cancelling, setCancelling] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SceneExportRead>()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  useEffect(() => { if (focusTaskId) { setSelectedId(focusTaskId); setOpen(true) } }, [focusTaskId])
  const mounted = useRef(true)
  const lock = useRef(false)
  const video = useRef<HTMLVideoElement>(null)
  const close = () => {
    if (historyOnly && (busy || pending || storageError)) return
    video.current?.pause(); setOpen(false); onClose?.()
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { onBusy(busy || !!pending || !!storageError); return () => onBusy(false) }, [busy, pending, storageError])
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const response = await StudioDirectingService.directingListSceneExports({ projectId, sequenceId, versionId })
        if (!response.data) throw new Error('导出记录尚未核实')
        if (!active) return
        setRows(response.data); setReadError('')
        if (response.data.some(row => !terminal.includes(row.status))) timer = setTimeout(() => void read(), 2000)
      } catch (cause) { if (active) setReadError(directingError(cause)) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [projectId, sequenceId, versionId, attempt])
  const clear = (intent: Intent) => {
    if (readPending()?.request.request_id === intent.request.request_id) localStorage.removeItem(key)
    if (mounted.current) setPending(undefined)
  }
  const submit = async (retry?: SceneExportRead) => {
    if (lock.current || disabled || storageError || (historical && !pending) || (historyOnly && !pending && !retry)) return
    lock.current = true; setBusy(true); setError('')
    let intent = pending
    try {
      if (!intent) {
        const saved = retry ? undefined : await onSave()
        if (!retry && (!saved || saved.id !== versionId)) throw new Error('保存尚未成功，未提交导出；请核实保存结果后重试。')
        const content = retry?.snapshot.content || saved!.content
        if (!content.timeline.items.length) throw new Error('时间线为空，请先添加真实采用后导出。')
        const planned = content.timeline.items.find(item => item.kind === 'planned')
        if (planned) { onLocate(planned.id); throw new Error(`片段 ${planned.id} 仍为待拍占位，请补齐真实媒体后导出。`) }
        try {
          const checked = await StudioDirectingService.directingInspectSceneExport({ projectId, sequenceId, versionId,
            requestBody: { timeline: content.timeline, output_aspect_ratio: content.output_aspect_ratio, size: retry?.snapshot.profile.size || size } })
          if (!checked.data) throw new Error('导出媒体检查结果尚未核实')
        } catch (cause) { throw new Error(`${retry ? '原记录' : '内容已保存，导出'}检查失败：${directingError(cause)}`) }
        intent = { request: { request_id: crypto.randomUUID(), expected_revision: retry?.snapshot.revision || saved!.revision, size: retry?.snapshot.profile.size || size }, retryTaskId: retry?.task_id }
        try { localStorage.setItem(key, JSON.stringify(intent)) }
        catch { if (mounted.current) setStorageError('导出凭据写入失败，本次未提交；请恢复存储后重读。'); return }
        if (mounted.current) setPending(intent)
      }
      const response = intent.retryTaskId
        ? await StudioDirectingService.directingRetrySceneExport({ projectId, sequenceId, versionId, taskId: intent.retryTaskId, requestBody: { request_id: intent.request.request_id } })
        : await StudioDirectingService.directingSubmitSceneExport({ projectId, sequenceId, versionId, requestBody: intent.request })
      if (!response.data) throw new Error('导出受理结果尚未核实，请核实原请求。')
      clear(intent)
      if (mounted.current) { setSelectedId(response.data.task_id); setAttempt(value => value + 1) }
    } catch (cause) {
      if (cause instanceof ApiError && [400, 409, 422].includes(cause.status) && intent) {
        try { clear(intent) } catch { if (mounted.current) setStorageError('导出凭据尚未清理，请恢复存储后重读。') }
      }
      if (mounted.current) setError(directingError(cause))
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const activeTask = rows?.find(row => !terminal.includes(row.status))
  const selected = selectedId ? rows?.find(row => row.task_id === selectedId) : rows?.[0]
  const dimensions = (tier: number) => content.output_aspect_ratio === '16:9' ? `${tier * 16 / 9}×${tier}` : content.output_aspect_ratio === '9:16' ? `${tier}×${tier * 16 / 9}` : `${tier}×${tier}`
  const scaled = measured?.data?.clips.filter(clip => clip.needs_upscale) || []
  const trigger = <Button aria-label={pending || storageError ? '查看导出待核实状态' : '导出'} data-menu-close onClick={() => setSettingsOpen(true)}>{pending || storageError ? '查看导出待核实状态' : '导出'}</Button>
  return <>
    {!historyOnly && (triggerHost ? createPortal(trigger, triggerHost) : trigger)}
    {!historyOnly && feedbackHost && (pending || storageError || error) && createPortal(<Alert type="warning" message={pending ? '导出提交待核实' : storageError || error}
      action={<Button onClick={() => setSettingsOpen(true)}>处理导出状态</Button>} />, feedbackHost)}
    <Modal rootClassName="canvas-workbench-dialog" title="整场导出" open={!historyOnly && settingsOpen} onCancel={() => setSettingsOpen(false)} footer={<WorkbenchDialogActions secondary={<Button onClick={() => setSettingsOpen(false)}>返回画布</Button>}>{<Button type="primary" loading={busy} disabled={disabled || !!storageError || (!pending && (historical || !rows || !!readError || !!activeTask))} onClick={() => void submit()}>
      {pending ? '核实原导出请求' : dirty ? '保存并导出整场视频' : '导出整场视频'}
    </Button>}</WorkbenchDialogActions>}>
    {!historyOnly && <><Select aria-label="导出尺寸" value={size} disabled={busy || !!pending || historical} onChange={setSize} style={{ width: 190 }}
      options={([1080, 720] as const).map(tier => ({ value: tier, label: `${tier} 档 · ${dimensions(tier)}` }))} />
    {!measured && <span>正在核实导出媒体尺寸…</span>}
    {!!scaled.length && <Popover trigger="click" content={<div style={{ maxWidth: 440 }}><p>将进行普通缩放，不增加原素材真实细节，也不会重新拍摄或 AI 超分。</p>{scaled.map(clip => <p key={clip.clip_id}>
      片段 {content.timeline.items.findIndex(item => item.id === clip.clip_id) + 1}：实测 {Math.round(clip.source_width)}×{Math.round(clip.source_height)}，有效画面 {Math.round(clip.effective_width)}×{Math.round(clip.effective_height)}，放大 {clip.scale.toFixed(2)} 倍。
      <Button onClick={() => onLocate(clip.clip_id)}>定位放大片段</Button>
    </p>)}</div>}><Button>{scaled.length} 个片段将普通放大</Button></Popover>}
    {measured?.error && <Alert type="warning" message="导出媒体检查失败" description={measured.error} action={<Space><Button onClick={() => { setInspection(undefined); setInspectionAttempt(value => value + 1) }}>重查导出媒体</Button>{content.timeline.items.filter(clip => measured.error?.includes(clip.id)).map(clip => <Button key={clip.id} onClick={() => onLocate(clip.id)}>定位问题片段</Button>)}</Space>} />}


    <Button onClick={() => { setSettingsOpen(false); setOpen(true) }}>导出记录</Button>
    {activeTask && <span role="status">整场导出：{activeTask.cancel_requested ? '取消处理中' : statuses[activeTask.status]}</span>}
    </>}
    {!historyOnly && error && <Alert type="warning" message={error} action={<Space wrap>
      {content.timeline.items.map((clip, index) => error.includes(`片段 ${clip.id} `) && <Button key={clip.id} onClick={() => onLocate(clip.id)}>定位导出问题片段 {index + 1}</Button>)}
    </Space>} />}
    {!historyOnly && readError && <Alert type="warning" message="导出记录读取失败" description={readError} action={<Button onClick={() => setAttempt(value => value + 1)}>重读导出记录</Button>} />}
    {!historyOnly && storageError && <Alert type="warning" message={storageError} action={<Button onClick={() => {
      try { setPending(readPending()); setStorageError('') } catch { setStorageError('本地导出凭据仍无法读取，请恢复后重读。') }
    }}>重读导出凭据</Button>} />}
    </Modal>
    <WorkbenchDetails title="整场导出记录" status="固定记录" open={open} initialExpanded onClose={close} closeDisabled={historyOnly && (busy || !!pending || !!storageError)}>
      <Button disabled={historyOnly && (busy || !!pending || !!storageError)} onClick={close}>返回画布</Button>
      {historyOnly && <Alert type="info" message="正在只读查看其他版本的固定导出依据；按原记录重试归属该版本，不保存或替换当前编辑。" />}
      {historyOnly && storageError && <Alert type="warning" message={storageError} action={<Button onClick={() => {
        try { setPending(readPending()); setStorageError('') } catch { setStorageError('本地导出凭据仍无法读取，请恢复后重读。') }
      }}>重读导出凭据</Button>} />}
      {historyOnly && error && <Alert type="warning" message={error} />}
      {historyOnly && pending && <Alert type="warning" message="导出受理结果待核实，请先核实原请求再返回画布。" action={<Button loading={busy} disabled={disabled || !!storageError} onClick={() => void submit()}>核实原导出请求</Button>} />}
      <p>每次导出使用当时已保存的整场剪辑。未验收、未通过和声音待后期不会被标记为已解决。</p>
      {!rows && !readError && <p>正在读取导出记录…</p>}
      {rows?.length === 0 && !readError && <p>本版本暂无导出记录。</p>}
      {!!rows?.length && <Select aria-label="导出记录选择" value={selected?.task_id} style={{ width: '100%' }} options={rows.map((row, index) => ({ value: row.task_id, label: `导出 ${rows.length - index} · 保存修订 ${row.snapshot.revision} · ${statuses[row.status]}` }))} onChange={setSelectedId} />}
      {readError && <Alert type="warning" message="导出记录读取失败" action={<Button onClick={() => setAttempt(value => value + 1)}>重读导出记录</Button>} />}
      {rows && selectedId && !selected && !readError && <Alert type="warning" message="指定导出记录不属于本版本或已不可用，请明确选择其他记录。" />}
      {selected && <section aria-label="当前导出记录">
        <p>{selected.cancel_requested && !terminal.includes(selected.status) ? '取消处理中' : statuses[selected.status]}</p>
        <p>固定保存修订：{selected.snapshot.revision} · {selected.snapshot.content.output_aspect_ratio} · {selected.snapshot.profile.width}×{selected.snapshot.profile.height} · {selected.snapshot.profile.size} 档 · 30fps · H.264 / AAC · MP4</p>
        {selected.snapshot.content.timeline.items.map((clip, index) => <p key={clip.id}>片段 {index + 1}（{clip.id}）：时间线 {clip.timeline_start_ms / 1000} 秒{'media_range' in clip && <>，源区间 {clip.media_range.source_in_ms / 1000}–{clip.media_range.source_out_ms / 1000} 秒，{clip.fit === 'cover' ? '居中填满' : '完整显示'}</>} {!historyOnly && <Button disabled={!currentClipIds.includes(clip.id)} onClick={() => { close(); onLocate(clip.id) }}>{currentClipIds.includes(clip.id) ? `定位片段 ${index + 1}` : '当前内容已无此片段'}</Button>}</p>)}
        {selected.error && <Alert type="error" message={selected.error} />}
        <Space wrap>
          {!terminal.includes(selected.status) && <Button disabled={disabled || cancelling || !!readError || selected.cancel_requested} loading={cancelling} onClick={async () => {
            setCancelling(true)
            try { await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: selected.task_id, requestBody: { reason: '用户取消整场导出' } }); setAttempt(value => value + 1) }
            catch (cause) { setReadError(directingError(cause)) }
            finally { setCancelling(false) }
          }}>{selected.cancel_requested ? '已请求取消，等待执行结束' : '取消此导出'}</Button>}
          {['failed', 'cancelled'].includes(selected.status) && <Button disabled={disabled || historical || busy || !!pending || !!storageError || !!readError || !!activeTask} onClick={() => void submit(selected)}>按原记录重试</Button>}
          {selected.status === 'succeeded' && <Button onClick={() => setAttempt(value => value + 1)}>重读成果状态</Button>}
          {selected.file_id && !selected.file_deleted && <Button danger disabled={disabled || deleting || !!readError} onClick={() => { video.current?.pause(); setDeleteError(''); setDeleteTarget(selected) }}>删除成果文件</Button>}
          {selected.download_url && <Button href={resolveAssetUrl(selected.download_url)} download>下载成片</Button>}
        </Space>
        {open && selected.download_url && <video ref={video} aria-label="导出成片预览" key={selected.task_id} controls preload="metadata" src={resolveAssetUrl(selected.download_url)} style={{ width: '100%', maxHeight: 280 }} />}
        {selected.status === 'succeeded' && <p>下载中断时可重新下载同一文件，不会重新渲染或创建任务。</p>}
        {selected.status === 'succeeded' && !selected.download_url && <Alert type="warning" message={selected.file_status === 'unknown' ? '成果文件状态未能核实，请重读成果状态' : selected.file_deleted ? '成果文件已删除，成功记录仍保留' : '成果文件不可用，成功记录仍保留'} />}
      </section>}
    </WorkbenchDetails>
    <Modal title="删除这份导出成果？" open={!!deleteTarget} rootClassName="canvas-workbench-dialog" confirmLoading={deleting}
      okText="删除成果文件" cancelText={deleteError ? '关闭并核实' : '保留文件'} okButtonProps={{ danger: true }} cancelButtonProps={{ disabled: deleting }} closable={!deleting} maskClosable={!deleting}
      onCancel={() => { if (!deleting) { setDeleteTarget(undefined); if (deleteError) setAttempt(value => value + 1) } }} onOk={async () => {
        if (!deleteTarget || deleting || disabled) return
        setDeleting(true); setDeleteError('')
        const taskId = deleteTarget.task_id
        try {
          const response = await StudioDirectingService.directingDeleteSceneExportFile({ projectId, sequenceId, versionId, taskId })
          if (!response.data?.file_deleted) throw new Error('删除结果尚未核实，请重试此文件删除或重新读取成果状态。')
          if (mounted.current) {
            setRows(previous => previous?.map(row => row.task_id === taskId ? response.data! : row))
            setDeleteTarget(undefined)
          }
        } catch (cause) { if (mounted.current) setDeleteError(directingError(cause)) }
        finally { if (mounted.current) setDeleting(false) }
      }}>
      <p>将删除保存修订 {deleteTarget?.snapshot.revision} 的这份成片文件。成功执行记录、源素材、当前剪辑和其他导出成果继续保留。</p>
      <p>文件仍被其他业务使用时会拒绝删除。</p>
      {deleteError && <Alert type="warning" message={deleteError} />}
    </Modal>
  </>
}
