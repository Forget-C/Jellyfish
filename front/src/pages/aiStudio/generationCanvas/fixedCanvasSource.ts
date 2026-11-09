import type { CanvasDocument } from '../../../services/generated'

/** Keep both the adopted excerpt and any still-cited evidence read-only. */
export function fixedCanvasSource(document: CanvasDocument, cardId: string) {
  return document.fixed_source?.card_id === cardId ? document.fixed_source
    : document.archived_sources?.find(source => source.card_id === cardId)
}
