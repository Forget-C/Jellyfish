import { useEffect, useRef, useState } from 'react'
import { Alert, Input, Select, Space } from 'antd'
import { LlmService, StudioDirectingService } from '../../../services/generated'
import type { ModelRead, StoryboardRequest, StoryboardTaskRead } from '../../../services/generated'
import { directingError } from './common'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import { WorkbenchDialogActions, WorkbenchModal } from './ui/WorkbenchModal'

type Scope = { projectId: string; chapterId: string; sequenceId: string }
const terminal = new Set(['succeeded', 'failed', 'cancelled'])

/** 当前准备流只提交文本任务。真正的画布应用由编辑工作区核对本地和保存基线。 */
export function SceneStoryboardPreparation({ scope, editable, nameForNewCanvas, onCompleted }: {
  scope: Scope; editable: boolean; nameForNewCanvas: () => string; onCompleted: (result: StoryboardTaskRead) => void;
}) {
  const [request, setRequest] = useState<StoryboardRequest>()
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [task, setTask] = useState<StoryboardTaskRead>()
  const [models, setModels] = useState<ModelRead[]>([])
  const [modelError, setModelError] = useState('')
  const open = request !== undefined
  const completion = useRef(onCompleted)
  completion.current = onCompleted
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    if (!open) return
    let active = true
    const operation = LlmService.listModelsApiV1LlmModelsGet({ pageSize: 100 })
    setModelError('')
    void operation.then(response => {
      if (active) setModels(response.data?.items || [])
    }).catch(() => { if (active) setModelError('无法读取生产模型，可以稍后在画布中选择。') })
    return () => { active = false; operation.cancel() }
  }, [open])
  const taskId = task?.task_id
  const taskStatus = task?.status
  const { projectId, chapterId, sequenceId } = scope
  useEffect(() => {
    if (!taskId || !taskStatus || terminal.has(taskStatus)) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      try {
        const response = await StudioDirectingService.directingStoryboardGet({ projectId, chapterId, sequenceId, taskId })
        if (!active) return
        const result = response.data
        if (!result) throw new Error('分镜任务状态未返回')
        setError(''); setTask(result)
        if (result.status === 'succeeded') completion.current(result)
        else if (!terminal.has(result.status)) timer = setTimeout(() => void read(), 1200)
      } catch (cause) {
        if (active) {
          setError(directingError(cause)); timer = setTimeout(() => void read(), 3000)
        }
      }
    }
    timer = setTimeout(() => void read(), 450)
    return () => { active = false; clearTimeout(timer) }
  }, [projectId, chapterId, sequenceId, taskId, taskStatus])
  const start = () => {
    setRequest({ request_id: crypto.randomUUID(), name: nameForNewCanvas(), mode: 'faithful' })
    setSent(false); setError('')
  }
  const submit = async () => {
    if (!request || submitting) return
    setSubmitting(true); setSent(true); setError('')
    try {
      const response = await StudioDirectingService.directingStoryboardSubmit({ ...scope, requestBody: request })
      if (!alive.current) return
      if (!response.data) throw new Error('分镜提交结果待核实')
      setTask(response.data); setRequest(undefined); setSent(false)
      if (response.data.status === 'succeeded') completion.current(response.data)
    } catch (cause) {
      if (alive.current) setError(directingError(cause))
    } finally { if (alive.current) setSubmitting(false) }
  }
  const inProgress = !!task && !terminal.has(task.status)
  return <>
    <Space wrap>
      <Button variant="primary" onClick={start} disabled={!editable || inProgress}>生成分镜</Button>
      {inProgress && <span role="status">{task.status === 'queued' ? '分镜任务排队中' : '正在提取分镜'} · {task.stage}</span>}
    </Space>
    {!open && error && <Alert type="warning" showIcon message={error} />}
    {task?.status === 'failed' && <Alert type="error" showIcon message={task.error || '分镜提取失败，可重新生成分镜。'} />}
    <WorkbenchModal title="生成分镜" open={open} width={480}
      closable={!submitting} keyboard={!submitting} maskClosable={!submitting}
      onCancel={() => { if (!submitting) setRequest(undefined) }}
      footer={<WorkbenchDialogActions secondary={<Button variant="quiet" disabled={submitting} onClick={() => setRequest(undefined)}>取消</Button>}>
        <Button variant="primary" loading={submitting} onClick={() => void submit()}>{sent ? '核实提交' : '开始提取'}</Button>
      </WorkbenchDialogActions>}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <p>忠实提取 · 保留原文明示内容，未写明的设计保持待确定。</p>
        <label htmlFor="scene-storyboard-name">画布名称</label>
        <Input id="scene-storyboard-name" maxLength={255} value={request?.name || ''} disabled={sent}
          onChange={event => setRequest(value => value && { ...value, name: event.target.value })} />
        <Select aria-label="生产模型" placeholder="稍后配置生产模型" allowClear value={request?.production_model_id || undefined}
          style={{ width: '100%' }} disabled={sent}
          options={models.filter(model => ['image', 'video'].includes(model.category)).map(model => ({ value: model.id, label: model.name }))}
          onChange={production_model_id => setRequest(value => value && { ...value, production_model_id })} />
        {modelError && <Alert type="warning" showIcon message={modelError} />}
        {error && <Alert type="error" showIcon message={error} />}
      </Space>
    </WorkbenchModal>
  </>
}
