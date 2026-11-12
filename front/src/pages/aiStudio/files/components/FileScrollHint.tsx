import { useState, type RefObject } from 'react'
import './file-scroll-hint.css'

export function FileScrollHint({ root, visible, used, onUsed }: {
  root: RefObject<HTMLDivElement>; visible: boolean; used: boolean; onUsed: () => void
}) {
  const [focused, setFocused] = useState(false)
  return <button type="button" aria-label="向下浏览文件" className={`project-files-scroll-hint ${!used ? 'is-breathing' : ''}`} hidden={!visible && !focused}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onAnimationEnd={onUsed}
    onClick={() => { onUsed(); const panel = root.current?.closest('.app-workspace-scroll'); panel?.scrollBy({ top: panel.clientHeight * 0.75, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }) }}>
    <svg viewBox="0 0 24 36" aria-hidden="true" focusable="false"><path d="M8 0h8v2H8z M8 5h8v4H8z M8 12h8v12h8L12 36 0 24h8z" /></svg>
  </button>
}
