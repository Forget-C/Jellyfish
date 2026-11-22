import type { CanvasAssistantExchange, DraftAssistantConversation, FileRead } from '../../../services/generated'

type LocalConversation = { turns: CanvasAssistantExchange[]; modelId: string | null; references: FileRead[] }
const key = (canvasId: string) => `jellyfish:generation:${canvasId}:draft-assistant`
const memory = new Map<string, LocalConversation>()
export const draftingAssistantReply = new Set<string>()

export function readDraftAssistant(canvasId: string): LocalConversation {
  const recent = memory.get(canvasId)
  if (recent) return recent
  try {
    const saved = JSON.parse(localStorage.getItem(key(canvasId)) || 'null') as LocalConversation | null
    if (saved && Array.isArray(saved.turns) && Array.isArray(saved.references)) return saved
  } catch { /* Continue with an empty conversation if browser history is unavailable. */ }
  return { turns: [], modelId: null, references: [] }
}

export function writeDraftAssistant(canvasId: string, change: Partial<LocalConversation>) {
  const next = { ...readDraftAssistant(canvasId), ...change }
  memory.set(canvasId, next)
  try { localStorage.setItem(key(canvasId), JSON.stringify(next)) } catch { /* Keep the current tab usable. */ }
}

export function draftAssistantSnapshot(canvasId: string): DraftAssistantConversation | undefined {
  const { turns, modelId } = readDraftAssistant(canvasId)
  return turns.length || modelId ? { turns, model_id: modelId } : undefined
}

export function clearDraftAssistant(canvasId: string) {
  memory.delete(canvasId)
  try { localStorage.removeItem(key(canvasId)) } catch { /* The saved conversation is now authoritative. */ }
}
