import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { pruneGraphView, readGraphView } from './graphLayout'
import type { GraphArrange, GraphLayoutNode, GraphSize, GraphView } from './graphLayout'
import type { CanvasPoint } from '../../../components/canvas/geometry'

export type GraphLayoutScope = {
  storageKey: string; viewId: string; anchorId: string; validIds: string[]; validViewIds?: string[]
  initialTop?: number; initialLeft?: number; identityAliases?: Record<string, string>; onInvalidTarget?: () => void
  onStorageError?: (message: string) => void
  arrange: GraphArrange
  parseView?: (raw: string | null) => GraphView | undefined
  migrate?: (view: GraphView, nodes: GraphLayoutNode[], sizes: Record<string, GraphSize>) => { view: GraphView; undo?: GraphView } | undefined
}
type LayoutState = { key: string; anchor: string; view: GraphView; ready: boolean; anchorScreen?: CanvasPoint; undo?: GraphView }
const memory = new Map<string, GraphView>()
const undoMemory = new Map<string, GraphView>()

/** 预览只读缓存；实际视图才创建或写入布局。 */
export const readStoredGraphView = (key: string, parse = readGraphView) => {
  try { return memory.get(key) || parse(localStorage.getItem(key)) } catch { return memory.get(key) }
}
const storeView = (key: string, view: GraphView, onStorageError?: (message: string) => void) => {
  memory.set(key, view)
  try { localStorage.setItem(key, JSON.stringify({ schema: 1, ...view })) } catch { onStorageError?.('浏览器存储不可用，布局仅在本次会话保留') }
}

