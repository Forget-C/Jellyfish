import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { arrangeDirector, fixedDirectorSize, pruneDirectorView, readDirectorView } from './directorLayout'
import type { DirectorLayoutNode, DirectorSize, DirectorView } from './directorLayout'
import type { CanvasPoint } from '../../../components/canvas/geometry'

export type DirectorLayoutScope = { storageKey: string; viewId: string; anchorId: string; validIds: string[] }
type LayoutState = { key: string; anchor: string; view: DirectorView; ready: boolean; anchorScreen?: CanvasPoint; undo?: DirectorView }
const memory = new Map<string, DirectorView>()
const undoMemory = new Map<string, DirectorView>()
const storedView = (key: string) => {
  try { return memory.get(key) || readDirectorView(localStorage.getItem(key)) } catch { return memory.get(key) }
}
const storeView = (key: string, view: DirectorView) => {
  memory.set(key, view)
  try { localStorage.setItem(key, JSON.stringify({ schema: 1, ...view })) } catch { /* 存储不可用仍保留本次页面会话。 */ }
}

/** 镜头与总览分别保存个人浏览状态；冻结已排尺寸，编辑和缩放不能触发重新整理。 */
export function useDirectorLayout(scope: DirectorLayoutScope | undefined, nodes: DirectorLayoutNode[], measured: Record<string, DirectorSize>, viewportWidth: number) {
  const key = scope ? `${scope.storageKey}:view:${scope.viewId}` : ''
  const initial = (previous?: LayoutState): LayoutState => {
    const saved = key ? storedView(key) : undefined
    const anchor = scope?.anchorId || '全场共享'
    const point = previous?.view.positions[previous.anchor]
    const transform = previous?.view.transform || { x: 16, y: 64, scale: Math.min(1, Math.max(.15, (viewportWidth - 32) / 360)) }
    return { key, anchor, view: saved || { transform, positions: {}, sizes: {} }, ready: !!saved, undo: undoMemory.get(key),
      anchorScreen: point && previous ? { x: point.x * transform.scale + transform.x, y: point.y * transform.scale + transform.y } : undefined }
  }
  const [state, setState] = useState<LayoutState>(() => initial())
  if (state.key !== key) setState(initial(state))
  const latest = useRef(state)
  latest.current = state
  const identity = nodes.map(node => node.id).join('|'), validIdentity = scope?.validIds.join('|')
  useLayoutEffect(() => {
    if (!scope || state.key !== key || !nodes.length || nodes.some(node => !measured[node.id])) return
    setState(previous => {
      const valid = new Set(scope.validIds)
      const cleaned = pruneDirectorView(previous.view, valid)
      const sizes = { ...cleaned.sizes }
      nodes.forEach(node => { sizes[node.id] = fixedDirectorSize(node.id) || sizes[node.id] || measured[node.id] })
      const positions = arrangeDirector(nodes, sizes, viewportWidth, scope.anchorId, cleaned.positions)
      let transform = cleaned.transform
      if (!previous.ready) {
        const anchor = positions[scope.anchorId] || positions['全场共享'] || { x: 0, y: 0 }
        const screen = previous.anchorScreen || { x: viewportWidth > 700 ? 96 : 16, y: 64 }
        transform = { ...transform, x: screen.x - anchor.x * transform.scale, y: screen.y - anchor.y * transform.scale }
      }
      const view = { transform, positions, sizes }
      if (previous.ready && previous.anchor === scope.anchorId && JSON.stringify(view) === JSON.stringify(previous.view)) return previous
      return { ...previous, anchor: scope.anchorId, ready: true, view }
    })
  }, [key, identity, validIdentity, measured, scope?.anchorId, state.view.positions])
  useEffect(() => {
    if (state.key && state.ready) {
      storeView(state.key, state.view)
      if (state.undo) undoMemory.set(state.key, state.undo)
      else undoMemory.delete(state.key)
    }
  }, [state])
  // 删除对象清理所有视图；临时隐藏的关联依据仍在 validIds 中，保持它的位置。
  useEffect(() => {
    if (!scope) return
    const prefix = `${scope.storageKey}:view:`, valid = new Set(scope.validIds)
    const keys = new Set([...memory.keys()].filter(item => item.startsWith(prefix)))
    try { Object.keys(localStorage).filter(item => item.startsWith(prefix)).forEach(item => keys.add(item)) } catch { /* 使用会话缓存。 */ }
    keys.forEach(item => {
      const viewId = item.slice(prefix.length)
      if (viewId.startsWith('shot:') && !valid.has(viewId)) {
        memory.delete(item)
        undoMemory.delete(item)
        try { localStorage.removeItem(item) } catch { /* 使用会话缓存。 */ }
      } else {
        const view = storedView(item)
        if (view) storeView(item, pruneDirectorView(view, valid))
      }
    })
  }, [scope?.storageKey, validIdentity])
  useEffect(() => {
    const save = () => { const current = latest.current; if (current.key && current.ready) storeView(current.key, current.view) }
    window.addEventListener('pagehide', save)
    return () => { save(); window.removeEventListener('pagehide', save) }
  }, [])
  const setView = (update: (previous: DirectorView) => DirectorView) => setState(previous => ({ ...previous, view: update(previous.view) }))
  const rearrange = () => {
    if (!scope || nodes.some(node => !measured[node.id])) return
    setState(previous => {
      const sizes = Object.fromEntries(nodes.map(node => [node.id, fixedDirectorSize(node.id) || measured[node.id]]))
      const positions = arrangeDirector(nodes, sizes, viewportWidth, scope.anchorId)
      const anchor = positions[scope.anchorId] || positions['全场共享'] || { x: 0, y: 0 }
      const transform = { ...previous.view.transform, x: (viewportWidth > 700 ? 96 : 16) - anchor.x * previous.view.transform.scale, y: 64 - anchor.y * previous.view.transform.scale }
      return { ...previous, undo: previous.view, view: { sizes, positions, transform }, ready: true }
    })
  }
  const undo = () => setState(previous => previous.undo ? { ...previous, view: pruneDirectorView(previous.undo, new Set(scope?.validIds)), undo: undefined } : previous)
  return { view: state.view, ready: state.ready && state.key === key, setView, rearrange, undo, canUndo: !!state.undo }
}
