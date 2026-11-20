import { useEffect, useState } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

type BrowseTrail = { entries: { key: string; index?: number }[]; cursor: number }

/** 同一画布内的浏览历史；只在已记录且相邻的路由之间前进、后退。 */
export function useGraphBrowse(storageKey: string) {
  const location = useLocation(), navigationType = useNavigationType()
  const historyIndex = () => typeof window.history.state?.idx === 'number' ? window.history.state.idx as number : undefined
  const [trail, setTrail] = useState<BrowseTrail>(() => {
    const current = { key: location.key, index: historyIndex() }
    try {
      const stored = JSON.parse(sessionStorage.getItem(`${storageKey}:browse`) || 'null') as BrowseTrail | null
      const cursor = stored?.entries.findIndex(entry => entry.key === location.key || current.index !== undefined && entry.index === current.index) ?? -1
      if (navigationType === 'POP' && stored && cursor >= 0) {
        const entries = [...stored.entries]
        entries[cursor] = current
        return { entries, cursor }
      }
    } catch { /* 浏览记录不可读时从当前位置开始。 */ }
    return { entries: [current], cursor: 0 }
  })
  useEffect(() => {
    const current = { key: location.key, index: historyIndex() }
    setTrail(previous => {
      if (previous.entries[previous.cursor]?.key === current.key) return previous
      if (navigationType === 'POP') {
        const cursor = previous.entries.findIndex(entry => entry.key === current.key || current.index !== undefined && entry.index === current.index)
        if (cursor < 0) return { entries: [current], cursor: 0 }
        const entries = [...previous.entries]
        entries[cursor] = current
        return { entries, cursor }
      }
      if (navigationType === 'REPLACE') {
        const entries = [...previous.entries]
        entries[previous.cursor] = current
        return { entries, cursor: previous.cursor }
      }
      const entries = [...previous.entries.slice(0, previous.cursor + 1), current]
      return { entries, cursor: entries.length - 1 }
    })
  }, [location.key])
  useEffect(() => {
    try { sessionStorage.setItem(`${storageKey}:browse`, JSON.stringify(trail)) } catch { /* 浏览记录不可写时仍可在本页使用。 */ }
  }, [trail, storageKey])
  const canBrowse = (offset: -1 | 1) => {
    const current = trail.entries[trail.cursor], next = trail.entries[trail.cursor + offset]
    return current?.key === location.key && !!next && (current.index === undefined || next.index === undefined || next.index === current.index + offset)
  }
  return { canBrowse }
}
