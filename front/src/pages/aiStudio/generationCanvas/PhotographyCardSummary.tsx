import { Tooltip } from 'antd'
import type { VisualStyleCard } from '../../../services/generated'
import { designSummary } from './designSummary'
import { DesignPurposeIllustration } from './DesignPurposeIllustration'
import './photographyCard.css'

function SummaryRows({ rows }: { rows: { label: string; text: string }[] }) {
  return rows.length ? <><dl>{rows.slice(0, 2).map(row => <div key={row.label}><dt>{row.label}</dt><Tooltip title={row.text} trigger={['hover', 'focus']} overlayStyle={{ pointerEvents: 'none' }}><dd tabIndex={0} aria-label={`${row.label}：${row.text}`}>{row.text}</dd></Tooltip></div>)}</dl>{rows.length > 2 && <small>另有 {rows.length - 2} 项设计</small>}</> : null
}

export function VisualStyleCardSummary({ card }: { card: VisualStyleCard }) {
  const fields = card.fields || {}
  const rows = [{ label: '风格方向', text: designSummary([], [fields.direction, fields.visual_features]) }, { label: '色彩与材质', text: designSummary([], [fields.colors, fields.materials, fields.notes]) }].filter(row => row.text)
  return <section className="design-card-summary" aria-label="画面风格摘要">
    <DesignPurposeIllustration style />
    {rows.length ? <SummaryRows rows={rows} /> : <div className="design-card-empty"><strong>尚未填写风格设计</strong><p>定义风格方向、色彩与材质倾向</p></div>}
  </section>
}
