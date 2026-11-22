import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { pruneGraphView, readGraphView } from './graphLayout'
import type { GraphArrange, GraphLayoutNode, GraphSize, GraphView } from './graphLayout'
import type { CanvasPoint } from '../../../components/canvas/geometry'

export type GraphLayoutScope = {
  storageKey: string; viewId: string; anchorId: string; validIds: string[]
  initialTop?: number; initialLeft?: number; focusUnplacedAnchor?: () => { left: number; top: number; scale: number }
  rearrangeTarget?: { anchorId: string; focus: (sizes: Record<string, GraphSize>) => { left: number; top: number; scale: number } }
  onStorageError?: (message: string) => void
  arrange: GraphArrange
}
type LayoutState = { key: string; anchor: string; view: GraphView; ready: boolean; anchorScreen?: CanvasPoint; undo?: GraphView }
const memory = new Map<string, GraphView>()
const undoMemory = new Map<string, GraphView>()

/** 预览只读缓存；实际视图才创建或写入布局。 */
export const readStoredGraphView = (key: string) => {
  try { return memory.get(key) || readGraphView(localStorage.getItem(key)) } catch { return memory.get(key) }
}
const storeView = (key: string, view: GraphView, onStorageError?: (message: string) => void) => {
  memory.set(key, view)
  try { localStorage.setItem(key, JSON.stringify({ schema: 1, ...view })) } catch { onStorageError?.('浏览器存储不可用，布局仅在本次会话保留') }
}

