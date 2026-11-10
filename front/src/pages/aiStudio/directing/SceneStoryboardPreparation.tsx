import { useEffect, useRef, useState } from 'react'
import { Alert, Checkbox, Radio, Select, Space } from 'antd'
import { ApiError, LlmService, StudioDirectingService as Directing } from '../../../services/generated'
import type { ModelRead, StoryboardReextractRequest, StoryboardTaskRead, StoryboardTaskSummary } from '../../../services/generated'
import { directingError } from './common'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import { WorkbenchDialogActions, WorkbenchModal } from './ui/WorkbenchModal'

type Scope = { projectId: string; chapterId: string; sequenceId: string }
type Submission = { kind: 'reextract'; body: StoryboardReextractRequest }
const activeTask = (task?: StoryboardTaskSummary) => task?.status === 'queued' || task?.status === 'running'

function pendingSubmission(key: string): Submission | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null') as Submission | null
    return value?.body.request_id && value.kind === 'reextract'
      ? value : undefined
  } catch { return undefined }
}

function taskLabel(task: StoryboardTaskSummary) {
  if (task.status === 'queued') return '分镜任务排队中'
  if (task.stage === 'reviewing_storyboard') return '正在审查分镜连续性'
  if (task.stage === 'repairing_storyboard') return '正在定向修正分镜'
  if (task.stage === 'rechecking_storyboard') return '正在复核分镜连续性'
  if (task.review_state === 'incomplete') return '分镜审查未完成，草案已保留'
  if (task.review_state === 'conflict') return '分镜存在设计冲突'
  if (task.review_state === 'warning') return '部分连续性依据不足'
  if (task.status === 'running') return task.stage === 'assembling_storyboard' ? '正在校验并组装画布' : '正在提取分镜'
  if (task.status === 'failed') return '分镜提取失败'
  if (task.status === 'cancelled') return '分镜任务已取消'
  return task.candidate_available ? '分镜结果可查看' : '分镜任务已完成'
}

