import { createContext } from 'react'

/** The workspace protects local prompt drafts from navigation and execution. */
export const PromptEditingContext = createContext<(cardId: string, editing: boolean) => void>(() => undefined)

export const PromptEditingActiveContext = createContext(false)
