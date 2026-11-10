import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Modal, Space, Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import { ApiError, StudioDirectingService as Directing } from '../../../services/generated'
import type { SceneCanvasSummary, StoryboardRetry, StoryboardRetryBasis } from '../../../services/generated'
import { workbenchManagementLocation } from './chapterNavigation'
import { directingError } from './common'
import { StoryboardBasisPreview } from './StoryboardBasisPreview'

type RetryIntent = { taskId: string; body: StoryboardRetry }

function readIntent(key: string): RetryIntent | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null') as RetryIntent | null
    return value?.taskId && value.body.request_id && value.body.basis_token ? value : undefined
  } catch { return undefined }
}

function retryError(cause: unknown) {
  const reason = directingError(cause)
  if (!(cause instanceof ApiError) || cause.status !== 404) return reason
  return /model not found/i.test(reason) ? '原文本模型已不可用。' : '原画布或任务已不可用'
}

/** 确认本次依据后重试原画布，未知结果只重放已保存的同一请求。 */
export function WorkbenchStoryboardRetry({ projectId, chapterId, sequenceId, canvas, historical, onAccepted, onReviewSource }: {
  projectId: string; chapterId: string; sequenceId: string; canvas: SceneCanvasSummary
  historical: boolean; onAccepted: () => void
  onReviewSource: () => void
}) {
  const navigate = useNavigate()
  const canvasId = canvas.id
  const task = canvas.latest_storyboard
  const retryable = !historical && (task?.status === 'failed' || task?.status === 'cancelled')
  const key = 'jellyfish:management-storyboard-retry:' + JSON.stringify([projectId, chapterId, sequenceId, canvasId])
  const [pending, setPending] = useState(() => readIntent(key))
  const [target, setTarget] = useState<string>()
  const [preview, setPreview] = useState<StoryboardRetryBasis>()
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [useSaved, setUseSaved] = useState(false)
  const mounted = useRef(false), sending = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!target) return
    let active = true
    setPreview(undefined); setError(''); setUseSaved(false); setLoading(true)
    const request = Directing.directingStoryboardRetryBasis({ projectId, chapterId, sequenceId, taskId: target })
    void request.then(response => {
      if (!active) return
      if (!response.data || response.data.canvas_id !== canvasId) throw new Error('原画布或任务已不可用')
      setPreview(response.data)
    }).catch(cause => {
      if (active) setError(retryError(cause))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; request.cancel() }
  }, [projectId, chapterId, sequenceId, target, canvasId, revision])

  const submit = async (intent: RetryIntent) => {
    if (sending.current) return
    const clear = () => {
      try {
        if (readIntent(key)?.body.request_id === intent.body.request_id) localStorage.removeItem(key)
      } catch { /* 原请求仍可核实。 */ }
      if (mounted.current) setPending(readIntent(key))
    }
    try {
      const previous = readIntent(key)
      if (previous && previous.body.request_id !== intent.body.request_id) {
        setPending(previous)
        throw new Error('请先核实此前的分镜重试')
      }
      localStorage.setItem(key, JSON.stringify(intent))
    } catch (cause) { setError(directingError(cause)); return }
    sending.current = true
    setSubmitting(true); setPending(intent); setError('')
    try {
      const response = await Directing.directingStoryboardRetry({
        projectId, chapterId, sequenceId, taskId: intent.taskId, requestBody: intent.body,
      })
      if (response.data?.canvas_id !== canvasId) throw new Error('重试结果待核实')
      clear()
      if (!mounted.current) return
      setTarget(undefined)
      onAccepted()
    } catch (cause) {
      if (cause instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(cause.status)) {
        clear()
        if (mounted.current) setPreview(undefined)
      }
      if (mounted.current) setError(retryError(cause))
    } finally {
      sending.current = false
      if (mounted.current) setSubmitting(false)
    }
  }
  const refresh = () => setRevision(value => value + 1)
  const basis = preview?.basis
  const ready = retryable && task?.task_id === target && !!basis && !basis.preparation_stale
    && (!basis.object_task_active || basis.preparation_revision > 0 && useSaved)
  const confirm = () => {
    if (pending) void submit(pending)
    else if (ready && basis && target) void submit({ taskId: target, body: {
      request_id: crypto.randomUUID(), basis_token: basis.token, use_saved_objects: basis.object_task_active && useSaved,
    } })
  }
  const verifyLabel = '核实重试'
  return <>
    {pending && !target ? <Button loading={submitting} onClick={confirm}>{verifyLabel}</Button>
      : retryable && <Button onClick={() => setTarget(task.task_id)}>重试分镜</Button>}
    {!target && (error || pending && !submitting) && <p className="management-canvas-error" role="status">
      {pending ? '重试结果待核实。' : error}
    </p>}
    <Modal title="核对重试分镜" open={!!target} onCancel={() => setTarget(undefined)} footer={<Space>
      <Button aria-label="关闭重试确认" onClick={() => setTarget(undefined)}>关闭</Button>
      <Button type="primary" loading={submitting} disabled={!pending && !ready} onClick={confirm}>
        {pending ? verifyLabel : '确认重试'}
      </Button>
    </Space>}>
      <p>本次使用下方已核对的输入，任务仍在原画布中继续。生成结果需要核对后应用。</p>
      {pending && !submitting && <Alert type="warning" showIcon message="重试结果待核实，将使用同一请求身份。" />}
      {error && <Alert type="error" showIcon message={error} action={target && !pending && !loading
        && <Button size="small" onClick={refresh}>重新读取依据</Button>} />}
      {loading && <Spin aria-label="正在读取重试依据" />}
      {preview && <>
        <Descriptions column={1} size="small" items={[
          { key: 'canvas', label: '目标画布', children: canvas.name },
          { key: 'mode', label: '分镜模式', children: preview.mode === 'faithful' ? '忠实提取' : '自动产出完整分镜' },
          { key: 'text', label: '文本模型', children: preview.text_model_name },
          { key: 'production', label: '生产模型', children: preview.production_model_name
            ?? (preview.pending_modality === 'video' ? '稍后配置视频模型卡' : '稍后配置图片模型卡') },
        ]} />
        <StoryboardBasisPreview basis={preview.basis} useSaved={useSaved} onUseSaved={setUseSaved} onRefresh={refresh}
          sourceLabel={preview.source_kind === 'fixed' ? '本次采用的画布固定原文' : '本次采用的场次摘录'}
          emptyText="本次重试未采用对象参考，可以继续核对。"
          onOpenSource={onReviewSource}
          onOpenObjects={() => navigate(workbenchManagementLocation(projectId, chapterId, sequenceId, 'objects'))} />
      </>}
    </Modal>
  </>
}