/** 只有当前打开的等待容器可以继续原流程，恢复或离页完成均由用户主动查看。 */
export function SceneStoryboardPreparation({ scope, editable, target, selectedTaskId, navigationKey, onResult, onReviewRetry }: {
  scope: Scope; editable: boolean
  selectedTaskId?: string | null; navigationKey: string;
  onResult: (result: StoryboardTaskRead, follow: boolean) => void;
  onReviewRetry: (taskId: string) => void;
  target: { id: string; appliedTaskId?: string; sourceChanged: boolean; sourceReady: boolean; productionModelId?: string; pendingModality?: StoryboardReextractRequest['pending_modality']; confirmSource: () => void };
}) {
  const action = '重新提取'
  const { projectId, chapterId, sequenceId } = scope
  const targetId = target.id
  const key = 'jellyfish:storyboard-submission:' + JSON.stringify([projectId, chapterId, sequenceId, targetId])
  const [pending, setPending] = useState(() => pendingSubmission(key))
  const [draft, setDraft] = useState<StoryboardReextractRequest>()
  const [waiting, setWaiting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [reportedTask, setTask] = useState<StoryboardTaskSummary>()
  const task = reportedTask && reportedTask.task_id === target.appliedTaskId
    ? { ...reportedTask, candidate_available: false } : reportedTask
  const [models, setModels] = useState<ModelRead[]>([])
  const [modelError, setModelError] = useState('')
  const open = !!draft || waiting
  const load = useRef(0)
  const sending = useRef(false)
  const mounted = useRef(false)
  const live = useRef<{ key: string; href: string }>()
  const wait = useRef<{ key: string; href: string; taskId?: string }>()
  const resultHandler = useRef(onResult); resultHandler.current = onResult
  const view = { key: navigationKey, href: window.location.href }
  live.current = view
  const isLive = (captured: typeof view) => mounted.current && live.current?.key === captured.key && window.location.href === captured.href
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; wait.current = undefined }
  }, [])

  useEffect(() => {
    const version = ++load.current
    let active = true
    wait.current = undefined
    setDraft(undefined); setWaiting(false); setChecking(false); setSubmitting(false); setTask(undefined); setError('')
    setPending(pendingSubmission(key))
    const request = selectedTaskId
      ? Directing.directingStoryboardGet({ projectId, chapterId, sequenceId, taskId: selectedTaskId })
      : Directing.directingStoryboardList({ projectId, chapterId, sequenceId, canvasId: targetId })
    void request.then(response => {
      if (!active || version !== load.current) return
      const row = Array.isArray(response.data) ? response.data[0] : response.data
      if (row && row.canvas_id !== targetId) throw new Error('此分镜任务不属于当前画布')
      setTask(row ?? undefined)
    }).catch(cause => { if (active && version === load.current) setError(directingError(cause)) })
    return () => { active = false; request.cancel() }
  }, [projectId, chapterId, sequenceId, targetId, selectedTaskId, navigationKey, key])

  const showConfig = !!draft
  useEffect(() => {
    if (!showConfig) return
    let active = true
    const operation = LlmService.listModelsApiV1LlmModelsGet({ pageSize: 100 })
    setModelError('')
    void operation.then(response => {
      if (active) setModels(response.data?.items || [])
    }).catch(() => { if (active) setModelError('无法读取生产模型，可以稍后在画布中选择。') })
    return () => { active = false; operation.cancel() }
  }, [showConfig])

  const close = () => { wait.current = undefined; setDraft(undefined); setWaiting(false) }
  const settle = (result: StoryboardTaskRead) => {
    setTask(result); setError('')
    const flow = wait.current
    if (!flow || flow.taskId !== result.task_id || !isLive(flow) || activeTask(result)) return
    if (document.visibilityState !== 'visible') { wait.current = undefined; return }
    close()
    if (result.status === 'succeeded' && result.candidate) {
      resultHandler.current(result, true)
    }
  }
  const latestSettle = useRef(settle); latestSettle.current = settle
  const taskId = task?.task_id
  const polling = activeTask(task)
  useEffect(() => {
    if (!taskId || !polling) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      try {
        const response = await Directing.directingStoryboardGet({ projectId, chapterId, sequenceId, taskId })
        if (!active) return
        if (!response.data) throw new Error('分镜任务状态未返回')
        latestSettle.current(response.data)
        if (activeTask(response.data)) timer = setTimeout(() => void read(), 1000)
      } catch (cause) {
        if (active) { setError(directingError(cause)); timer = setTimeout(() => void read(), 2500) }
      }
    }
    timer = setTimeout(() => void read(), 350)
    return () => { active = false; clearTimeout(timer) }
  }, [projectId, chapterId, sequenceId, taskId, polling, navigationKey])

  const start = () => {
    if (polling) { setWaiting(true); return }
    if (pending) { setDraft(pending.body); return }
    setDraft({ request_id: crypto.randomUUID(), mode: 'complete',
      production_model_id: target.productionModelId, pending_modality: target.pendingModality })
    setError('')
  }
  const submit = async (submission: Submission, follow = false) => {
    if (!editable || sending.current) return
    try {
      const stored = pendingSubmission(key)
      if (stored && stored.body.request_id !== submission.body.request_id) {
        setPending(stored); close(); throw new Error('请先核实此前的分镜提交')
      }
      localStorage.setItem(key, JSON.stringify(submission))
    } catch (cause) { setError(directingError(cause)); return }
    const captured = live.current
    const flow: typeof wait.current = follow && captured ? { ...captured } : undefined
    wait.current = flow
    ++load.current; sending.current = true
    setPending(submission); setSubmitting(true); setError('')
    const clear = () => {
      try {
        if (pendingSubmission(key)?.body.request_id === submission.body.request_id) localStorage.removeItem(key)
      } catch { /* 原请求身份可安全重放。 */ }
      if (mounted.current) setPending(pendingSubmission(key))
    }
    try {
      const response = await Directing.directingStoryboardReextract({ ...scope, canvasId: targetId, requestBody: submission.body })
      if (!response.data) throw new Error('分镜提交结果待核实')
      clear()
      if (!captured || !isLive(captured)) return
      if (flow && wait.current === flow) {
        flow.taskId = response.data.task_id
        setWaiting(activeTask(response.data))
      }
      setDraft(undefined)
      latestSettle.current(response.data)
    } catch (cause) {
      if (cause instanceof ApiError && [400, 404, 409, 422].includes(cause.status)) clear()
      if (captured && isLive(captured)) setError(directingError(cause))
    } finally {
      sending.current = false
      if (captured && isLive(captured)) setSubmitting(false)
    }
  }
  const viewResult = async () => {
    if (!taskId || checking) return
    const captured = live.current
    setChecking(true); setError('')
    try {
      const response = await Directing.directingStoryboardGet({ ...scope, taskId })
      if (!captured || !isLive(captured) || !response.data) return
      setTask(response.data)
      if (response.data.candidate) {
        close()
        resultHandler.current(response.data, false)
      }
    } catch (cause) {
      if (captured && isLive(captured)) setError(directingError(cause))
    } finally { if (captured && isLive(captured)) setChecking(false) }
  }
  const failed = task?.status === 'failed' || task?.status === 'cancelled'
  return <>
    <Space wrap>
      <Button variant="primary" onClick={start} disabled={!editable}>{action}</Button>
      {!open && task && <span role="status">{taskLabel(task)}</span>}
      {!open && task?.review_state === 'incomplete' &&
        <Button onClick={() => onReviewRetry(task.task_id)}>前往重试审查</Button>}
      {!open && pending && <Button loading={submitting} disabled={!editable} onClick={() => void submit(pending)}>核实提交</Button>}
      {!open && task?.status === 'succeeded' && task.candidate_available &&
        <Button loading={checking} onClick={() => void viewResult()}>查看分镜结果</Button>}
    </Space>
    {!open && pending && !submitting && <Alert type="warning" message="分镜提交结果待核实，将使用原请求身份。" />}
    {!open && error && <Alert type="warning" showIcon message={error} />}
    {failed && task.error && <Alert type="error" showIcon message={task.error} />}
    <WorkbenchModal title={action} open={open} width={480} onCancel={close}
      footer={waiting ? <WorkbenchDialogActions
        secondary={<Button onClick={close}>{polling ? '后台继续' : '关闭'}</Button>}>
        {task?.status === 'succeeded' && task.candidate_available && <Button loading={checking} onClick={() => void viewResult()}>查看分镜结果</Button>}
      </WorkbenchDialogActions>
        : <WorkbenchDialogActions secondary={<Button variant="quiet" onClick={close}>取消</Button>}>
          <Button variant="primary" loading={submitting} onClick={() => {
            if (pending) void submit(pending)
            else if (draft) void submit({ kind: 'reextract', body: draft }, true)
          }}>{pending ? '核实提交' : '开始提取'}</Button>
        </WorkbenchDialogActions>}>
      {waiting && task ? <>
        <p role="status">{taskLabel(task)}</p>
        <p>可以关闭此窗口继续工作，分镜任务会在后台完成。</p>
      </> : <Space direction="vertical" style={{ width: '100%' }}>
        <Radio.Group aria-label="分镜模式" value={draft?.mode} disabled={!!pending}
          onChange={event => {
            const mode: StoryboardReextractRequest['mode'] = event.target.value
            setDraft(value => value && { ...value, mode })
          }}
          options={[
            { value: 'complete', label: '自动产出完整分镜' },
            { value: 'faithful', label: '忠实提取' },
          ]} />
        <p>{draft?.mode === 'faithful'
          ? '保留原文明示内容，未写明的设计保持待确定。'
          : '保留原文事实，为适用镜头补充设计建议，仍不确定的内容保留待确定。'}</p>
        {target.sourceChanged && (target.sourceReady
          ? <Checkbox checked={draft?.adopt_current_source || false} disabled={!!pending}
            onChange={event => setDraft(value => value && { ...value, adopt_current_source: event.target.checked })}>采用章节最新已确认原文</Checkbox>
          : <Alert type="warning" showIcon message="仍可使用画布的固定原文。采用章节新版前，请先确认场次范围。"
            action={<Button variant="quiet" onClick={target.confirmSource}>在章节确认新范围</Button>} />)}
        <Select aria-label="生产模型" placeholder="稍后配置生产模型" allowClear value={draft?.production_model_id || undefined}
          style={{ width: '100%' }} disabled={!!pending}
          options={models.filter(model => ['image', 'video'].includes(model.category)).map(model => ({ value: model.id, label: model.name }))}
          onChange={production_model_id => setDraft(value => value && { ...value, production_model_id })} />
        {!draft?.production_model_id && <Radio.Group aria-label="待配置卡片类型" value={draft?.pending_modality || 'image'} disabled={!!pending}
          options={[{ value: 'image', label: '图片模型卡' }, { value: 'video', label: '视频模型卡' }]}
          onChange={event => {
            const pending_modality: StoryboardReextractRequest['pending_modality'] = event.target.value
            setDraft(value => value && { ...value, pending_modality })
          }} />}
        {modelError && <Alert type="warning" showIcon message={modelError} />}
      </Space>}
      {error && <Alert type="warning" showIcon message={error} />}
    </WorkbenchModal>
  </>
}
