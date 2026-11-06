import type { CanvasPoint, CanvasTransform } from '../../../components/canvas/geometry'
type Rect = CanvasPoint & { width: number; height: number }
type Pan = { pointer: number; x: number; y: number; left: number; top: number }

/** 生成画布的浏览与框选会话；Space 激活资格与物理按住状态分别维护。 */
export function createSurfaceGesture(change: (state: { spaceHeld: boolean; selectionBox?: Rect }) => void) {
  let held = false, panned = false, target: EventTarget | null = null
  let pan: Pan | undefined, start: CanvasPoint | undefined, blank: CanvasPoint | undefined, box: Rect | undefined
  let published: { spaceHeld: boolean; selectionBox?: Rect } = { spaceHeld: false }
  const publish = () => {
    // 不因无变化的 Escape／焦点事件重渲染，保留其他控件当前的事件处理顺序。
    if (published.spaceHeld === held && published.selectionBox === box) return
    published = { spaceHeld: held, selectionBox: box }
    change(published)
  }
  const clearPointer = () => { pan = undefined; blank = undefined; start = undefined; box = undefined; publish() }
  return {
    get pan() { return pan },
    get selecting() { return !!start },
    spaceDown(next: EventTarget | null, repeat: boolean) { if (!repeat) { panned = false; target = next } held = true; publish() },
    spaceReset() { target = null; held = false; publish() },
    spaceUp(next: EventTarget | null, blocked: boolean) {
      const activate = target === next && !!target && !panned && !blocked
      target = null; held = false; publish(); return activate
    },
    focus(editable: boolean) { target = null; if (editable) held = false; publish() },
    // 失焦只结束平移及 Space；框选仍按既有捕获／释放事件收尾。
    blur() { target = null; held = false; pan = undefined; blank = undefined; publish() },
    beginPan(point: CanvasPoint, pointer: number, transform: CanvasTransform, suppressActivation = true) {
      if (suppressActivation) panned = true
      pan = { pointer, ...point, left: transform.x, top: transform.y }
    },
    blankDown(point: CanvasPoint) { blank = point },
    beginSelection(point: CanvasPoint, offset: CanvasPoint) {
      start = point; box = { x: point.x - offset.x, y: point.y - offset.y, width: 0, height: 0 }; publish()
    },
    move(point: CanvasPoint, offset: CanvasPoint) {
      if (pan) return { x: pan.left + point.x - pan.x, y: pan.top + point.y - pan.y }
      if (start) { box = { x: Math.min(start.x, point.x) - offset.x, y: Math.min(start.y, point.y) - offset.y, width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) }; publish() }
    },
    finish(point: CanvasPoint, cards: Array<{ id: string; left: number; right: number; top: number; bottom: number }>) {
      let result: { clear: boolean; ids?: string[] } = { clear: !!blank && Math.hypot(point.x - blank.x, point.y - blank.y) <= 6 && !start }
      if (start) {
        if (Math.hypot(point.x - start.x, point.y - start.y) <= 6) result = { clear: true }
        else {
          const left = Math.min(start.x, point.x), right = Math.max(start.x, point.x), top = Math.min(start.y, point.y), bottom = Math.max(start.y, point.y)
          result = { clear: false, ids: cards.filter(card => card.left < right && card.right > left && card.top < bottom && card.bottom > top).map(card => card.id) }
        }
      }
      clearPointer(); return result
    },
    escape() { const restore = pan && { x: pan.left, y: pan.top }; clearPointer(); return restore },
    interrupt: clearPointer,
  }
}
