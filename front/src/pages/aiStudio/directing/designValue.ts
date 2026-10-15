import type { Note_Input, SceneDesign_Input } from '../../../services/generated'

export type DesignPath = Array<string | number>
export function designAt(value: unknown, path: DesignPath): any {
  return path.reduce<any>((node, key) => node?.[key], value)
}
export function patchDesign<T extends SceneDesign_Input>(value: T, path: DesignPath, next: unknown): T {
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
/** 保存响应补齐空来源和 nullable 字段时，仍以同一内容识别无 ID 工作单。 */
export function designObjectSnapshot(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    return Object.fromEntries(Object.keys(item).sort().filter(key => item[key] != null &&
      !(key === 'sources' && Array.isArray(item[key]) && !item[key].length)).map(key => [key, item[key]]))
  })
}
