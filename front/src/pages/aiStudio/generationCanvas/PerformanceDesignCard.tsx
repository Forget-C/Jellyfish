import type { CanvasDocument } from '../../../services/generated'
import type { FlatDesignCard } from './designFieldReferences'
import { designFieldEntries } from './designFieldReferences'
import { useGraphRules } from './CanvasCatalogContext'
import { DesignCardBody } from './VisualDesignCard'

const states: Record<string, string> = { not_applicable: '不适用', absent: '明确没有', undecided: '待确定', fact: '事实', proposal: '提议' }

/** Summaries show authored configuration, including retained references, independently of generation readiness. */
export function PerformanceDesignCardBody({ card, document, readonly, onEdit }: { card: FlatDesignCard; document: CanvasDocument; readonly?: boolean; onEdit: (trigger: HTMLElement) => void }) {
  const { cardDefinitions, portLabels } = useGraphRules()
  const definition = cardDefinitions[card.type!], title = definition.title.replace(/卡$/, '')
  const sourceName = (id: string) => {
    const source = document.cards?.find(item => item.id === id)
    return source ? 'name' in source && source.name || cardDefinitions[source.type!]?.title || '已关联来源' : '失效来源'
  }
  const values = new Map(designFieldEntries(card))
  const rows = definition.fields.flatMap(({ id, label }) => {
    const field = values.get(id)
    if (!field) return []
    const text = field.document ? field.document.segments?.map(part => part.kind === 'text' ? part.text : `@${sourceName(part.source.card_id)}`).join('')?.trim() : field.text?.trim()
    if (!text && (!field.state || field.state === 'empty') && !field.source_locator) return []
    return [{ label, text: field.state === 'empty' ? '未填写（保留内容）' : [states[field.state || ''], text || field.source_locator].filter(Boolean).join('：') }]
  })
  if ('name' in card && card.name?.trim()) rows.unshift({ label: '名称', text: card.name.trim() })
  for (const binding of card.input_bindings || []) rows.push({ label: portLabels[binding.input_port] || '关联关系', text: sourceName(binding.source.card_id) })
  if ('delay_ms' in card && card.delay_ms !== undefined && card.delay_ms !== null) rows.push({ label: '反应延迟', text: `${card.delay_ms} 毫秒` })
  for (const [label, value] of [['适用范围', card.scope?.description], ['制作阶段', card.scope?.phase && { video: '画面／视频', sound: '声音', postproduction: '后期' }[card.scope.phase]], ['适用条件', card.scope?.condition], ['来源', card.source_locator]]) if (value?.trim()) rows.push({ label: label!, text: value.trim() })
  if (card.examples?.length) rows.push({ label: '参考示例', text: `${card.examples.length} 项` })
  if ('markers' in card && card.markers?.length) rows.push({ label: '位置标记', text: `${card.markers.length} 项` })
  return <DesignCardBody kind={card.type!.split('.')[1]} title={title} rows={rows} readonly={readonly} onEdit={onEdit} emptyHint={card.type === 'direction.anchor' ? '填写位置，按需关联参考图并标记' : undefined} />
}