/** 共用布局缓存、手动位置及整理撤销；排布与旧缓存迁移由具体画布提供。 */
export function useGraphLayout(scope: GraphLayoutScope | undefined, nodes: GraphLayoutNode[], measured: Record<string, GraphSize>, viewportWidth: number) {
  const key = scope ? `${scope.storageKey}:view:${scope.viewId}` : ''
  const initial = (previous?: LayoutState): LayoutState => {
    const saved = key ? readStoredGraphView(key, scope?.parseView) : undefined
    const anchor = scope?.anchorId || ''
    const point = previous?.view.positions[previous.anchor]
    const transform = previous?.view.transform || { x: 16, y: scope?.initialTop || 64, scale: Math.min(1, Math.max(.15, (viewportWidth - 32) / 360)) }
    const screen = point && previous ? { x: point.x * transform.scale + transform.x, y: point.y * transform.scale + transform.y } : undefined
    return { key, anchor, view: saved || { transform, positions: {}, sizes: {} }, ready: !!saved, undo: undoMemory.get(key),
      anchorScreen: screen && screen.x >= 16 && screen.x < viewportWidth - 200 && screen.y >= (scope?.initialTop || 64) && screen.y < window.innerHeight - 200 ? screen : undefined }
  }
  const [state, setState] = useState<LayoutState>(() => initial())
  if (state.key !== key) setState(initial(state))
  const latest = useRef(state)
  latest.current = state
  const latestScope = useRef(scope)
  latestScope.current = scope
  const aliasIdentity = JSON.stringify(scope?.identityAliases || {})
  const validIdentity = scope?.validIds.join('|')
  useLayoutEffect(() => {
    if (!scope || state.key !== key || !nodes.length || nodes.some(node => !measured[node.id])) return
    const synchronize = (previous: LayoutState): LayoutState => {
      const cleaned = pruneGraphView(previous.view, new Set(scope.validIds), scope.identityAliases)
      const sizes = { ...cleaned.sizes }
      nodes.forEach(node => { sizes[node.id] = node.size || sizes[node.id] || measured[node.id] })
      const migration = scope.migrate?.(cleaned, nodes, sizes)
      const prepared = migration?.view || cleaned
      const positions = scope.arrange(nodes, sizes, viewportWidth, scope.anchorId, prepared.positions, cleaned.sizes)
      let transform = prepared.transform
      if (!previous.ready || migration) {
        const anchor = positions[scope.anchorId] || { x: 0, y: 0 }
        const screen = !migration && previous.anchorScreen || { x: scope.initialLeft ?? (viewportWidth > 700 ? 96 : 16), y: scope.initialTop || 64 }
        transform = { ...transform, x: screen.x - anchor.x * transform.scale, y: screen.y - anchor.y * transform.scale }
      }
      const view = { ...prepared, transform, positions, sizes }
      if (previous.ready && previous.anchor === scope.anchorId && JSON.stringify(view) === JSON.stringify(previous.view)) return previous
      return { ...previous, anchor: scope.anchorId, ready: true, view, undo: migration?.undo || previous.undo }
    }
    // Skip no-op dispatches; a queued update still resolves against the latest state.
    if (synchronize(state) !== state) setState(synchronize)
  }, [key, nodes, scope, measured, viewportWidth, state])
  useEffect(() => {
    if (state.key && state.ready) {
      storeView(state.key, pruneGraphView(state.view, new Set(scope?.validIds), scope?.identityAliases), latestScope.current?.onStorageError)
      if (state.undo) undoMemory.set(state.key, state.undo)
      else undoMemory.delete(state.key)
    }
  }, [state, validIdentity, aliasIdentity])
  const validViews = scope?.validViewIds?.join('|')
  useEffect(() => {
    if (!scope) return
    const prefix = `${scope.storageKey}:view:`, valid = new Set(scope.validIds)
    const keys = new Set([...memory.keys()].filter(item => item.startsWith(prefix)))
    try { Object.keys(localStorage).filter(item => item.startsWith(prefix)).forEach(item => keys.add(item)) } catch { /* 使用会话缓存。 */ }
    keys.forEach(item => {
      if (scope.validViewIds && !scope.validViewIds.includes(item.slice(prefix.length))) {
        memory.delete(item); undoMemory.delete(item)
        try { localStorage.removeItem(item) } catch { /* 使用会话缓存。 */ }
      } else {
        const view = readStoredGraphView(item, scope.parseView)
        if (view) storeView(item, pruneGraphView(view, valid, scope.identityAliases), scope.onStorageError)
      }
    })
  }, [scope?.storageKey, validIdentity, aliasIdentity, validViews])
  useEffect(() => {
    const save = () => {
      const current = latest.current, currentScope = latestScope.current
      if (current.key && current.ready) storeView(current.key, pruneGraphView(current.view, new Set(currentScope?.validIds), currentScope?.identityAliases), currentScope?.onStorageError)
    }
    window.addEventListener('pagehide', save)
    return () => { save(); window.removeEventListener('pagehide', save) }
  }, [])
  const setView = (update: (previous: GraphView) => GraphView) => setState(previous => ({ ...previous, view: update(previous.view) }))
  const move = (id: string, point: CanvasPoint) => setState(previous => ({ ...previous, view: { ...previous.view,
    positions: { ...previous.view.positions, [id]: point }, manuallyPlaced: [...new Set([...(previous.view.manuallyPlaced || []), id])] } }))
  const rearrange = () => {
    if (!scope || nodes.some(node => !measured[node.id])) return
    setState(previous => {
      const sizes = Object.fromEntries(nodes.map(node => [node.id, node.size || measured[node.id]]))
      const positions = scope.arrange(nodes, sizes, viewportWidth, scope.anchorId)
      const anchor = positions[scope.anchorId] || { x: 0, y: 0 }
      const transform = { ...previous.view.transform, x: (scope.initialLeft ?? (viewportWidth > 700 ? 96 : 16)) - anchor.x * previous.view.transform.scale, y: (scope.initialTop || 64) - anchor.y * previous.view.transform.scale }
      return { ...previous, undo: previous.view, view: { ...previous.view, sizes, positions, transform, manuallyPlaced: [] }, ready: true }
    })
  }
  const undo = () => setState(previous => previous.undo ? { ...previous, view: pruneGraphView(previous.undo, new Set(scope?.validIds), scope?.identityAliases), undo: undefined } : previous)
  return { view: state.view, ready: state.ready && state.key === key, setView, move, rearrange, undo, canUndo: !!state.undo }
}
