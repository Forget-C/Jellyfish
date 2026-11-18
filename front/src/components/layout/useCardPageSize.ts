import { useLayoutEffect, useRef, useState } from 'react'

/** Measures the same grid tracks and card styles used by the visible list. */
export function useCardPageSize(active = true) {
  const panel = useRef<HTMLDivElement>(null)
  const measureGrid = useRef<HTMLDivElement>(null)
  const measureCard = useRef<HTMLDivElement>(null)
  const [pageSize, setPageSize] = useState(0)

  useLayoutEffect(() => {
    if (!active) return
    const viewport = panel.current
    const grid = measureGrid.current
    const card = measureCard.current
    if (!viewport || !grid || !card) return
    const measure = () => {
      if (!viewport.clientHeight || !grid.clientWidth) return
      const style = getComputedStyle(grid)
      const columns = style.gridTemplateColumns.split(' ').length
      const gap = parseFloat(style.rowGap)
      const height = card.getBoundingClientRect().height
      const rows = Math.floor((viewport.clientHeight + gap) / (height + gap))
      setPageSize(columns * Math.max(1, Math.min(rows, Math.floor(100 / columns))))
    }
    measure()
    let timer: ReturnType<typeof setTimeout>
    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(measure, 120)
    })
    observer.observe(viewport)
    observer.observe(card)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [active])

  return { panel, measureGrid, measureCard, pageSize }
}
