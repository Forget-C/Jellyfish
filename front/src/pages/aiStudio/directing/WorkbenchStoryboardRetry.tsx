import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Descriptions, Modal as AntModal, Input, Radio, Space, Spin } from 'antd'
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

function readDraftNotes(key: string) {
  try { return sessionStorage.getItem(key) || '' } catch { return '' }
}

function retryError(cause: unknown) {
  const reason = directingError(cause)
  if (!(cause instanceof ApiError) || cause.status !== 404) return reason
  return /model not found/i.test(reason) ? '原文本模型已不可用。' : '原画布或任务已不可用'
}

function RetryContainer({ inline, actionHost, ...props }: React.ComponentProps<typeof AntModal> & { inline: boolean; actionHost?: HTMLElement | null }) {
  return inline ? props.open ? <section className="management-storyboard-processing" aria-label={String(props.title)}>
    {props.children}<div>{typeof props.footer === 'function' ? null : actionHost ? createPortal(props.footer, actionHost) : props.footer}</div>
  </section> : null : <AntModal {...props} />
}

/** 确认本次依据后重试原画布，未知结果只重放已保存的同一请求。 */
export function WorkbenchStoryboardRetry({ projectId, chapterId, sequenceId, canvas, historical, onAccepted, onSubmissionChange, onReviewSource, inline = false, actionHost }: {
  projectId: string; chapterId: string; sequenceId: string; canvas: SceneCanvasSummary
  historical: boolean; onAccepted: (taskId: string) => void
  onSubmissionChange: (submitting: boolean) => void
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
  const [target, setTarget] = useState<string | undefined>(() => inline && retryable ? task?.task_id : undefined)
  const draftKey = key + ':' + task?.task_id
  const [notes, setNotes] = useState(() => readDraftNotes(draftKey))
  const updateNotes = (value: string) => {
    setNotes(value)
    try { sessionStorage.setItem(draftKey, value) } catch { /* 当前会话仍保留输入。 */ }
  }
  const [preview, setPreview] = useState<StoryboardRetryBasis>()
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [useSaved, setUseSaved] = useState(false)
  const [confirmedReviewBasis, setConfirmedReviewBasis] = useState(false)
  const [regenerate, setRegenerate] = useState(false)
  const [choice, setChoice] = useState<string | null>()
  useEffect(() => {
    if (inline) setTarget(retryable ? task?.task_id : undefined)
    setNotes(readDraftNotes(draftKey))
  }, [inline, retryable, task?.task_id, draftKey])
  const mounted = useRef(false), sending = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!target) return
    let active = true
    setConfirmedReviewBasis(false); setPreview(undefined); setError(''); setUseSaved(false); setChoice(undefined); setRegenerate(false); setLoading(true)
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
    onSubmissionChange(true)
    try {
      const response = await Directing.directingStoryboardRetry({
        projectId, chapterId, sequenceId, taskId: intent.taskId, requestBody: intent.body,
      })
      if (response.data?.canvas_id !== canvasId) throw new Error('重试结果待核实')
      clear()
      try { sessionStorage.removeItem(draftKey) } catch { /* 已受理任务不受本地存储影响。 */ }
      if (mounted.current) setTarget(undefined)
      onAccepted(response.data.task_id)
    } catch (cause) {
      if (cause instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(cause.status)) {
        clear()
        if (mounted.current) setPreview(undefined)
      }
      if (mounted.current) setError(retryError(cause))
    } finally {
      sending.current = false
      if (mounted.current) setSubmitting(false)
      onSubmissionChange(false)
    }
  }
  const refresh = () => setRevision(value => value + 1)
  const basis = preview?.basis
  const ready = (!preview?.review_only || !preview?.review_basis_changed || confirmedReviewBasis) && !loading && retryable && task?.task_id === target && !!basis && !basis.preparation_stale
    && (!basis.object_task_active || basis.preparation_revision > 0 && useSaved)
    && (regenerate || !preview?.structure_options?.length || (choice === null ? !!notes.trim() : !!choice))
  const confirm = () => {
    if (pending) void submit(pending)
    else if (ready && basis && target) void submit({ taskId: target, body: {
      request_id: crypto.randomUUID(), basis_token: basis.token, regenerate, structure_choice_id: regenerate ? undefined : choice ?? undefined, correction_notes: regenerate || reviewOnly ? '' : notes.trim(), use_saved_objects: basis.object_task_active && useSaved,
    } })
  }
  const verifyLabel = '核实提交结果'
  return <>
    {pending && !target ? <Button loading={submitting} onClick={confirm}>{verifyLabel}</Button>
      : !inline && retryable && <Button onClick={() => setTarget(task.task_id)}>{reviewOnly ? '重试审查' : '重试分镜'}</Button>}
    {!target && (error || pending && !submitting) && <p className="management-canvas-error" role="status">
      {pending ? '重试结果待核实。' : error}
    </p>}
    <RetryContainer inline={inline} actionHost={actionHost} title={preview?.prompt_only ? '核对提示词恢复' : reviewOnly ? '核对重试审查' : '核对分镜处理'} open={!!target} onCancel={() => setTarget(undefined)} footer={<Space>
      {!inline && <Button aria-label="关闭重试确认" onClick={() => setTarget(undefined)}>关闭</Button>}
      <Button type="primary" loading={submitting} disabled={!pending && !ready} onClick={confirm}>
        {pending ? verifyLabel : regenerate ? '确认重新生成' : preview?.structure_only ? '提交纠错' : preview?.structure_issues?.length ? '确认重新生成' : preview?.prompt_only ? '继续编写提示词' : reviewOnly ? '重新审查' : '确认重试'}
      </Button>
    </Space>}>
      {!preview?.structure_only && <p>{preview?.prompt_only ? '设计与已完成提示词已保留。本次继续未完成单元，完成后再审查。' : reviewOnly ? '已保留分镜草案。本次从审查阶段继续，结果仍需核对后应用。'
        : '本次使用下方已核对的输入，任务仍在原画布中继续。生成结果需要核对后应用。'}</p>}
      {pending && !submitting && <Alert type="warning" showIcon message="重试结果待核实，将使用同一请求身份。" />}
      {error && <Alert type="error" showIcon message={error} action={target && !pending && !loading
        && <Button size="small" onClick={refresh}>重新读取依据</Button>} />}
      {loading && <Spin aria-label="正在读取重试依据" />}
      {preview && (!preview.current_attempt || preview.current_attempt.task_id === target && target === task?.task_id) && <>
        {preview.current_attempt && <section aria-label="本轮结果">
          <h3>本轮结果</h3>
          <p><strong>{preview.current_attempt.title}</strong> · <time dateTime={preview.current_attempt.created_at}>{new Date(preview.current_attempt.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time></p>
          <p>{preview.current_attempt.reason}</p>
          {preview.structure_only && <p>保留草案未更新；纠错结果仍需核对后应用。</p>}
          {!preview.review_only && preview.current_attempt.correction_notes && <><strong>本轮提交的意见</strong><p>{preview.current_attempt.correction_notes}</p>
            <Button disabled={!!pending || submitting} onClick={() => updateNotes(preview.current_attempt?.correction_notes ?? '')}>沿用此意见</Button></>}
        </section>}
        {!!preview.user_issues?.length && <section aria-label="保留草案的问题"><h3>保留草案的问题（{preview.user_issues?.length}）</h3>
          <p>以下问题根据保留草案与本任务的固定依据重新核验。</p>
          {preview.user_issues?.map((issue, index) => <article className="management-processing-issue" key={index}>
            <strong>{issue.title}</strong><p>{issue.explanation}</p><p>{issue.decision}</p>
            {issue.context && <details><summary>查看相关内容</summary><p>{issue.context}</p></details>}
          </article>)}
        </section>}
        <h3>下一次处理</h3>
        {preview.review_only && preview.review_basis_changed && <Alert type="warning" message="画布合并依据已变化，请先查看当前画布并确认本次审查将使用新的合并方案。" />}
        {preview.review_only && preview.review_basis_changed && <>
          {preview.review_diff && <section aria-label="本次合并方案">
            <h4>本次候选与当前画布的合并变化</h4>
            {(['added', 'modified', 'removed', 'orphaned'] as const).map((kind, index) => <div key={kind}>
              <strong>{['新增', '更新', '移除', '引用受影响'][index]}</strong>
              <ul>{preview.review_diff?.[kind].map(card => <li key={card.id}>{card.type_name} · {card.name}</li>)}</ul>
            </div>)}
          </section>}
          <Checkbox checked={confirmedReviewBasis} disabled={!!pending || submitting || !preview.review_diff}
            onChange={event => setConfirmedReviewBasis(event.target.checked)}>已核对合并变化，确认审查本次方案</Checkbox>
        </>}

        {!preview.review_only && <Radio.Group value={regenerate} disabled={!!pending || submitting}
          onChange={event => setRegenerate(event.target.value as boolean)}>
          <Radio value={false}>{preview.structure_only ? '修正当前草案' : '重新提取分镜'}</Radio>
          {preview.structure_only && <Radio value={true}>重新生成整份分镜</Radio>}
        </Radio.Group>}
        {!preview.structure_only && !!preview.structure_issues?.length && <>
          <p>原输出无法恢复为可靠草案，本次将重新生成整份分镜。请核对输入后明确确认。</p>

        </>}
        {preview.structure_only && !regenerate && <>
          <p>保留镜头结构和设计正文，尝试一次关联纠错；结果仍需核对后应用。</p>

          {!!preview.structure_options?.length && <Radio.Group value={choice} disabled={!!pending || submitting}
            onChange={event => setChoice(event.target.value as string | null)}>
            {preview.structure_options.map(option => <div key={option.id}>
              <Radio value={option.id} aria-label={option.title}>{option.title}
                <small style={{ display: 'block', marginTop: 4 }}>{option.impact}</small>
              </Radio>
            </div>)}
            <Radio value={null}>自行说明处理方式</Radio>
          </Radio.Group>}
          <label htmlFor="storyboard-correction-notes">下一次纠错意见{choice === null ? '（必填）' : '（选填）'}</label>
          <Input.TextArea id="storyboard-correction-notes" aria-label="纠错意见" value={pending?.body.correction_notes ?? notes}
            onChange={event => updateNotes(event.target.value)} disabled={!!pending || submitting} maxLength={2000} showCount rows={4}
            placeholder="说明应如何修正对象关联、适用范围或引用" />
          <p className="management-processing-hint">仅用于本次关联纠错，不改动镜头数量、顺序、事实和设计正文。</p>
        </>}
        {regenerate && <p role="status">纠错意见不用于本次重新生成</p>}
        {!!preview.history?.length && <details><summary>历史处理记录（{preview.history.length}次）</summary>
          {preview.history.map(attempt => <article className="management-processing-issue" key={attempt.task_id}>
            <strong>{attempt.title.replace(/^本轮/, '')}</strong> · <time dateTime={attempt.created_at}>{new Date(attempt.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time>
            {attempt.correction_notes && <p>提交意见：{attempt.correction_notes}</p>}
            <p>{attempt.reason}</p>
            {!!attempt.diagnostics?.length && <details><summary>该轮技术诊断</summary><ul>{attempt.diagnostics.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}
          </article>)}
        </details>}
        {!!preview.current_attempt?.diagnostics?.length && <details><summary>本轮技术诊断</summary><ul>{preview.current_attempt.diagnostics.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}
        <details open={basis?.preparation_stale || basis?.object_task_active || basis?.source_changed || undefined}><summary>本次使用的原文、对象与模型</summary>
        <Descriptions column={1} size="small" items={[
          { key: 'canvas', label: '目标画布', children: canvas.name },
          { key: 'mode', label: '分镜模式', children: preview.mode === 'faithful' ? '忠实提取' : '自动产出完整分镜' },
          { key: 'text', label: '文本模型', children: preview.text_model_name },
          { key: 'production', label: '生产模型', children: preview.production_model_name
            ?? (preview.pending_modality === 'video' ? '稍后配置视频模型卡' : '稍后配置图片模型卡') },
        ]} />
        <StoryboardBasisPreview basis={preview.review_only ? { ...preview.basis, source_changed: false } : preview.basis} useSaved={useSaved} onUseSaved={setUseSaved} onRefresh={refresh}
          sourceLabel={preview.source_kind === 'fixed' ? '本次采用的画布固定原文' : '本次采用的场次摘录'}
          emptyText="本次重试未采用对象参考，可以继续核对。"
          onOpenSource={onReviewSource}
          onOpenObjects={() => navigate(workbenchManagementLocation(projectId, chapterId, sequenceId, 'objects'))} />
        </details>
      </>}
    </RetryContainer>
  </>
}
