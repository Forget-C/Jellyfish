import { uiText, useUiText } from '../../../uiText'
import { useEffect, useRef, useState } from 'react'
import { Alert } from 'antd'
import { ApiError, StudioDirectingService as Directing } from '../../../services/generated'
import type { CanvasRead, StoryboardApplication, StoryboardTaskRead } from '../../../services/generated'
import type { StoryboardReviewPreparation, StoryboardScope } from '../generationCanvas/useGenerationCanvasEditor'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { SceneStoryboardReview, StoryboardReviewFindings } from './SceneStoryboardReview'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import { WorkbenchModal } from '../../../components/workbench/WorkbenchModal'

type Scope = Omit<StoryboardScope, 'taskId'> & { projectId: string }

function active(task?: StoryboardTaskRead) {
  return task?.status === 'queued' || task?.status === 'running'
}

function statusLabel(task: StoryboardTaskRead) {
  if (task.status === 'queued') return uiText("连续性检查排队中")
  if (task.status === 'running') return uiText("正在检查分镜连续性")
  if (task.status === 'failed' || task.status === 'cancelled') return uiText("连续性检查未完成")
  if (task.review_state === 'stale') return uiText("检查依据已变")
  if (task.review_state === 'accepted') return uiText("已接受检查风险")
  if (task.review_state === 'conflict') return uiText("检查发现设计冲突")
  if (task.review_state === 'warning') return uiText("部分连续性依据不足")
  if (task.pending_application) return uiText("检查修正待确认")
  return uiText("连续性检查通过")
}

/** Only the workbench offers explicit inspection of a previously saved storyboard. */
export function SceneStoryboardCheck({ scope, current, editable, saving, prepare, apply, reload }: {
  scope: Scope; current: CanvasRead; editable: boolean; saving: boolean;
  prepare: () => Promise<StoryboardReviewPreparation | undefined>;
  apply: (scope: StoryboardScope, choice: StoryboardApplication) => Promise<boolean>;
  reload: () => Promise<boolean>;
}) {
  useUiText()
  const { projectId, chapterId, sequenceId } = scope
  const canvasId = current.id
  const [task, setTask] = useState<StoryboardTaskRead>()
  const [appliedCheck, setAppliedCheck] = useState<StoryboardTaskRead>()
  const [submitting, setSubmitting] = useState(false)
  const [reportOpen, setReportOpen] = useState<'latest' | 'applied'>()
  const [error, setError] = useState('')
  const intent = useRef<{ requestId: string; taskId?: string; revision?: number }>()
  useEffect(() => {
    let live = true
    const request = Directing.directingSavedStoryboardCheckGet({ projectId, chapterId, sequenceId, canvasId })
    void request.then(({ data }) => {
      if (live) setTask(data ?? undefined)
    }).catch(cause => { if (live) setError(apiErrorMessage(cause)) })
    return () => { live = false; request.cancel() }
  }, [projectId, chapterId, sequenceId, canvasId, current.revision])

  const taskId = task?.task_id
  const appliedId = current.document.storyboard?.continuity_check_task_id
  useEffect(() => {
    setAppliedCheck(undefined)
    if (!appliedId || appliedId === taskId) return
    let live = true
    const request = Directing.directingStoryboardGet({ projectId, chapterId, sequenceId, taskId: appliedId })
    void request.then(({ data }) => {
      if (live) setAppliedCheck(data ?? undefined)
    }).catch(cause => { if (live) setError(apiErrorMessage(cause)) })
    return () => { live = false; request.cancel() }
  }, [appliedId, taskId, projectId, chapterId, sequenceId, current.revision])
  const polling = active(task)
  useEffect(() => {
    if (!taskId || !polling) return
    let live = true
    let timer: number
    const read = async () => {
      try {
        const { data } = await Directing.directingStoryboardGet({ projectId, chapterId, sequenceId, taskId })
        if (!live) return
        if (!data) throw new Error(uiText("未返回检查任务状态"))
        setTask(data)
        if (active(data)) timer = window.setTimeout(() => void read(), 800)
      } catch (cause) {
        if (live) { setError(apiErrorMessage(cause)); timer = window.setTimeout(() => void read(), 1600) }
      }
    }
    timer = window.setTimeout(() => void read(), 250)
    return () => { live = false; window.clearTimeout(timer) }
  }, [projectId, chapterId, sequenceId, taskId, polling])

  const submit = async (retryId?: string) => {
    if (submitting || !editable) return
    setSubmitting(true); setError('')
    try {
      if (!intent.current) {
        const prepared = await prepare()
        if (!prepared) throw new Error(uiText("请先解决画布保存问题"))
        intent.current = { requestId: crypto.randomUUID(), taskId: retryId, revision: prepared.revision }
      }
      const request = intent.current
      const response = request.taskId
        ? await Directing.directingStoryboardRetry({ ...scope, taskId: request.taskId, requestBody: { request_id: request.requestId } })
        : await Directing.directingSavedStoryboardCheckSubmit({ ...scope, canvasId,
            requestBody: { request_id: request.requestId, expected_revision: request.revision! } })
      if (!response.data?.saved_check || response.data.canvas_id !== canvasId) throw new Error(uiText("检查提交结果待核实"))
      intent.current = undefined
      setTask(response.data)
    } catch (cause) {
      if (cause instanceof ApiError && [400, 404, 409, 422].includes(cause.status)) intent.current = undefined
      setError(apiErrorMessage(cause))
    } finally { setSubmitting(false) }
  }

  const retryable = task?.status === 'failed' || task?.status === 'cancelled'
  const appliedRisks = appliedCheck?.review?.issues.some(issue => issue.kind === 'conflict')
  const visibleReport = reportOpen === 'applied' ? appliedCheck : task
  return <>
    <Button disabled={!editable || polling || saving} loading={submitting} onClick={() => void submit()}>
      {intent.current ? uiText("核实检查提交") : uiText("检查分镜连续性")}
    </Button>
    {task && (polling || retryable || task.pending_application) && <span role="status">{statusLabel(task)}</span>}
    {retryable && !intent.current && <Button disabled={!editable || submitting} onClick={() => void submit(task?.task_id)}>{uiText("重试检查")}</Button>}
    {(task?.review || task?.error || error) && <Button onClick={() => setReportOpen('latest')}>{uiText("查看检查报告")}</Button>}
    {appliedRisks && <Button onClick={() => setReportOpen('applied')}>
      {appliedCheck?.review_state === 'stale' ? uiText("已接受的检查风险依据已变") : uiText("查看已接受的检查风险")}
    </Button>}
    {task?.pending_application && task.review_state !== 'stale' && <SceneStoryboardReview savedCheck repairDetails={task.repair_details}
      key={task.task_id} scope={{ ...scope, taskId: task.task_id }} editable={editable} prepare={prepare} reload={reload}
      applying={saving} report={task.review} candidate={task.candidate} onRepaired={setTask}
      apply={choice => apply({ chapterId, sequenceId, taskId: task.task_id }, choice)} />}
    <WorkbenchModal title={uiText("分镜连续性检查报告")} open={!!reportOpen} onCancel={() => setReportOpen(undefined)} footer={null}>
      {visibleReport && <p>{statusLabel(visibleReport)} {uiText("· 检查已保存的分镜设计与依赖")}</p>}
      {(error || visibleReport?.error) && <Alert type="warning" showIcon message={error || visibleReport?.error} />}
      {!!visibleReport?.review?.issues.length && <StoryboardReviewFindings report={visibleReport.review}
        candidate={visibleReport.candidate ?? { base_revision: current.revision, document: current.document }} />}
    </WorkbenchModal>
  </>
}
