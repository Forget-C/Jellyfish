import type { Note_Input, SceneDesign_Input } from '../../../services/generated'

export type DesignPath = Array<string | number>
export function designAt(value: unknown, path: DesignPath): any {
  return path.reduce<any>((node, key) => node?.[key], value)
}
export function patchDesign(value: SceneDesign_Input, path: DesignPath, next: unknown): SceneDesign_Input {
  const copy = structuredClone(value)
  const parent = designAt(copy, path.slice(0, -1))
  parent[path[path.length - 1]] = next
  return copy
}
export function noteText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const note = value as Note_Input
  return note.text || note.reason || ''
}
