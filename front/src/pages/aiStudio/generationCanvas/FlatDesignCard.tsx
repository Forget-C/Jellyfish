import { designPhaseLabel } from './designScope'
import { isDesignFieldConfigured } from './designFieldConfiguration'
import type { CanvasDocument } from '../../../services/generated'
import type { FlatDesignCard } from './designFieldReferences'
import { designFieldEntries } from './designFieldReferences'
import { useGraphRules } from './CanvasCatalogContext'
import { DesignCardBody } from './VisualDesignCard'
import { isCompactDesignCard } from './cardGeometry'

const states: Record<string, string> = { not_applicable: '不适用', absent: '明确没有', undecided: '待确定', fact: '事实', proposal: '提议' }

/** Summaries show authored configuration, including retained references, independently of generation readiness. */
export function FlatDesignCardBody({ card, document }: { card: FlatDesignCard; document: CanvasDocument }) {
  const { cardDefinitions, portLabels } = useGraphRules()
  const definition = cardDefinitions[card.type!], title = definition.title.replace(/卡$/, '')
  const sourceName = (id: string) => {
    const source = document.cards?.find(item => item.id === id)
    return source ? 'name' in source && source.name || cardDefinitions[source.type!]?.title || '已关联来源' : '失效来源'
  }
  const values = new Map(designFieldEntries(card))
  const rows = definition.fields.flatMap(({ id, label, default_value }) => {
    const field = values.get(id)
    if (!field) return []
    const text = field.document ? field.document.segments?.map(part => part.kind === 'text' ? part.text : `@${sourceName(part.source.card_id)}`).join('')?.trim() : field.text?.trim()
    if (!isDesignFieldConfigured(field, default_value)) return []
    if (field.authorship === 'user') return [{ id, label, text: text || '' }]
    return [{ id, label, text: field.state === 'empty' ? '未填写（保留内容）' : [states[field.state || ''], text || field.source_locator].filter(Boolean).join('：') }]
  })
  const kind = card.type!.split('.')[1]
  const emptyHint = card.type === 'direction.anchor' ? '填写位置，按需关联参考图并标记' : card.type === 'direction.dialogue' ? '选择说话对象并填写对白正文' : card.type === 'direction.fact' ? '填写事实与来源依据，按需关联证据' : undefined
  const relations = (card.input_bindings || []).map(binding => ({ id: binding.input_port, label: portLabels[binding.input_port] || '关联关系', text: sourceName(binding.source.card_id) }))
  const scope = [
    { id: 'scope', label: '内容适用范围', text: card.scope?.description?.trim() },
    { id: 'phase', label: '制作阶段', text: card.scope?.phase && designPhaseLabel(card.scope.phase) },
    { id: 'condition', label: '适用条件', text: card.scope?.condition?.trim() },
    { id: 'source', label: '卡片原始来源', text: card.source_locator?.trim() },
  ].flatMap(row => row.text ? [{ ...row, text: row.text }] : [])

  if (isCompactDesignCard(card.type)) {
    const coreId: Record<string, string> = { criterion: 'standard', fact: 'fact', dialogue: 'content', event: 'action_change', performance_rule: 'applicability' }
    const core = rows.find(row => row.id === coreId[kind] && row.text)
    const speaker = kind === 'dialogue' ? relations.find(row => row.id === 'speaker') : undefined
    const auxiliaryIds: Record<string, string[]> = {
      criterion: ['scope', 'condition'], fact: ['source_basis', 'source'], dialogue: ['language_pronunciation', 'audiovisual_relation'],
      event: ['source'], performance_rule: ['scope', 'condition'],
    }
    const candidates = [...rows, ...scope, ...relations.filter(row => row !== speaker)].filter(row => row !== core && row.text)
    const auxiliary = auxiliaryIds[kind].map(id => candidates.find(row => row.id === id)).find(Boolean) || candidates[0]
    const summary = core || speaker || auxiliary ? [
      ...(speaker ? [{ ...speaker, lines: 1 }] : []),
      core ? { ...core, lines: speaker ? 3 : 4 } : { label: '核心内容', text: `尚未填写${title}`, lines: 1 },
      ...(auxiliary ? [{ ...auxiliary, lines: 1 }] : []),
    ] : []
    return <DesignCardBody kind={kind} title={title} rows={summary} compact emptyHint={emptyHint} />
  }

  if ('category' in card && card.category !== 'space') rows.push({ id: 'category', label: '连续性分类', text: { space: '空间', appearance: '造型', hands_props: '手部与道具', environment: '环境', photography: '摄影', dialogue_sound: '对白与声音' }[card.category || 'space'] })
  rows.push(...relations)
  if ('delay_ms' in card && card.delay_ms !== undefined && card.delay_ms !== null) rows.push({ id: 'delay_ms', label: '反应延迟', text: `${card.delay_ms} 毫秒` })
  rows.push(...scope)
  if (card.examples?.length) rows.push({ id: 'examples', label: '参考示例', text: `${card.examples.length} 项` })
  if ('markers' in card && card.markers?.length) rows.push({ id: 'markers', label: '位置标记', text: `${card.markers.length} 项` })
  return <DesignCardBody kind={kind} title={title} rows={rows} emptyHint={emptyHint} />
}
