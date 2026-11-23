import { createContext } from 'react'
import type { GenerationCard } from './graphRules'

/** The workspace protects local prompt drafts from navigation and execution. */
export const PromptEditingContext = createContext<(cardId: string, editing: boolean) => void>(() => undefined)

export const PromptEditingActiveContext = createContext(false)

/** The assistant reads the active editor's local prompt without requesting a save. */
export const PromptDraftContext = createContext<(sessionId: string, readDraft?: () => GenerationCard) => void>(() => undefined)
