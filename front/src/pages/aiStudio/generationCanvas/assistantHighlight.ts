import type { CanvasAssistantProposal, CanvasDocument } from '../../../services/generated'

export type AssistantHighlight = { sourceId: string; cards: string[]; edges: string[]; hidden: boolean }

export function readAssistantHighlight(scope: string): AssistantHighlight | undefined {
  try {
    const saved: AssistantHighlight = JSON.parse(window.localStorage.getItem('jellyfish:assistant-highlight:' + scope) || 'null')
    if (saved && Array.isArray(saved.cards) && Array.isArray(saved.edges)) return saved
  } catch { /* A failed storage read leaves the canvas unmarked. */ }
}

export function storeAssistantHighlight(scope: string, highlight: AssistantHighlight) {
  try { window.localStorage.setItem('jellyfish:assistant-highlight:' + scope, JSON.stringify(highlight)) }
  catch { /* This session keeps the selected range in memory. */ }
}

export function proposalHighlight(sourceId: string, proposal: CanvasAssistantProposal, document: CanvasDocument): AssistantHighlight {
  const changes = proposal.groups?.filter(group => group.state !== 'rejected' && group.state !== 'superseded')
    .flatMap(group => group.edits) ?? [proposal]
  const cards = new Set<string>()
  const edges = new Set<string>()
  for (const { card_id: cardId, target } of changes) {
    cards.add(cardId)
    if ('source_card' in target) {
      cards.add(target.source_card)
      cards.add(target.target_card)
      edges.add(target.connection_id)
    } else if ('edge_id' in target && !('reference_card_id' in target)) {
      edges.add(target.edge_id)
      const edge = document.edges?.find(item => item.id === target.edge_id)
      if (edge) cards.add(edge.source_card)
    } else if ('reference_card_id' in target) {
      cards.add(target.reference_card_id)
      edges.add(target.edge_id)
    } else if ('movement_card_id' in target) {
      cards.add(target.copy_card_id ?? target.movement_card_id)
      edges.add(target.connection_id)
    }
  }
  return { sourceId, cards: [...cards], edges: [...edges], hidden: false }
}
