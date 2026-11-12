import { useEffect, useRef, useState, type RefObject } from 'react'

/** Keep only nearby rows mounted inside the existing workspace scroll panel. */
export function useFileViewport(root: RefObject<HTMLDivElement>, count: number) {
  const grid = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ start: 0, end: 6, columns: 6, stride: 270, remaining: 0, blocked: false })
  const [scrolling, setScrolling] = useState(false)
  useEffect(() => {
    const panel = root.current?.closest('.app-workspace-scroll') as HTMLElement | null
    if (!panel) return
    setScrolling(false)
    let frame = 0
    let timer: ReturnType<typeof setTimeout>
    const measure = () => {
      const element = grid.current
      if (!element) return
      const columns = getComputedStyle(element).gridTemplateColumns.split(' ').length
      const card = element.querySelector<HTMLElement>('.project-resource-card, .file-card')
      const stride = (card?.getBoundingClientRect().height || 254) + 16
      const top = Math.max(0, panel.getBoundingClientRect().top - element.getBoundingClientRect().top)
      const start = Math.max(0, Math.floor(top / stride) - 2)
      const end = Math.ceil((top + panel.clientHeight) / stride) + 2
      const bounds = panel.getBoundingClientRect()
      const size = 44
      const overlaps = () => Array.from(element.querySelectorAll('button:not(.project-resource-cover):not(.file-preview-trigger), input')).some(element => {
        const rect = element.getBoundingClientRect()
        return rect.right > bounds.right - 20 - size && rect.left < bounds.right - 20 && rect.bottom > bounds.bottom - 20 - size && rect.top < bounds.bottom - 20
      })
      const blocked = overlaps()
      setView({ start, end, columns, stride, blocked, remaining: panel.scrollHeight - panel.clientHeight - panel.scrollTop })
    }
    const scroll = () => {
      setScrolling(true)
      clearTimeout(timer)
      timer = setTimeout(() => { measure(); setScrolling(false) }, 800)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(measure)
    resize.observe(panel)
    if (grid.current) resize.observe(grid.current)
    panel.addEventListener('scroll', scroll, { passive: true })
    measure()
    return () => { resize.disconnect(); panel.removeEventListener('scroll', scroll); clearTimeout(timer); cancelAnimationFrame(frame) }
  }, [root, count])
  return { grid, ...view, scrolling }
}
