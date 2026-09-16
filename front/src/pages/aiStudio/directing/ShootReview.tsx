import { Button, Select, Space, Tag } from 'antd'
import type { DirectingTaskRead, ReviewPacket, SceneDesign_Output, WorkspaceRead } from '../../../services/generated'
import { ReviewDetails } from './ReviewDetails'

const roles = { direction: '导演设计', performance: '表演动作', staging: '场面调度', cinematography: '摄影构图', continuity: '连续性', prompt: '提示词' }

/** 结论、保存与可执行分别表达；通过项收起，问题保留原始依据。 */
export function ShootReview({ packet, pending, reviews, selectedId, promptName, design, onSelect, onResolve }: {
  packet?: ReviewPacket; pending?: DirectingTaskRead; reviews: WorkspaceRead['reviews']; selectedId?: string;
  promptName: string;
  design?: SceneDesign_Output; onSelect: (id: string) => void; onResolve: (row: ReviewPacket['rows'][number]) => void;
}) {
  if (!packet) return null
  const passed = packet.rows.filter(row => row.verdict === 'pass').length
  return <section className="shoot-review-report" data-workspace-target="review" tabIndex={-1} aria-label="本次检查结论">
    <header><h2>检查结论</h2><Space wrap><Tag color={passed === packet.rows.length ? 'green' : 'orange'}>{passed} 项通过{passed < packet.rows.length ? ` · ${packet.rows.length - passed} 项待处理` : ''}</Tag><span>{pending ? '检查完成 · 结论待确认' : '结论已保存'}</span></Space></header>
    <p className="design-secondary">本次检查对应：{promptName}</p>
    {pending && <p className="design-secondary">确认结论只保存本次检查，不会自动生成视频。</p>}
    {!pending && reviews.length > 1 && <Select aria-label="选择本次审稿" value={selectedId} placeholder="明确选择检查版本" options={reviews.map((row, index) => ({ value: row.id, label: `检查 ${index + 1}${row.parent_id ? ' · 含人工取舍' : ''}` }))} onChange={onSelect} />}
    {packet.rows.map(row => <details className="shoot-review-row" key={`${row.role}:${row.occurrence_id}`} open={row.verdict !== 'pass'}>
      <summary><span className={`shoot-review-mark is-${row.verdict}`}>{row.verdict === 'pass' ? '✓' : '!'}</span><strong>{roles[row.role]}</strong><span>{row.verdict === 'pass' ? '通过' : row.verdict === 'pending' ? '待检查' : '需修改'}</span><span className="shoot-review-rationale">{row.rationale}</span></summary>
      <ReviewDetails row={row} design={design} />
      {!pending && row.verdict === 'revise' && <Button onClick={() => onResolve(row)}>记录人工取舍</Button>}
    </details>)}
  </section>
}