/** 共用布局缓存、手动位置及整理撤销；排布由具体画布提供。 */
export function useGraphLayout(scope: GraphLayoutScope | undefined, nodes: GraphLayoutNode[], measured: Record<string, GraphSize>, viewportWidth: number) {
  const key = scope ? `${scope.storageKey}:view:${scope.viewId}` : ''
  const initial = (previous?: LayoutState): LayoutState => {
    const saved = key ? readStoredGraphView(key) : undefined
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
  const validIdentity = scope?.validIds.join('|')
  useLayoutEffect(() => {
    if (!scope || state.key !== key || !nodes.length || nodes.some(node => !measured[node.id])) return
    const synchronize = (previous: LayoutState): LayoutState => {
      const cleaned = pruneGraphView(previous.view, new Set(scope.validIds))
      const sizes = { ...cleaned.sizes }
      nodes.forEach(node => { sizes[node.id] = node.size || sizes[node.id] || measured[node.id] })
      const positions = scope.arrange(nodes, sizes, viewportWidth, scope.anchorId, cleaned.positions, cleaned.sizes)
      let transform = cleaned.transform
      // 首次加入宿主指定的主卡时，也允许从已显示的初始文档转到该卡。
      const focus = !cleaned.positions[scope.anchorId] ? scope.focusUnplacedAnchor?.() : undefined
      if (focus) {
        const anchor = positions[scope.anchorId] || { x: 0, y: 0 }
        transform = { x: focus.left - anchor.x * focus.scale, y: focus.top - anchor.y * focus.scale, scale: focus.scale }
      } else if (!previous.ready) {
        const anchor = positions[scope.anchorId] || { x: 0, y: 0 }
        const screen = previous.anchorScreen || { x: scope.initialLeft ?? (viewportWidth > 700 ? 96 : 16), y: scope.initialTop || 64 }
        transform = { ...transform, x: screen.x - anchor.x * transform.scale, y: screen.y - anchor.y * transform.scale }
      }
      const view = { ...cleaned, transform, positions, sizes }
      if (previous.ready && previous.anchor === scope.anchorId && JSON.stringify(view) === JSON.stringify(previous.view)) return previous
      return { ...previous, anchor: scope.anchorId, ready: true, view }
    }
    // Skip no-op dispatches; a queued update still resolves against the latest state.
    if (synchronize(state) !== state) setState(synchronize)
  }, [key, nodes, scope, measured, viewportWidth, state])
  useEffect(() => {
    if (state.key && state.ready) {
      const currentScope = latestScope.current
      storeView(state.key, pruneGraphView(state.view, new Set(currentScope?.validIds)), currentScope?.onStorageError)
      if (state.undo) undoMemory.set(state.key, state.undo)
      else undoMemory.delete(state.key)
    }
  }, [state, validIdentity])
  useEffect(() => {
    const currentScope = latestScope.current
    if (!currentScope) return
    const prefix = `${currentScope.storageKey}:view:`, valid = new Set(currentScope.validIds)
    const keys = new Set([...memory.keys()].filter(item => item.startsWith(prefix)))
    try { Object.keys(localStorage).filter(item => item.startsWith(prefix)).forEach(item => keys.add(item)) } catch { /* 使用会话缓存。 */ }
    keys.forEach(item => {
      const view = readStoredGraphView(item)
      if (view) storeView(item, pruneGraphView(view, valid), currentScope.onStorageError)
    })
  }, [scope?.storageKey, validIdentity])
  useEffect(() => {
    const save = () => {
      const current = latest.current, currentScope = latestScope.current
      if (current.key && current.ready) storeView(current.key, pruneGraphView(current.view, new Set(currentScope?.validIds)), currentScope?.onStorageError)
    }
    window.addEventListener('pagehide', save)
    return () => { save(); window.removeEventListener('pagehide', save) }
  }, [])
  const setView = (update: (previous: GraphView) => GraphView) => setState(previous => ({ ...previous, view: update(previous.view) }))
  const move = (id: string, point: CanvasPoint) => setState(previous => ({ ...previous, view: { ...previous.view,
    positions: { ...previous.view.positions, [id]: point }, manuallyPlaced: [...new Set([...(previous.view.manuallyPlaced || []), id])] } }))
  const arrangedView = (view: GraphView, arrange = scope?.arrange): GraphView | undefined => {
    if (!scope || !arrange || nodes.some(node => !measured[node.id])) return
    const sizes = Object.fromEntries(nodes.map(node => [node.id, node.size || measured[node.id]]))
    const target = scope.rearrangeTarget
    const anchorId = target?.anchorId ?? scope.anchorId
    const positions = arrange(nodes, sizes, viewportWidth, anchorId)
    const anchor = positions[anchorId] || { x: 0, y: 0 }
    const focus = target?.focus(sizes)
    const scale = focus?.scale ?? view.transform.scale
    const transform = { scale, x: (focus?.left ?? scope.initialLeft ?? (viewportWidth > 700 ? 96 : 16)) - anchor.x * scale,
      y: (focus?.top ?? (scope.initialTop || 64)) - anchor.y * scale }
    return { ...view, sizes, positions, transform, manuallyPlaced: [] }
  }
  const rearrange = () => setState(previous => {
    const view = arrangedView(previous.view)
    return view ? { ...previous, undo: previous.view, view, ready: true } : previous
  })
  const applyArrangement = (view: GraphView) => setState(previous => ({ ...previous, view, undo: undefined, ready: true }))
  // The local receipt and its coordinates land in one write before the server can mark the command complete.
  const applyAssistantView = (id: string, view: GraphView): boolean => {
    const current = latest.current
    if (current.key !== key || !current.ready) return false
    const assistantReceipts = [...new Set([...(current.view.assistantReceipts || []), id])]
    const next = pruneGraphView({ ...view, assistantReceipts }, new Set(latestScope.current?.validIds))
    try { localStorage.setItem(key, JSON.stringify({ schema: 1, ...next })) } catch {
      latestScope.current?.onStorageError?.('浏览器存储不可用，布局仅在本次会话保留')
      return false
    }
    memory.set(key, next)
    const updated = { ...current, view: next, ready: true, undo: undefined }
    latest.current = updated
    setState(updated)
    return true
  }
  const restoreAssistantView = (view: GraphView) => setView(previous => ({
    ...previous, positions: view.positions, manuallyPlaced: view.manuallyPlaced,
  }))
  const undo = () => setState(previous => previous.undo ? { ...previous, view: pruneGraphView(previous.undo, new Set(scope?.validIds)), undo: undefined } : previous)
  return { view: state.view, ready: state.ready && state.key === key, setView, move, arrangedView, applyArrangement, applyAssistantView, restoreAssistantView, rearrange, undo, canUndo: !!state.undo }
}
