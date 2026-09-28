import { useContext } from 'react'
import { Alert, Button, Tag } from 'antd'
import type { DirectingTaskRead, ReviewPacket, WorkspaceRead } from '../../../services/generated'
import { ReviewDetails } from './ReviewDetails'
import { reviewPacketComplete } from './workspaceGuidance'
import { contextForPrompt, readableSegments } from './readableText'
import { ProductionDetailContext } from './ProductionWorkbench'

const roles = { direction: '导演设计', performance: '表演动作', staging: '场面调度', cinematography: '摄影构图', continuity: '连续性', prompt: '提示词' }

/** 按检查出现项呈现问题；通过条目合并，统计不混入发现数量。 */
export function ShootReview({ packet, pending, derived, promptName, workspace, onResolve, onSave, busy }: {
  onSave?: () => void; busy?: boolean; packet?: ReviewPacket; pending?: DirectingTaskRead; derived?: boolean; promptName: string;
  workspace: WorkspaceRead; onResolve: (row: ReviewPacket['rows'][number]) => void;
}) {
  const detail = useContext(ProductionDetailContext)
  if (!packet) return null
  const passed = packet.rows.filter(row => row.verdict === 'pass')
  const problems = packet.rows.filter(row => row.verdict !== 'pass')
  const complete = reviewPacketComplete(packet)
  const groups = [...new Set(problems.map(row => row.occurrence_id))]
  const context = (id: string) => contextForPrompt(workspace, packet.occurrences.find(item => item.id === id)?.prompt_revision_id)
  const label = (id: string) => {
    const occurrence = packet.occurrences.find(item => item.id === id)
    const index = context(id).design?.direction.shots.findIndex(shot => shot.id === occurrence?.shot_id) ?? -1
    return `${index < 0 ? '历史镜头暂不可用' : `镜头 ${String(index + 1).padStart(2, '0')}`} · 出现 ${occurrence?.local_number ?? '未知'}`
  }
  return <section className="shoot-review-report" data-workspace-target="review" tabIndex={-1} aria-label="本次检查结论">
    <header><h2>检查结果</h2>{(['revise', 'pending'] as const).map(verdict => {
      const count = problems.filter(row => row.verdict === verdict).length
      return count ? <Tag key={verdict} color={verdict === 'revise' ? 'orange' : 'default'}>{count} 项{verdict === 'revise' ? '需修改' : '待检查'}</Tag> : null
    })}<span className="shoot-passed-count">{passed.length} 项通过</span><small>{pending ? '结论待确认' : '结论已保存'}{derived ? ' · 含人工取舍' : ''}</small></header>
    <p className="sr-only">本次检查对应：{promptName}</p>
    {!complete && <Alert type="warning" message={packet.mode === 'formal' ? '检查记录不完整，不能判定全部通过；请核对检查记录。' : '这是咨询记录，不能代替正式六岗检查。'} />}
    {groups.map(id => <section className="shoot-review-group" key={id}><h3>{label(id)}</h3>{problems.filter(row => row.occurrence_id === id).map((row, index) => <details className="shoot-review-row" key={`${row.role}:${index}`} open={problems.length <= 6 || row === problems[0]} data-review-problem tabIndex={-1}>
      <summary><span className={`shoot-review-mark is-${row.verdict}`}>!</span><strong>{roles[row.role]}</strong><span>{row.verdict === 'pending' ? '待检查' : '需修改'}</span><span className="shoot-review-rationale">{readableSegments(row.rationale || '未提供结论说明', context(row.occurrence_id)).map(part => part.label).join('')}</span></summary>
      <ReviewDetails row={row} context={context(row.occurrence_id)} compact onInspect={paths => detail.show({ tab: 'text', paths })} />
      {!pending && row.verdict === 'revise' && <Button onClick={() => onResolve(row)}>记录人工取舍</Button>}
    </details>)}</section>)}
    {!!passed.length && <details className="shoot-passed-summary"><summary>✓ 已通过 {passed.length} 项 · 展开检查明细</summary>{passed.map((row, index) => <details className="shoot-review-row" key={`${row.occurrence_id}:${row.role}:${index}`}><summary><strong>{label(row.occurrence_id)} · {roles[row.role]}</strong><span>通过</span></summary><ReviewDetails row={row} context={context(row.occurrence_id)} compact onInspect={paths => detail.show({ tab: 'text', paths })} /></details>)}</details>}
    {pending && problems.length > 0 && onSave && <Button loading={busy} onClick={onSave}>保存检查结论</Button>}
    {pending && <p className="design-secondary">确认结论只保存本次检查，不会自动生成视频。</p>}
  </section>
}
