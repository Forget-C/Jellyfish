import { persistSceneChange } from './sceneCanvasPersistence'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Drawer, Space, Spin } from 'antd'
import { StudioDirectingService as Directing, type SceneCanvasSummary, type StoryboardTaskRead } from '../../../services/generated'
import { useGenerationCanvasEditor } from '../generationCanvas/useGenerationCanvasEditor'
import { SceneStoryboardReview, StoryboardReviewFindings } from './SceneStoryboardReview'
import { WorkbenchStoryboardRetry } from './WorkbenchStoryboardRetry'
import { apiErrorMessage } from '../../../services/apiErrorMessage'

/** 管理页处理候选；共同编辑器保留保存、修订、应用回执与撤销校验。 */
export function WorkbenchStoryboardReview({ projectId, chapterId, sequenceId, canvas, historical, onClose, onChange, onSubmissionChange, onEnter, onReviewSource, quickEntry = false }: {
  quickEntry?: boolean
  projectId: string; chapterId: string; sequenceId: string; canvas: SceneCanvasSummary; historical: boolean
  onClose: () => void; onChange: (acceptedTaskId?: string) => void; onEnter: () => void; onReviewSource: () => void
  onSubmissionChange: (submitting: boolean) => void
}) {
  const editor = useGenerationCanvasEditor(projectId, canvas.id, false, persistSceneChange)
  const [loadedTask, setTask] = useState<StoryboardTaskRead>()
  const [error, setError] = useState('')
  const [actionHost, setActionHost] = useState<HTMLDivElement | null>(null)
  const [refresh, setRefresh] = useState(0)
  const entering = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const taskId = canvas.latest_storyboard?.task_id ?? canvas.candidate_storyboard_task_id
  useEffect(() => {
    if (!taskId) return
    let active = true
    setError('')
    const request = Directing.directingStoryboardGet({ projectId, chapterId, sequenceId, taskId })
    void request.then(({ data }) => { if (active && data) setTask(data) })
      .catch(cause => { if (active) setError(apiErrorMessage(cause)) })
    return () => { active = false; request.cancel() }
  }, [projectId, chapterId, sequenceId, taskId, canvas.latest_storyboard?.status, canvas.latest_storyboard?.stage, refresh])
  const task = loadedTask?.task_id === taskId ? loadedTask : undefined
  const ownership = editor.ownership
  const matched = editor.current?.scene?.chapter_id === chapterId && editor.current.scene.sequence_id === sequenceId
  const finishApplication = () => {
    editor.handoffStoryboardApplication(); onChange()
    if (mounted.current) onEnter()
  }
  const enter = async () => {
    if (!task || entering.current) return
    entering.current = true
    const prepared = await editor.prepareReview()
    if (prepared && await editor.applyReviewedCandidate({ chapterId, sequenceId, taskId: task.task_id },
      { expected_revision: prepared.revision, overwrite_card_ids: [] })) {
      finishApplication()
    }
  }
  useEffect(() => {
    if (quickEntry && matched && task?.status === 'succeeded' && task.candidate &&
      !task.pending_application && !task.repair_details && !task.structure_issues?.length && !task.retry_of_task_id && ownership.editable && !editor.recovery && !editor.conflict) void enter()
  })
  return <Drawer className="app-detail-drawer management-storyboard-review" open aria-label="处理分镜提取结果" title="处理分镜提取结果" width="min(720px, 100vw)" onClose={onClose}
    footer={<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <Button onClick={onClose}>暂不处理</Button><div ref={setActionHost} />
    </div>}>
    {/* 当前 Drawer 版本不透传可访问名称到 dialog 面板。 */}
    <div ref={node => node?.closest('[role="dialog"]')?.setAttribute('aria-label', '处理分镜提取结果')}>
    <Space direction="vertical" style={{ width: '100%' }}>
      <h3>{canvas.name}</h3>
      <p>修正与风险确认只影响候选，应用后才更新画布。</p>
      {(error || editor.error) && <Alert showIcon type="error" message={error || editor.error} action={error && <Button onClick={() => setRefresh(value => value + 1)}>重试读取任务</Button>} />}
      {!task && !error && <Spin aria-label="正在读取分镜问题" />}
      {!ownership.editable && <Alert type="warning" showIcon message={ownership.message || '请先结束其他页面的编辑，再取得编辑权。'}
        action={<Button onClick={ownership.takeEditing}>取得编辑权</Button>} />}
      {ownership.state === 'choice' && <Space>
        <Button onClick={() => ownership.chooseHandoff('save')}>保存后交接</Button>
        <Button onClick={() => ownership.chooseHandoff('discard')}>放弃后交接</Button>
        <Button onClick={ownership.cancelHandoff}>取消交接</Button>
      </Space>}
      {editor.storageError && <Alert type="warning" showIcon message={editor.storageError} />}
      {editor.conflict && <Alert type="warning" message="画布已有并发修改，请核对最新内容后重新确认差异。"
        action={<Button onClick={() => editor.reload()}>使用服务器内容并重新核对</Button>} />}
      {editor.recovery && <Alert type="warning" message="发现本地未保存内容，请核实后继续。" action={<Space>
        <Button disabled={!ownership.editable} onClick={editor.restore}>恢复本地内容</Button>
        <Button disabled={!ownership.editable} onClick={() => editor.reload()}>使用服务器内容</Button>
      </Space>} />}
      {(task?.status === 'queued' || task?.status === 'running') && <p role="status">提取或审查正在进行，关闭后可继续查看进度。</p>}
      {task?.error && task.status !== 'failed' && task.status !== 'cancelled' && <Alert type={task.structure_issues?.length ? 'warning' : 'error'} showIcon
        message={task.structure_issues?.length ? '提取结果需要处理，请核对下方问题并选择处理方式。' : '提取未完成，请核对依据后重试。'}
        description={!task.structure_issues?.length && <details><summary>查看失败原因</summary>{task.error}</details>} />}
      {task?.status === 'failed' && task.repair_details && <details><summary>查看此前候选与修正记录</summary>
        <p>{task.repair_details.reason}</p>
        <StoryboardReviewFindings report={task.repair_details.before_review} candidate={task.candidate} />
        {task.repair_details.changes?.map((change, index) => <p key={index}>{change.field_id}：{change.before} → {change.after}</p>)}
      </details>}
      {task?.candidate && task.status === 'succeeded' && task.task_id !== editor.current?.document.storyboard?.task_id &&
        <SceneStoryboardReview key={task.task_id} inline actionHost={actionHost} onAlreadyApplied={finishApplication} scope={{ projectId, chapterId, sequenceId, taskId: task.task_id }}
          editable={!!matched && ownership.editable && !editor.recovery && !editor.conflict}
          prepare={editor.prepareReview} reload={editor.reload} applying={editor.saving} saveError={editor.error}
          report={task.review} candidate={task.candidate} repairDetails={task.repair_details} structureIssues={task.structure_issues}
          reviewedOverwrite={task.reviewed_overwrite_card_ids} onOpenCanvas={canvas.applied_storyboard_task_id ? onEnter : undefined}
          onRepairAccepted={onChange} onRepairSubmissionChange={onSubmissionChange}
          onRepaired={result => { setTask(result); onChange() }}
          apply={async choice => {
            const applied = await editor.applyReviewedCandidate({ chapterId, sequenceId, taskId: task.task_id }, choice)
            if (applied) {
              finishApplication()
            }
            return applied
          }} />}
      {editor.current?.document.storyboard && !editor.recovery && <Button onClick={() => {
        editor.handoffStoryboardApplication(); onEnter()
      }}>进入当前画布</Button>}
      <WorkbenchStoryboardRetry inline actionHost={actionHost} {...{ projectId, chapterId, sequenceId, canvas, historical, onReviewSource }}
        onAccepted={onChange} onSubmissionChange={onSubmissionChange} />
    </Space>
    </div>
  </Drawer>
}
