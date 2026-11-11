import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Modal as AntModal, Radio, Space, Spin } from 'antd'
import { createPortal } from 'react-dom'
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

function RetryContainer({ inline, actionHost, ...props }: React.ComponentProps<typeof AntModal> & { inline: boolean; actionHost?: HTMLElement | null }) {
  return inline ? props.open ? <section aria-label={String(props.title)}>
    <h3>{props.title}</h3>{props.children}<div>{typeof props.footer === 'function' ? null : actionHost ? createPortal(props.footer, actionHost) : props.footer}</div>
  </section> : null : <AntModal {...props} />
}

/** 确认本次依据后重试原画布，未知结果只重放已保存的同一请求。 */
export function WorkbenchStoryboardRetry({ projectId, chapterId, sequenceId, canvas, historical, onAccepted, onReviewSource, inline = false, actionHost }: {
  projectId: string; chapterId: string; sequenceId: string; canvas: SceneCanvasSummary
  historical: boolean; onAccepted: () => void
  actionHost?: HTMLElement | null
  inline?: boolean
  onReviewSource: () => void
}) {
  const navigate = useNavigate()
  const canvasId = canvas.id
  const task = canvas.latest_storyboard
  const reviewOnly = task?.review_state === 'incomplete'
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
  const [regenerate, setRegenerate] = useState(false)
  const [choice, setChoice] = useState<string>()
  const mounted = useRef(false), sending = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!target) return
    let active = true
    setPreview(undefined); setError(''); setUseSaved(false); setChoice(undefined); setRegenerate(false); setLoading(true)
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
    && (regenerate || !preview?.structure_options?.length || !!choice)
  const confirm = () => {
    if (pending) void submit(pending)
    else if (ready && basis && target) void submit({ taskId: target, body: {
      request_id: crypto.randomUUID(), basis_token: basis.token, regenerate, structure_choice_id: regenerate ? undefined : choice, use_saved_objects: basis.object_task_active && useSaved,
    } })
  }
  const verifyLabel = '核实重试'
  return <>
    {pending && !target ? <Button loading={submitting} onClick={confirm}>{verifyLabel}</Button>
      : retryable && <Button onClick={() => setTarget(task.task_id)}>{reviewOnly ? '重试审查' : '重试分镜'}</Button>}
    {!target && (error || pending && !submitting) && <p className="management-canvas-error" role="status">
      {pending ? '重试结果待核实。' : error}
    </p>}
    <RetryContainer inline={inline} actionHost={actionHost} title={reviewOnly ? '核对重试审查' : '核对重试分镜'} open={!!target} onCancel={() => setTarget(undefined)} footer={<Space>
      {!inline && <Button aria-label="关闭重试确认" onClick={() => setTarget(undefined)}>关闭</Button>}
      <Button type="primary" loading={submitting} disabled={!pending && !ready} onClick={confirm}>
        {pending ? verifyLabel : regenerate ? '确认重新生成' : preview?.structure_only ? '继续纠错' : preview?.structure_issues?.length ? '确认重新生成' : '确认重试'}
      </Button>
    </Space>}>
      <p>{reviewOnly ? '已保留分镜草案。本次从审查阶段继续，结果仍需核对后应用。'
        : '本次使用下方已核对的输入，任务仍在原画布中继续。生成结果需要核对后应用。'}</p>
      {pending && !submitting && <Alert type="warning" showIcon message="重试结果待核实，将使用同一请求身份。" />}
      {error && <Alert type="error" showIcon message={error} action={target && !pending && !loading
        && <Button size="small" onClick={refresh}>重新读取依据</Button>} />}
      {loading && <Spin aria-label="正在读取重试依据" />}
      {preview && <>
        {!preview.review_only && <Radio.Group value={regenerate} disabled={!!pending || submitting}
          onChange={event => setRegenerate(event.target.value as boolean)}>
          <Radio value={false}>{preview.structure_only ? '继续原草案纠错' : '重新提取分镜'}</Radio>
          {preview.structure_only && <Radio value={true}>重新生成整份分镜</Radio>}
        </Radio.Group>}
        {!preview.structure_only && !!preview.structure_issues?.length && <>
          <p>原输出无法恢复为可靠草案，本次将重新生成整份分镜。请核对输入后明确确认。</p>
          <ul>{preview.structure_issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
        </>}
        {preview.structure_only && !regenerate && <>
          <p>仅尝试一次关联纠错，保留镜头结构和设计正文。无进展时会说明原因，不自动重新生成；结果仍需核对后应用。</p>
          <details><summary>查看结构校验问题</summary>
            <ul>{preview.structure_issues?.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
          </details>
          {!!preview.structure_options?.length && <Radio.Group value={choice} disabled={!!pending || submitting}
            onChange={event => setChoice(event.target.value as string)}>
            {preview.structure_options.map(option => <div key={option.id}>
              <Radio value={option.id} aria-label={option.title}>{option.title}
                <small style={{ display: 'block', marginTop: 4 }}>{option.impact}</small>
              </Radio>
            </div>)}
          </Radio.Group>}
        </>}
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
    </RetryContainer>
  </>
}
