import { useUiText } from '../../../uiText'
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { ShootingNote, SourceSpan } from '../../../services/generated'
import { readSourceSelection, sameSpan } from './sourceSelection'

export function explanationScopes(notes: ShootingNote[]) {
  const scopes = new Map<string, SourceSpan>()
  for (const { scope } of notes) {
    if (scope) scopes.set(`${scope.start}:${scope.end}`, scope)
  }
  return [...scopes.values()].sort((left, right) => left.start - right.start || left.end - right.end)
}

export function intersectingScopes(notes: ShootingNote[], scope: SourceSpan) {
  const scopes = explanationScopes(notes)
  if (scopes.some(existing => sameSpan(existing, scope))) return []
  return scopes.filter(existing => existing.start < scope.end && scope.start < existing.end)
}

export function ShootingExplanationSource({ text, notes, focused, selection, onSelect, onMark, returnFocus }: {
  text: string; notes: ShootingNote[]; focused?: SourceSpan; selection?: SourceSpan
  onSelect: (scope: SourceSpan) => void; onMark: (position: number) => void
  returnFocus: MutableRefObject<HTMLElement | null>
}) {
  const uiText = useUiText()
  const root = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const pickedByPointer = useRef(false)
  const selected = useRef(onSelect)
  selected.current = onSelect
  const scopes = useMemo(() => explanationScopes(notes), [notes])
  const pieces = useMemo(() => {
    const characters = Array.from(text)
    const ranges = [...scopes, focused, selection].filter((span): span is SourceSpan => !!span)
    const edges = [...new Set([0, characters.length, ...ranges.flatMap(span => [span.start, span.end])])].sort((a, b) => a - b)
    return edges.slice(0, -1).map((start, index) => {
      const end = edges[index + 1]
      return { start, end, text: characters.slice(start, end).join(''),
        marked: scopes.some(scope => scope.start <= start && end <= scope.end),
        focused: !!focused && focused.start <= start && end <= focused.end,
        selected: !!selection && selection.start <= start && end <= selection.end,
        first: (focused ? [focused] : scopes).some(span => span.start === start),
        last: (focused ? [focused] : scopes).some(span => span.end === end) }
    })
  }, [text, scopes, focused, selection])
  useEffect(() => {
    const capture = () => {
      if (!root.current || dragging.current) return false
      const span = readSourceSelection(root.current)
      if (!span) return false
      root.current.ownerDocument.getSelection()?.removeAllRanges()
      selected.current(span)
      return true
    }
    const release = () => {
      const wasDragging = dragging.current
      dragging.current = false
      if (wasDragging) pickedByPointer.current = capture()
    }
    document.addEventListener('selectionchange', capture)
    document.addEventListener('pointerup', release)
    document.addEventListener('pointercancel', release)
    return () => {
      document.removeEventListener('selectionchange', capture)
      document.removeEventListener('pointerup', release)
      document.removeEventListener('pointercancel', release)
    }
  }, [])
  return <div ref={root} className="shooting-source-text" onPointerDown={() => {
    dragging.current = true
    pickedByPointer.current = false
  }}>
    {pieces.map(piece => {
      const activate = (element: HTMLElement) => {
        returnFocus.current = element
        onMark(piece.start)
      }
      return <span key={piece.start} data-source-position={piece.start}
        className={[piece.marked && 'is-marked', piece.focused && 'is-focused', piece.selected && 'is-selection', piece.first && 'is-start', piece.last && 'is-end'].filter(Boolean).join(' ')}
        role={piece.marked ? 'button' : undefined} tabIndex={piece.marked ? 0 : undefined}
        aria-label={piece.marked ? uiText("查看此处拍摄解释：{{text}}", { text: piece.text }) : undefined}
        onClick={piece.marked ? event => { if (!pickedByPointer.current) activate(event.currentTarget) } : undefined}
        onKeyDown={piece.marked ? event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event.currentTarget) }
        } : undefined}>{piece.text}</span>
    })}
  </div>
}
