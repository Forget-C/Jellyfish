import { isDesignFieldConfigured } from './designFieldConfiguration'
import { useGraphRules } from './CanvasCatalogContext'
import { Tooltip } from 'antd'
import type { CanvasDocument, ReferenceDesignField } from '../../../services/generated'
import type { VisualDesignCard as DesignCard } from './designFieldReferences'
import { photographyRegions, shotSizeLabels } from './photographyDesign'
import { styleLabels } from './visualPresets'
import { DesignPurposeIllustration } from './DesignPurposeIllustration'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import './visualDesignCard.css'

const states: Record<string, string> = { empty: '未填写', not_applicable: '不适用', absent: '明确没有', fact: '事实', undecided: '待确定', proposal: '提议' }
const phases: Record<string, string> = { video: '画面／视频', sound: '声音', postproduction: '后期' }
const relationLabels: Record<string, string> = { effect_object: '作用对象', attention_object: '关注对象', focus_object: '焦点对象', shot: '所属镜头', acceptance_basis: '验收依据' }
const kindOf = (card: DesignCard) => (card.type || 'direction.style').slice('direction.'.length)
const titleOf = (kind: string) => kind === 'style' ? '画面风格' : photographyRegions[kind as keyof typeof photographyRegions].label

/** Configuration describes authored intent, independently from output eligibility or model readiness. */
function cardRows(card: DesignCard, document: CanvasDocument, defaults: Record<string, ReferenceDesignField | undefined>) {
  const kind = kindOf(card), labels: Record<string, string> = kind === 'style' ? styleLabels : photographyRegions[kind as keyof typeof photographyRegions].fields
  const sourceName = (id: string) => {
    const source = document.cards?.find(item => item.id === id)
    return source ? 'name' in source && source.name ? source.name : '已关联来源' : '失效来源'
  }
  const describe = (field?: ReferenceDesignField & { size?: string | null }, key?: string) => {
    if (!field) return ''
    const text = field.document ? (field.document.segments || []).map(segment => segment.kind === 'text' ? segment.text : `@${sourceName(segment.source.card_id)}`).join('').trim() : field.text?.trim() || ''
    const size = field.size ? shotSizeLabels[field.size as keyof typeof shotSizeLabels] : ''
    const configured = isDesignFieldConfigured(field, key ? defaults[key] : undefined)
    if (!configured) return ''
    const status = states[field.state || 'empty']
    const detail = [size, text].filter(Boolean).join(' · ')
    if (field.state === 'empty' || !field.state) return detail ? `未填写（保留内容）` : '未填写（已配置元信息）'
    return [status, detail || field.source_locator?.trim() || (field.purpose === 'constraint' ? '约束' : field.purpose === 'background' ? '背景' : '')].filter(Boolean).join('：')
  }
  const rows = Object.entries(labels).flatMap(([key, label]) => {
    const text = describe((card.fields as Record<string, ReferenceDesignField> | undefined)?.[key], key)
    return text ? [{ label, text }] : []
  })
  if ('phases' in card) for (const [index, phase] of (card.phases || []).entries()) rows.push({ label: phase.name?.trim() || `阶段 ${index + 1}`, text: describe(phase.frame) || '阶段待填写' })
  if ('frame_target' in card && card.frame_target) rows.push({ label: '画面目标', text: card.frame_target.state_id?.startsWith('phase:') ? '已关联运镜阶段' : card.frame_target.state_id === 'field:movement_start' ? '运镜起始画面' : card.frame_target.state_id === 'field:end_frame' ? '运镜结束画面' : '目标待选择' })
  if (card.scope?.description?.trim()) rows.push({ label: '适用范围', text: card.scope.description.trim() })
  if (card.scope?.phase) rows.push({ label: '制作阶段', text: phases[card.scope.phase] })
  if (card.scope?.condition?.trim()) rows.push({ label: '适用条件', text: card.scope.condition.trim() })
  if (card.source_locator?.trim()) rows.push({ label: '来源', text: card.source_locator.trim() })
  for (const binding of card.input_bindings || []) rows.push({ label: relationLabels[binding.input_port] || '关联关系', text: sourceName(binding.source.card_id) })
  return rows
}

/** Six designs share one card body and entry; their field ownership and modal editors stay independent. */
export function VisualDesignCard({ card, document, readonly, onEdit }: { card: DesignCard; document: CanvasDocument; readonly?: boolean; onEdit: (trigger: HTMLElement) => void }) {
  const { cardDefinitions } = useGraphRules()
  const defaults = Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.default_value]))
  const kind = kindOf(card), title = titleOf(kind), rows = cardRows(card, document, defaults)
  return <DesignCardBody kind={kind} title={title} rows={rows} readonly={readonly} onEdit={onEdit} />
}

/** Shared finite card geometry for visual design and performance/staging. */
export function DesignCardBody({ kind, title, rows, readonly, onEdit, emptyHint = '选择预设或直接填写设计参数' }: { kind: string; title: string; rows: { label: string; text: string }[]; readonly?: boolean; onEdit: (trigger: HTMLElement) => void; emptyHint?: string }) {
  return <section className="visual-design-card" aria-label={`${title}摘要`}>
    <DesignPurposeIllustration kind={kind} />
    {rows.length ? <><dl>{rows.slice(0, 2).map((row, index) => <div key={index}><dt title={row.label}>{row.label}</dt><Tooltip title={row.text} trigger={['hover', 'focus']} overlayStyle={{ pointerEvents: 'none' }}><dd tabIndex={0} aria-label={`${row.label}：${row.text}`}>{row.text}</dd></Tooltip></div>)}</dl>{rows.length > 2 && <small>另有 {rows.length - 2} 项配置</small>}</> : <div className="visual-design-empty"><strong>尚未填写{title}</strong><p>{emptyHint}</p></div>}
    <WorkbenchButton className="design-card-entry" onClick={event => onEdit(event.currentTarget)}>{readonly ? '查看设计' : rows.length ? '编辑设计' : '开始设计'}</WorkbenchButton>
  </section>
}
