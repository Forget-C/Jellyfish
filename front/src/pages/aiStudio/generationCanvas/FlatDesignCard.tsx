import { useUiText } from '../../../uiText'
import { designPhaseLabel } from './designScope'
import { isDesignFieldConfigured } from './designFieldConfiguration'
import type { CanvasDocument, CanvasResolvedOutput } from '../../../services/generated'
import type { FlatDesignCard } from './designFieldReferences'
import { designFieldEntries } from './designFieldReferences'
import { useGraphRules } from './CanvasCatalogContext'
import { DesignCardBody } from './VisualDesignCard'
import type { DesignSummaryRow } from './VisualDesignCard'
import type { DesignCardSizing } from './cardGeometry'
import { compactDesignFields, structuredDesignFields } from './designSummaryFields'
import { designSummarySourceLabel } from './designSummarySource'

const states: Record<string, string> = { not_applicable: '不适用', absent: '明确没有', undecided: '待确定', fact: '事实', proposal: '提议' }

/** Summaries show authored configuration, including retained references, independently of generation readiness. */
export function FlatDesignCardBody({ card, document, outputs, sizing }: { card: FlatDesignCard; document: CanvasDocument; outputs?: Record<string, CanvasResolvedOutput[]>; sizing?: DesignCardSizing }) {
  const uiText = useUiText()
  const { cardDefinitions, portLabels } = useGraphRules()
  const definition = cardDefinitions[card.type!], title = definition.title.replace(/卡$/, '')
  const sourceName = designSummarySourceLabel(document, card.id, cardDefinitions, outputs)
  const values = new Map(designFieldEntries(card))
  const rows: (DesignSummaryRow & { id: string })[] = definition.fields.flatMap(({ id, label, default_value }) => {
    const field = values.get(id)
    if (!field) return []
    const text = field.document ? field.document.segments?.map(part => part.kind === 'text' ? part.text : `@${sourceName(part.source)}`).join('')?.trim() : field.text?.trim()
    if (!isDesignFieldConfigured(field, default_value)) return []
    if (field.authorship === 'user') return [{ id, label, text: text || '' }]
    return [{ id, label, text: field.state === 'empty' ? '未填写（保留内容）' : [states[field.state || ''], text || field.source_locator].filter(Boolean).join('：') }]
  })
  const kind = card.type!.split('.')[1]
  const emptyHint = card.type === 'direction.anchor' ? uiText("填写位置，按需关联参考图并标记") : card.type === 'direction.dialogue' ? uiText("选择说话对象并填写对白正文") : card.type === 'direction.fact' ? uiText("填写事实与来源依据，按需关联证据") : undefined
  const relations = (card.input_bindings || []).map(binding => ({ id: binding.input_port, label: portLabels[binding.input_port] || uiText("关联关系"), text: sourceName(binding.source) }))
  const scope = [
    { id: 'scope', label: uiText("内容适用范围"), text: card.scope?.description?.trim() },
    { id: 'phase', label: uiText("制作阶段"), text: card.scope?.phase && designPhaseLabel(card.scope.phase) },
    { id: 'condition', label: uiText("适用条件"), text: card.scope?.condition?.trim() },
    { id: 'source', label: uiText("卡片原始来源"), text: card.source_locator?.trim() },
  ].flatMap(row => row.text ? [{ ...row, text: row.text }] : [])

  const compact = compactDesignFields[card.type!]
  if (compact) {
    const core = rows.find(row => row.id === compact.core && row.text)
    const speaker = kind === 'dialogue' ? relations.find(row => row.id === 'speaker') : undefined
    const candidates = [...rows, ...scope, ...relations.filter(row => row !== speaker)].filter(row => row !== core && row.text)
    const auxiliary = compact.auxiliary.map(id => candidates.find(row => row.id === id)).find(Boolean) || candidates[0]
    const summary = core || speaker || auxiliary ? [
      ...(speaker ? [{ ...speaker, lines: 1 }] : []),
      core ? { ...core, lines: speaker ? 3 : 4 } : { label: uiText("核心内容"), text: `尚未填写${title}`, lines: 1 },
      ...(auxiliary ? [{ ...auxiliary, lines: 1 }] : []),
    ] : []
    return <DesignCardBody kind={kind} title={title} rows={summary} summaryOnly emptyHint={emptyHint} sizing={sizing} />
  }

  const addGroup = (id: string, label: string, fields: string[], separator: string) => {
    const parts = fields.flatMap(field => {
      const row = rows.find(item => item.id === field && item.text)
      return row ? [`${row.label}：${row.text}`] : []
    })
    if (parts.length) rows.push({ id, label, parts, text: parts.join(separator) })
  }
  if (card.type === 'direction.sound') addGroup('sound_elements', '声音要素', ['environment', 'action_sound'], ' · ')
  if (card.type === 'direction.continuity') {
    addGroup('continuity_sequence', '前后变化', ['before', 'change', 'after'], ' → ')
    if ((card.category && card.category !== 'space') || rows.some(row => row.text && ['continuity_sequence', 'following_constraints'].includes(row.id))) {
      rows.push({ id: 'category', label: uiText("连续性分类"), text: { space: '空间', appearance: '造型', hands_props: '手部与道具', environment: '环境', photography: '摄影', dialogue_sound: '对白与声音' }[card.category || 'space'], lines: 1 })
    }
  }
  rows.push(...relations)
  if ('delay_ms' in card && card.delay_ms !== undefined && card.delay_ms !== null) rows.push({ id: 'delay_ms', label: uiText("反应延迟"), text: `${card.delay_ms} 毫秒` })
  rows.push(...scope)
  if (card.examples?.length) rows.push({ id: 'examples', label: uiText("参考示例"), text: `${card.examples.length} 项` })
  if ('markers' in card && card.markers?.length) rows.push({ id: 'markers', label: uiText("位置标记"), text: `${card.markers.length} 项` })
  const priorities = structuredDesignFields[card.type!]
  if (priorities) {
    const summary = priorities.flatMap(id => {
      const row = rows.find(candidate => candidate.id === id && candidate.text)
      return row ? [{ ...row, lines: row.lines || 2 }] : []
    }).slice(0, 3)
    const auxiliary = rows.find(row => row.text)
    const emptyCore = { id: 'empty-core', label: uiText("核心内容"), text: `尚未填写${title}`, lines: 1 }
    if (!summary.length && auxiliary) summary.push(emptyCore, { ...auxiliary, lines: 2 })
    else if (kind === 'continuity' && summary.length && !summary.some(row => row.id === 'continuity_sequence')) summary.splice(1, 0, emptyCore)
    return <DesignCardBody kind={kind} title={title} rows={summary} summaryOnly emptyHint={emptyHint} sizing={sizing} />
  }
  return <DesignCardBody kind={kind} title={title} rows={rows} emptyHint={emptyHint} sizing={sizing} />
}
