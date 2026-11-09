import { designPhaseLabel } from './designScope'
import { isDesignFieldConfigured } from './designFieldConfiguration'
import { useGraphRules } from './CanvasCatalogContext'
import { Tooltip } from 'antd'
import type { CanvasDocument, CanvasResolvedOutput, MovementCard, OutputIdentity, ReferenceDesignField } from '../../../services/generated'
import type { VisualDesignCard as DesignCard } from './designFieldReferences'
import { photographyRegions, shotSizeLabels } from './photographyDesign'
import { styleLabels } from './visualPresets'
import { DesignPurposeIllustration } from './DesignPurposeIllustration'
import { movementFrameOptions } from './CompositionFrameCandidate'
import { designSummarySourceLabel } from './designSummarySource'
import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, Ref } from 'react'
import type { DesignCardSizing } from './cardGeometry'
import './visualDesignCard.css'

const states: Record<string, string> = { empty: '未填写', not_applicable: '不适用', absent: '明确没有', fact: '事实', undecided: '待确定', proposal: '提议' }
const relationLabels: Record<string, string> = { effect_object: '作用对象', attention_object: '关注对象', focus_object: '焦点对象', shot: '所属镜头', acceptance_basis: '验收依据' }
const kindOf = (card: DesignCard) => (card.type || 'direction.style').slice('direction.'.length)
const titleOf = (kind: string) => kind === 'style' ? '画面风格' : photographyRegions[kind as keyof typeof photographyRegions].label

/** Configuration describes authored intent, independently from output eligibility or model readiness. */
function cardRows(card: DesignCard, document: CanvasDocument, defaults: Record<string, ReferenceDesignField | undefined>, sourceName: (identity: OutputIdentity) => string): DesignSummaryRow[] {
  const kind = kindOf(card), labels: Record<string, string> = kind === 'style' ? styleLabels : photographyRegions[kind as keyof typeof photographyRegions].fields
  const describe = (field?: ReferenceDesignField & { size?: string | null }, key?: string) => {
    if (!field) return ''
    const text = field.document ? (field.document.segments || []).map(segment => segment.kind === 'text' ? segment.text : `@${sourceName(segment.source)}`).join('').trim() : field.text?.trim() || ''
    const size = field.size ? shotSizeLabels[field.size as keyof typeof shotSizeLabels] : ''
    const configured = isDesignFieldConfigured(field, key ? defaults[key] : undefined)
    if (!configured) return ''
    const status = states[field.state || 'empty']
    const detail = [size, text].filter(Boolean).join(' · ')
    if (field.authorship === 'user') return detail
    if (field.state === 'empty' || !field.state) return detail ? `未填写（保留内容）` : '未填写（已配置元信息）'
    return [status, detail || field.source_locator?.trim() || (field.purpose === 'constraint' ? '约束' : field.purpose === 'background' ? '背景' : '')].filter(Boolean).join('：')
  }
  const fieldOrder = kind === 'movement'
    ? ['movement_start', 'end_frame', 'movement_type', 'movement_path', 'movement_speed', 'movement_trigger']
    : Object.keys(labels)
  const rows = fieldOrder.flatMap(key => {
    const text = describe((card.fields as Record<string, ReferenceDesignField> | undefined)?.[key], key)
    return text ? [{ key, label: labels[key], text }] : []
  })
  const summary: DesignSummaryRow[] = rows.map(({ label, text }) => ({ label, text }))
  if ('frame_target' in card && card.frame_target) {
    const { card_id, state_id } = card.frame_target
    const movement = document.cards?.find((source): source is MovementCard => source.type === 'direction.movement' && source.id === card_id)
    const target = movementFrameOptions(movement).find(option => option.value === state_id)
    let text = state_id ? '定位画面已失效' : '目标待选择'
    if (target) text = target.value.startsWith('phase:') ? `运镜阶段 · ${target.label}` : `运镜${target.label}`
    const primaryCount = rows.filter(row => row.key === 'shot_size' || row.key === 'composition').length
    summary.splice(primaryCount, 0, { label: '画面目标', text })
  }
  if ('phases' in card) for (const phase of card.phases || []) summary.push({ label: phase.name?.trim() || '运镜阶段', text: describe(phase.frame) || '阶段待填写' })
  if (card.scope?.description?.trim()) summary.push({ label: '内容适用范围', text: card.scope.description.trim() })
  if (card.scope?.phase) summary.push({ label: '制作阶段', text: designPhaseLabel(card.scope.phase) })
  if (card.scope?.condition?.trim()) summary.push({ label: '适用条件', text: card.scope.condition.trim() })
  if (card.source_locator?.trim()) summary.push({ label: '卡片原始来源', text: card.source_locator.trim() })
  for (const binding of card.input_bindings || []) summary.push({ label: relationLabels[binding.input_port] || '关联关系', text: sourceName(binding.source) })
  if (!rows.length && summary.length) summary.unshift({ label: '核心内容', text: `尚未填写${titleOf(kind)}` })
  const visible = summary.slice(0, 3)
  // Give longer values two lines where possible, within four lines for the whole card.
  return visible.map((row, index) => ({ ...row, lines: index < 4 - visible.length ? 2 : 1 }))
}

