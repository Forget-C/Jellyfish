import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'

/** 仅重排稳定身份；调用方决定顺序如何写回业务数据。 */
export function moveDesignItem(ids: string[], id: string, to: number) {
  const from = ids.indexOf(id)
  if (from < 0 || to < 0 || to >= ids.length || from === to) return ids
  const next = [...ids]
  next.splice(from, 1); next.splice(to, 0, id)
  return next
}

/** 鼠标、触摸和键盘共用排序；阈值区分点击，边缘滚动不改变选中项。 */
export function useOrderedDesignItems(ids: string[], onOrder: (ids: string[]) => void, disabled?: boolean) {
  const latest = useRef({ ids, onOrder, disabled }); latest.current = { ids, onOrder, disabled }
  const pending = useRef<{ id: string; pointer: number; x: number; y: number; startX: number; startY: number; root: HTMLElement; active: boolean; to: number }>()
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState<{ id: string; to: number }>()
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const state = pending.current
      if (!state?.active) return
      const bounds = state.root.getBoundingClientRect()
      if (getComputedStyle(state.root).overflowX !== 'visible') state.root.scrollLeft += state.x < bounds.left + 28 ? -10 : state.x > bounds.right - 28 ? 10 : 0
      const target = document.elementFromPoint(state.x, state.y)?.closest<HTMLElement>('[data-sort-id]')
      if (target && state.root.contains(target)) {
        const index = latest.current.ids.indexOf(target.dataset.sortId!)
        if (index >= 0 && state.to !== index) { state.to = index; setDrag({ id: state.id, to: index }) }
      }
      frame = requestAnimationFrame(tick)
    }
    const cancel = () => { cancelAnimationFrame(frame); pending.current = undefined; setDrag(undefined) }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && pending.current?.active) { event.preventDefault(); event.stopPropagation(); cancel() }
    }
    const blur = () => { cancel(); suppressClick.current = false }
    const move = (event: globalThis.PointerEvent) => {
      const state = pending.current
      if (!state || event.pointerId !== state.pointer) return
      if (latest.current.disabled || !state.root.getClientRects().length) { cancel(); suppressClick.current = false; return }
      state.x = event.clientX; state.y = event.clientY
      if (!state.active && Math.hypot(state.x - state.startX, state.y - state.startY) > 8) {
        state.active = true; suppressClick.current = true
        setDrag({ id: state.id, to: state.to }); frame = requestAnimationFrame(tick)
      }
      if (state.active) event.preventDefault()
    }
    const finish = (event: globalThis.PointerEvent) => {
      const state = pending.current
      if (!state) { setTimeout(() => { suppressClick.current = false }, 0); return }
      if (event.pointerId !== state.pointer) return
      cancelAnimationFrame(frame); pending.current = undefined; setDrag(undefined)
      if (state.active && event.type === 'pointerup' && !latest.current.disabled && state.root.getClientRects().length > 0) {
        const next = moveDesignItem(latest.current.ids, state.id, state.to)
        if (next !== latest.current.ids) latest.current.onOrder(next)
      }
      setTimeout(() => { suppressClick.current = false }, 0)
    }
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', blur)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', blur); pending.current = undefined; suppressClick.current = false; setDrag(undefined) }
  }, [disabled])
  return {
    drag,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0 || (event.target as HTMLElement).closest('input, [data-sort-ignore]')) return
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-sort-id]'), id = item?.dataset.sortId
      if (!id || !ids.includes(id)) return
      pending.current = { id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, root: event.currentTarget, active: false, to: ids.indexOf(id) }
    },
    onClickCapture: (event: MouseEvent) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation() } },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.nativeEvent.isComposing || disabled || !(event.ctrlKey || event.metaKey) || !event.shiftKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      const id = (event.target as HTMLElement).closest<HTMLElement>('[data-sort-id]')?.dataset.sortId
      if (!id) return
      event.preventDefault(); event.stopPropagation()
      const next = moveDesignItem(ids, id, ids.indexOf(id) + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1))
      if (next !== ids) onOrder(next)
    },
  }
}
