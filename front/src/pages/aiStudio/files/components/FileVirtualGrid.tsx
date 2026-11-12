import type { ReactNode, RefObject } from 'react'
import type { useFileViewport } from './useFileViewport'

type Props<T extends { id: string }> = {
  files: T[]; viewport: ReturnType<typeof useFileViewport>; root: RefObject<HTMLDivElement>
  pinnedIds: (string | undefined)[]; onFocus: (id: string | undefined) => void
  className: string; children: (file: T) => ReactNode
}

/** Shared row window, stable focus pins and keyboard traversal for both file collections. */
export function FileVirtualGrid<T extends { id: string }>({ files, viewport, root, pinnedIds, onFocus, className, children }: Props<T>) {
  const first = viewport.start * viewport.columns
  const cells = files.slice(first, viewport.end * viewport.columns).map((file, offset) => ({ file, index: first + offset }))
  for (const id of pinnedIds) {
    const index = files.findIndex(file => file.id === id)
    if (index >= 0 && !cells.some(cell => cell.index === index)) cells.push({ file: files[index], index })
  }
  return <div ref={viewport.grid} className={className} style={{ height: Math.max(0, Math.ceil(files.length / viewport.columns) * viewport.stride - 16) }}>
    {cells.map(({ file, index }) => <div key={file.id} data-file-id={file.id}
      onFocus={() => onFocus(file.id)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onFocus(undefined) }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return
        const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
        const targetIndex = index + (event.shiftKey ? -1 : 1)
        if (event.target !== controls[event.shiftKey ? 0 : controls.length - 1] || targetIndex < 0 || targetIndex >= files.length || cells.some(cell => cell.index === targetIndex)) return
        event.preventDefault()
        const next = files[targetIndex]
        const backwards = event.shiftKey
        onFocus(next.id)
        const panel = root.current?.closest('.app-workspace-scroll')
        if (panel) panel.scrollTop = Math.floor(targetIndex / viewport.columns) * viewport.stride
        requestAnimationFrame(() => {
          const targets = root.current?.querySelector(`[data-file-id="${CSS.escape(next.id)}"]`)?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
          targets?.[backwards ? targets.length - 1 : 0]?.focus({ preventScroll: true })
        })
      }}
      style={{ position: 'absolute', top: Math.floor(index / viewport.columns) * viewport.stride, left: `calc(${index % viewport.columns} * (100% + 16px) / ${viewport.columns})`, width: `calc((100% - ${(viewport.columns - 1) * 16}px) / ${viewport.columns})` }}>{children(file)}</div>)}
  </div>
}
