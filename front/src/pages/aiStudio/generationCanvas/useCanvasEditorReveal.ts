import { useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { CanvasTransform } from '../../../components/canvas/geometry'

/** 打开编辑器只调整视口；用户输入优先，取消后不续播，也不写入内容／布局撤销。 */
export function useCanvasEditorReveal(transform: CanvasTransform, update: (offset: { x: number; y: number }) => void) {
  const latest = useRef({ transform, update }); latest.current = { transform, update }
  const frame = useRef<number>(), generation = useRef(0)
  const cancel = useCallback(() => {
    generation.current++
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
  }, [])
  useEffect(() => {
    window.addEventListener('pointerdown', cancel, true)
    window.addEventListener('wheel', cancel, true)
    window.addEventListener('keydown', cancel, true)
    window.addEventListener('compositionstart', cancel, true)
    window.addEventListener('blur', cancel)
    return () => {
      cancel()
      window.removeEventListener('pointerdown', cancel, true)
      window.removeEventListener('wheel', cancel, true)
      window.removeEventListener('keydown', cancel, true)
      window.removeEventListener('compositionstart', cancel, true)
      window.removeEventListener('blur', cancel)
    }
  }, [cancel])
  return useCallback((offset: { x: number; y: number }) => {
    cancel()
    const request = generation.current, origin = latest.current.transform
    const apply = (progress: number) => latest.current.update({ x: origin.x + offset.x * progress, y: origin.y + offset.y * progress })
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) apply(1)
    else {
      const start = performance.now()
      const tick = (now: number) => {
        if (generation.current !== request) return
        const progress = Math.min(1, (now - start) / 150)
        // 在本帧内提交位移，避免取消后延迟的渲染覆盖键盘或滚轮导航。
        flushSync(() => apply(1 - (1 - progress) ** 3))
        frame.current = progress < 1 ? requestAnimationFrame(tick) : undefined
      }
      frame.current = requestAnimationFrame(tick)
    }
    // 旧编辑器关闭不能取消另一个编辑器刚发起的让位。
    return () => { if (generation.current === request) cancel() }
  }, [cancel])
}
