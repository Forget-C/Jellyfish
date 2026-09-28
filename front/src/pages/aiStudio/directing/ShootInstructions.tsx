import { useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button, Empty, Tabs, Tag } from 'antd'
import type { DirectingTaskRead, WorkspaceRead } from '../../../services/generated'
import { ProductionDetailContext } from './ProductionWorkbench'
import { PromptReader } from './PromptReader'
import { ShootFixedInput } from './ShootFixedInput'
import { SourceInspector } from './Sources'
import { productionRecords } from './workspaceProduction'
import { pendingReviewResults, reviewPacketPassed } from './workspaceGuidance'
import { revisionName } from './workspaceUsage'

/** 历史预览只保存在阅读器中；只有明确切换才改变工作版本及其检查上下文。 */
export function ShootInstructions({ workspace, planId, unitId, promptId, reviewId, reviewTask, tasks, onPrompt, onReview, regenerate }: {
  workspace: WorkspaceRead; planId?: string; unitId?: string; promptId?: string; reviewId?: string;
  reviewTask?: DirectingTaskRead; tasks: DirectingTaskRead[]; regenerate: ReactNode;
  onPrompt: (id: string) => void; onReview: (id?: string, taskId?: string) => void;
}) {
  const detail = useContext(ProductionDetailContext)
  const [previewId, setPreviewId] = useState<string>()
  const [tab, setTab] = useState('text')
  useEffect(() => { setPreviewId(undefined) }, [promptId, planId, unitId])
  useEffect(() => { if (detail.request && detail.request.tab !== 'candidate') { setTab(detail.request.tab); setPreviewId(undefined) } }, [detail.request])
  const records = productionRecords(workspace, planId, unitId, promptId)
  const current = records.prompt
  const preview = records.prompts.find(row => row.id === previewId) || current
  const historical = !!preview && preview.id !== promptId
  const review = records.reviews.find(row => row.id === reviewId)
  const pending = pendingReviewResults(workspace, tasks, planId, unitId, promptId)
  const name = (id: string) => revisionName(workspace.prompts, id, '试拍指令')
  const checkName = (task: DirectingTaskRead) => `待确认检查 ${tasks.filter(row => row.kind === 'directing_review').findIndex(row => row.task_id === task.task_id) + 1}`
  const checks = <div className="shoot-record-list" data-workspace-target="review" tabIndex={-1}><h3>选择当前指令的检查记录</h3>
    {pending.map(task => <div key={task.task_id} data-review-task={task.task_id}><strong>{checkName(task)}</strong><span>{reviewPacketPassed(task.review, promptId) ? '检查通过' : '待处理或待核对'} · 时间未提供</span><Button aria-pressed={task.task_id === reviewTask?.task_id} onClick={() => { onReview(undefined, task.task_id); detail.close() }}>选择此检查</Button></div>)}
    {records.reviews.map(row => <div key={row.id}><strong>{revisionName(workspace.reviews, row.id, '检查')}{row.parent_id ? ' · 含人工取舍' : ''}</strong><span>{reviewPacketPassed(row.content, promptId) ? '检查通过' : '待处理或待核对'} · {row.confirmed_at ? `保存于 ${row.confirmed_at.replace('T', ' ')}` : '保存时间未提供'}</span><Button aria-pressed={row.id === reviewId} onClick={() => { onReview(row.id); detail.close() }}>选择此检查</Button></div>)}
    {!pending.length && !records.reviews.length && <Empty description="这份指令尚无检查结果" />}
  </div>
  const [copyState, setCopyState] = useState('')
  useEffect(() => { setCopyState('') }, [preview?.id])
  const content = <SourceInspector identity={`${preview?.id}:${tab}`}><header className="shoot-detail-heading"><h2>{preview ? name(preview.id) : '指令版本'}</h2>{historical && <Tag color="orange">历史预览</Tag>}<Button type="text" aria-label="关闭指令详情" onClick={detail.close}>×</Button></header>
    {historical && <Alert type="info" message={`仅查看历史，当前工作对象仍为${current ? name(current.id) : '未选择'}`} action={<Button onClick={() => { onPrompt(preview!.id); setPreviewId(undefined) }}>切换到此版本</Button>} />}
    <Tabs activeKey={tab === 'checks' ? 'history' : tab} onChange={setTab} items={[
      { key: 'text', label: '指令正文', children: preview ? <><p className="design-secondary">{historical ? '历史预览' : '当前检查对象'} · {revisionName(workspace.plans, preview.content.plan_revision_id, '计划')} · 单元 {String(workspace.plans.find(row => row.id === planId)?.content.units.findIndex(row => row.id === unitId)! + 1).padStart(2, '0')}</p><PromptReader key={preview.id} prompt={preview.content} workspace={workspace} inline paths={historical ? undefined : detail.request?.paths} /><Button onClick={() => { void navigator.clipboard.writeText(preview.content.text).then(() => setCopyState('已复制正文'), () => setCopyState('复制失败，请选择正文复制')) }}>复制正文</Button><span role="status">{copyState}</span>{!historical && regenerate}</> : <Empty description="选择指令版本后查看正文" /> },
      { key: 'input', label: '固定输入', children: preview ? <ShootFixedInput key={preview.id} workspace={workspace} prompt={preview} review={historical ? undefined : review} onHistory={() => setTab('history')} /> : <Empty description="尚未选择指令" /> },
      { key: 'history', label: '版本记录', children: tab === 'checks' ? <><Button onClick={() => setTab('history')}>返回指令版本</Button>{checks}</> : <><div className="shoot-record-list">{records.prompts.map(row => {
        const related = productionRecords(workspace, planId, unitId, row.id).reviews
        const waiting = pendingReviewResults(workspace, tasks, planId, unitId, row.id)
        const packets = [...related.map(item => item.content), ...waiting.map(item => item.review)]
        const passed = packets.filter(packet => reviewPacketPassed(packet, row.id)).length
        return <div key={row.id}><strong>{name(row.id)}{row.id === promptId ? ' · 当前工作版本' : ''}</strong><span>{row.confirmed_at ? `固定于 ${row.confirmed_at.replace('T', ' ')}` : '生成时间未提供'} · {packets.length ? `${packets.length} 条检查记录 · ${passed} 通过${packets.length > passed ? ` · ${packets.length - passed} 待处理或待核对` : ''}` : '待检查'}</span><Button onClick={() => { setPreviewId(row.id); setTab('text') }}>查看此版本</Button>{row.id !== promptId && <Button onClick={() => { onPrompt(row.id); setPreviewId(undefined) }}>切换到此版本</Button>}</div>
      })}</div>{current && <Button onClick={() => { setPreviewId(undefined); setTab('checks') }}>当前指令的检查记录 · {pending.length + records.reviews.length}</Button>}</> },
    ]} />
  </SourceInspector>
  return <>
    <div className="shoot-instruction-context" data-workspace-target="prompt-review" tabIndex={-1}>
      <strong>{current ? records.prompts.length === 1 ? '本次指令' : `本次${name(current.id)} · 共${records.prompts.length}版` : '尚未选择指令'}</strong>
      {current && <Button type="link" onClick={() => detail.show({ tab: 'text' })}>查看指令</Button>}
      {(records.prompts.length > 1 || !current) && <Button onClick={() => detail.show({ tab: 'history' })}>{current ? '切换版本' : '选择指令版本'}</Button>}
      {current && <Button type="link" onClick={() => detail.show({ tab: 'input' })}>固定输入</Button>}
      <span className="shoot-check-context">{reviewTask ? `${checkName(reviewTask)} · 待确认结论` : review ? `${revisionName(workspace.reviews, review.id, '检查')} · 已保存${review.parent_id ? ' · 含人工取舍' : ''}` : pending.length + records.reviews.length ? '待选择检查记录' : '待检查'}</span>
      {!!(pending.length + records.reviews.length) && <Button type="text" onClick={() => detail.show({ tab: 'checks' })}>检查记录 · {pending.length + records.reviews.length}</Button>}
    </div>
    {!current && <section className="shoot-record-list" aria-label="选择本次指令"><h3>选择本次要检查的指令</h3>{records.prompts.map(row => <div key={row.id}><strong>{records.prompts.length === 1 ? '本次指令' : name(row.id)}</strong><span>{row.confirmed_at ? `固定于 ${row.confirmed_at.replace('T', ' ')}` : '固定时间暂不可用'}</span><Button onClick={() => onPrompt(row.id)}>使用此指令</Button></div>)}</section>}
    {current && !review && !reviewTask && !!(pending.length + records.reviews.length) && checks}
    {detail.target && detail.request && detail.request.tab !== 'candidate' && createPortal(content, detail.target)}
  </>
}
