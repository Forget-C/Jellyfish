import { useUiText } from '../../../uiText'
import type { CanvasDocument, CanvasResolvedOutput } from '../../../services/generated'
import { useGraphRules } from './CanvasCatalogContext'
import { useCardCandidates } from './useCardCandidates'

/** 候选边可以先于输出存在；可用状态由已保存直接候选决定，绝不构造占位引用。 */
export function CandidateOutputStatus({ document, savedDocument, cardId, savedRevision, published }: {
  document: CanvasDocument; savedDocument?: CanvasDocument; cardId: string; savedRevision?: number; published?: Record<string, CanvasResolvedOutput[]>
}) {
  const uiText = useUiText()
  const resolved = useCardCandidates((document.project_id || ''), document.id, cardId, savedRevision, published, false)
  const { cardTitles, cardDefinitions } = useGraphRules()
  const edges = (document.edges || []).filter(edge => edge.target_card === cardId)
  if (!edges.length) return null
  const target = document.cards?.find(card => card.id === cardId)
  return <section role="region" aria-label={uiText("候选输出状态")}>
    <h3>{uiText("候选输出状态")}</h3>
    <small>{uiText("输出可用性与实际采用分别确认，具体用途在当前卡片内查看。")}</small>
    {resolved.error && <p role="alert">{resolved.error}</p>}
    {edges.map(edge => {
      const source = document.cards?.find(card => card.id === edge.source_card)
      const name = source && ('name' in source && source.name)
      const label = cardDefinitions[target?.type || '']?.inputs.find(port => port.id === edge.target_port)?.label || edge.target_port
      const saved = savedDocument?.edges?.some(value => value.id === edge.id)
      const count = resolved.candidates.filter(output => output.source.card_id === edge.source_card && output.source.port_id === edge.source_port && output.available !== false).length
      return <p key={edge.id}>{name || cardTitles[source?.type || ''] || uiText("来源")} → {label} · <span>{!saved ? uiText("候选待保存") : resolved.loading ? uiText("正在读取候选输出") : resolved.error ? uiText("输出状态待核实") : count ? uiText("可用输出 {{count}} 项", { count }) : uiText("暂无可用输出")}</span></p>
    })}
  </section>
}
