import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Checkbox, Select, Space, Tag, Typography } from 'antd'
import { FilmService, LlmService, StudioDirectingService } from '../../../services/generated'
import type { BatchRead, WorkspaceRead } from '../../../services/generated'
import { directingError } from './common'

const states: Record<string, string> = { ready: '可执行', blocked: '未受理', queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }

/** 用户先固定选择并预检，再明确受理可执行项；每项保留独立进度和取消。 */
export function BatchPanel({ projectId, workspace, onSubmitted }: { projectId: string; workspace: WorkspaceRead; onSubmitted: () => void }) {
  const sequenceId = workspace.sequence.id
  const [selection, setSelection] = useState<string[]>([])
  const [reviews, setReviews] = useState<Record<string, string>>({})
  const [batches, setBatches] = useState<BatchRead[]>([])
  const [models, setModels] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 状态直接取自服务端批次与任务，刷新不重建选择或重新提交。 */
  const load = useCallback(async () => {
    try { const response = await StudioDirectingService.directingBatches({ projectId, sequenceId }); setBatches(response.data || []) }
    catch (cause) { setError(directingError(cause)) }
  }, [projectId, sequenceId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    void LlmService.listModelsApiV1LlmModelsGet({ category: 'video', pageSize: 100 }).then(response => setModels(Object.fromEntries((response.data?.items || []).map(model => [model.id, model.name])))).catch(cause => setError(directingError(cause)))
  }, [])
  const running = batches.some(batch => batch.items.some(item => ['queued', 'running'].includes(item.status)))
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => { void load() }, 2500)
    return () => window.clearInterval(timer)
  }, [running, load])
  /** 对受理动作统一显示错误，失败时保留原批次以便重放查询同一批任务。 */
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await operation() } catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  return <Card title="批量预检与拍摄" data-workspace-target="batch" tabIndex={-1}>
    <Space direction="vertical" className="w-full">
      {error && <Alert type="error" message={error} />}
      <Typography.Text type="secondary">选择固定提示词及对应审稿。预检不调用模型；确认受理后每项各产生一个请求，失败和取消互不替代，不会自动重试或改动粗剪。</Typography.Text>
      {workspace.prompts.filter(prompt => prompt.confirmed_at).map(prompt => {
        const plan = workspace.plans.find(row => row.id === prompt.content.plan_revision_id)
        const unit = plan?.content.units.find(row => row.id === prompt.content.unit_id)
        const available = workspace.reviews.filter(review => review.confirmed_at && review.content.occurrences.every(item => item.prompt_revision_id === prompt.id))
        return <Space key={prompt.id} wrap>
          <Checkbox checked={selection.includes(prompt.id)} onChange={event => setSelection(event.target.checked ? [...selection, prompt.id] : selection.filter(id => id !== prompt.id))}>提示词 {workspace.prompts.indexOf(prompt) + 1} · 单元 {unit?.id}</Checkbox>
          <Typography.Text>{models[unit?.model_id || ''] || '未找到模型'} · {(unit?.duration_ms || 0) / 1000} 秒 · {unit?.ratio}</Typography.Text>
          <Select aria-label={`提示词 ${workspace.prompts.indexOf(prompt) + 1} 的批量审稿`} placeholder="明确选择对应审稿" className="min-w-64" value={reviews[prompt.id]} options={available.map(review => ({ value: review.id, label: `审稿 ${workspace.reviews.indexOf(review) + 1} · ${review.content.rows.every(row => row.verdict === 'pass') ? '全部通过' : '有待处理项'}` }))} onChange={id => setReviews({ ...reviews, [prompt.id]: id })} />
        </Space>
      })}
      <Space wrap><Button loading={busy} disabled={!selection.length || selection.some(id => !reviews[id])} onClick={() => run(async () => {
        const response = await StudioDirectingService.directingPrepareBatch({ projectId, sequenceId, requestBody: { items: selection.map(id => ({ prompt_revision_id: id, review_revision_id: reviews[id] })) } })
        if (response.data) setBatches(previous => [...previous, response.data!])
      })}>预检所选 {selection.length} 项</Button><Button onClick={() => { void load() }}>刷新批次状态</Button></Space>
      {batches.slice().reverse().map((batch, index) => <Card key={batch.id} size="small" title={`批次 ${batches.length - index} · ${batch.status === 'prepared' ? '待确认受理' : '已受理'}`}>
        <Space direction="vertical" className="w-full">
          {batch.items.map(item => <Space key={item.ordinal} wrap>
            <Typography.Text>单元 {item.unit_id} · {models[item.model_id] || item.model_id} · {item.duration_ms / 1000} 秒 · {item.ratio}</Typography.Text>
            <Tag>{states[item.status]}</Tag>{item.progress !== null && item.progress !== undefined && <Typography.Text>{item.progress}%</Typography.Text>}{item.error && <Typography.Text type="danger">{item.error}</Typography.Text>}
            {item.task_id && ['queued', 'running'].includes(item.status) && <Button onClick={() => run(async () => {
              await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: item.task_id!, requestBody: { reason: '用户取消批次中的单项' } }); await load(); onSubmitted()
            })}>取消此项</Button>}
          </Space>)}
          {batch.status === 'prepared' && <Button type="primary" loading={busy} disabled={!batch.items.some(item => item.status === 'ready')} onClick={() => run(async () => {
            await StudioDirectingService.directingSubmitBatch({ projectId, sequenceId, batchId: batch.id, requestBody: { expected_version: batch.version } }); await load(); onSubmitted()
          })}>确认并提交可执行的 {batch.items.filter(item => item.status === 'ready').length} 项</Button>}
        </Space>
      </Card>)}
    </Space>
  </Card>
}
