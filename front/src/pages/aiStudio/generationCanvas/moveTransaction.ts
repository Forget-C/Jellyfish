import type { GraphView } from './graphLayout'
import type { CanvasPoint } from '../../../components/canvas/geometry'

type MovementHost = {
  view: () => GraphView
  update: (change: (view: GraphView) => GraphView) => void
  record: (undo: () => void, redo: () => void) => void
  onMembersChange?: (members: readonly string[]) => void
}

/** 画布移动共用一个事务；取消恢复完整视图，历史仅恢复位置并保留浏览视角。 */
export function createMoveTransaction(host: MovementHost) {
  let snapshot: GraphView | undefined
  let ids: string[] = []
  let pointer = false
  const setMembers = (members: string[]) => {
    if (members.length === ids.length && members.every((id, index) => id === ids[index])) return
    ids = members
    host.onMembersChange?.(ids)
  }
  return {
    get active() { return !!snapshot },
    get pointerActive() { return pointer },
    begin(members: string[], fromPointer = false) {
      snapshot ||= host.view()
      setMembers(members)
      pointer = fromPointer
    },
    move(id: string, position: CanvasPoint) {
      const origin = host.view().positions[id] || { x: 0, y: 0 }
      host.update(previous => ({ ...previous, positions: { ...previous.positions, ...Object.fromEntries(ids.map(member => {
        const point = previous.positions[member] || { x: 0, y: 0 }
        return [member, { x: point.x + position.x - origin.x, y: point.y + position.y - origin.y }]
      })) }, manuallyPlaced: [...new Set([...(previous.manuallyPlaced || []), ...ids])] }))
    },
    moveGroup(positions: Record<string, CanvasPoint>, delta: CanvasPoint) {
      host.update(previous => ({ ...previous, positions: { ...previous.positions,
        ...Object.fromEntries(Object.entries(positions).map(([id, origin]) => [id, { x: origin.x + delta.x, y: origin.y + delta.y }])) } }))
    },
    moveHandle(members: string[], next: CanvasPoint, origin: CanvasPoint) {
      snapshot ||= host.view()
      setMembers(members)
      const transform = host.view().transform, start = snapshot.transform
      const delta = { x: next.x - (transform.x - start.x) / transform.scale - origin.x, y: next.y - (transform.y - start.y) / transform.scale - origin.y }
      host.update(previous => ({ ...previous, positions: { ...previous.positions, ...Object.fromEntries(ids.map(id => [id,
        { x: (previous.positions[id]?.x || 0) + delta.x, y: (previous.positions[id]?.y || 0) + delta.y }])) } }))
    },
    pan(dx: number, dy: number) {
      if (!pointer || !snapshot) return
      host.update(previous => ({ ...previous, transform: { ...previous.transform, x: previous.transform.x + dx, y: previous.transform.y + dy },
        positions: { ...previous.positions, ...Object.fromEntries(ids.map(id => {
          const point = previous.positions[id] || { x: 0, y: 0 }
          return [id, { x: point.x - dx / previous.transform.scale, y: point.y - dy / previous.transform.scale }]
        })) } }))
    },
    finish(cancelled = false) {
      pointer = false
      const before = snapshot
      snapshot = undefined
      setMembers([])
      if (!before) return
      if (cancelled) { host.update(() => before); return }
      const after = host.view()
      if (JSON.stringify(before.positions) === JSON.stringify(after.positions)) return
      const restore = (view: GraphView) => host.update(current => ({ ...current, positions: view.positions, manuallyPlaced: view.manuallyPlaced }))
      host.record(() => restore(before), () => restore(after))
    },
  }
}