/** Six designs share one card body and entry; their field ownership and modal editors stay independent. */
export function VisualDesignCard({ card, document, outputs, sizing }: { card: DesignCard; document: CanvasDocument; outputs?: Record<string, CanvasResolvedOutput[]>; sizing?: DesignCardSizing }) {
  const { cardDefinitions } = useGraphRules()
  const defaults = Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.default_value]))
  const kind = kindOf(card), title = titleOf(kind), rows = cardRows(card, document, defaults, designSummarySourceLabel(document, card.id, cardDefinitions, outputs))
  return <DesignCardBody kind={kind} title={title} rows={rows} sizing={sizing} />
}

export type DesignSummaryRow = { label: string; text: string; lines?: number; parts?: string[] }

type SummaryProps = { kind: string; title: string; rows: DesignSummaryRow[]; summaryOnly?: boolean; emptyHint?: string }

function DesignSummary({ kind, title, rows, summaryOnly, emptyHint, measuring, summaryRef, empty }: SummaryProps & {
  measuring?: boolean; summaryRef?: Ref<HTMLElement>; empty?: boolean
}) {
  const hasLineBudget = rows.some(row => row.lines)
  const visibleRows = hasLineBudget ? rows : rows.slice(0, 2)
  return <section ref={summaryRef} className="visual-design-card" data-measuring={measuring || undefined} data-multiline={hasLineBudget}
    aria-hidden={measuring || undefined} aria-label={measuring ? undefined : `${title}摘要`}>
    {!summaryOnly && <DesignPurposeIllustration kind={kind} />}
    {visibleRows.length ? <dl>{visibleRows.map((row, index) => {
      const definition = <dd tabIndex={measuring ? undefined : 0} aria-label={measuring ? undefined : `${row.label}：${row.text}`}
        data-summary-parts={row.parts ? true : undefined} style={row.lines ? { '--design-summary-lines': row.lines } as CSSProperties : undefined}>
        {row.parts ? row.parts.map(part => <span key={part}>{part}</span>) : row.text}
      </dd>
      return <div key={index}>
        <dt title={row.label}>{row.label}</dt>
        {measuring ? definition : <Tooltip title={row.text} trigger={['hover', 'focus']} overlayStyle={{ pointerEvents: 'none' }}>{definition}</Tooltip>}
      </div>
    })}</dl> : empty && <div className="visual-design-empty"><strong>尚未填写{title}</strong><p>{emptyHint}</p></div>}
  </section>
}

/** 正常摘要决定目标档位。锁高时按原版摘要逐行测量，避免临时省略参与选档。 */
export function DesignCardBody({ sizing, emptyHint = '选择预设或直接填写设计参数', ...props }: SummaryProps & { sizing?: DesignCardSizing }) {
  const measureRef = useRef<HTMLElement>(null)
  const lastMeasurement = useRef<{ id: string; height: number }>()
  const [fittedLines, setFittedLines] = useState<number[]>([])
  const { locked, cardId, onMeasure } = sizing || {}
  const measure = () => {
    const summary = measureRef.current
    const body = summary?.closest<HTMLElement>('.generation-card-body')
    const header = body?.parentElement?.querySelector<HTMLElement>('header')
    if (!summary || !body || !header || !cardId || !onMeasure || !summary.offsetWidth) return
    const style = getComputedStyle(body)
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    const chrome = padding + (body.offsetHeight - body.clientHeight) + header.offsetHeight
    const requiredHeight = chrome + parseFloat(getComputedStyle(summary).height)
    if (lastMeasurement.current?.id !== cardId || lastMeasurement.current.height !== requiredHeight) {
      lastMeasurement.current = { id: cardId, height: requiredHeight }
      onMeasure(cardId, requiredHeight)
    }
    if (!locked) return
    const available = body.clientHeight - padding
    const bounds = summary.getBoundingClientRect()
    const scale = bounds.width / summary.offsetWidth
    const fitted: number[] = []
    for (const row of summary.querySelectorAll('dl > div')) {
      const value = row.querySelector('dd')!
      const rowBounds = row.getBoundingClientRect()
      const top = (rowBounds.top - bounds.top) / scale
      const lineHeight = parseFloat(getComputedStyle(value).lineHeight)
      const lineCount = Math.floor((available - top + .01) / lineHeight)
      if (lineCount < 1) break
      fitted.push(lineCount)
      if ((rowBounds.bottom - bounds.top) / scale > available + .01) break
    }
    setFittedLines(previous => previous.length === fitted.length && previous.every((lines, index) => lines === fitted[index]) ? previous : fitted)
  }
  useLayoutEffect(measure)
  useLayoutEffect(() => {
    const summary = measureRef.current
    if (!summary || !onMeasure) return
    const observer = new ResizeObserver(measure)
    observer.observe(summary)
    return () => observer.disconnect()
  }, [locked, cardId, onMeasure])
  if (!sizing) return <DesignSummary {...props} emptyHint={emptyHint} empty={!props.rows.length} />
  if (!locked) return <DesignSummary {...props} emptyHint={emptyHint} empty={!props.rows.length} summaryRef={measureRef} />
  const rows = props.rows.slice(0, fittedLines.length).map((row, index) => {
    const lines = Math.min(row.parts?.length || row.lines || 1, fittedLines[index])
    return { ...row, lines, parts: row.parts?.slice(0, lines) }
  })
  return <div className="design-summary-fit">
    <DesignSummary {...props} emptyHint={emptyHint} empty={!props.rows.length} measuring summaryRef={measureRef} />
    <DesignSummary {...props} rows={rows} emptyHint={emptyHint} empty={!props.rows.length} />
  </div>
}
