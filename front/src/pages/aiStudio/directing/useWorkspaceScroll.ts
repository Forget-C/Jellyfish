import { useEffect, useState } from 'react'
import { readWorkspaceContext, saveWorkspaceContext } from './workspaceContext'
import type { WorkspaceSelection } from './workspaceContext'

/** 按对象/视图身份分别记住滚动；隐藏面板不覆盖记录，旧单条记录仍可恢复。 */
export function useWorkspaceScroll(projectId: string, sequenceId: string, field: WorkspaceSelection, identity: string, selector?: string) {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const element = selector ? root?.querySelector<HTMLElement>(selector) : root
    if (!element) return
    let saved = { top: 0, left: 0 }
    try {
      const records = JSON.parse(readWorkspaceContext(projectId, sequenceId)[field] || '{}')
      const value = records.identity === identity ? records : records.positions?.[identity]
      if (value && Number.isFinite(value.top) && value.top >= 0 && Number.isFinite(value.left) && value.left >= 0) saved = value
    } catch { /* 无效浏览记录按首次进入处理。 */ }
    let restored = false
    const restore = () => {
      if (restored || !element.clientWidth || !element.clientHeight) return
      restored = true; element.scrollTop = saved.top; element.scrollLeft = saved.left
    }
    const save = () => {
      if (!restored || !element.clientWidth || !element.clientHeight) return
      let positions = {}
      try {
        const records = JSON.parse(readWorkspaceContext(projectId, sequenceId)[field] || '{}')
        positions = records.positions || (records.identity ? { [records.identity]: { top: records.top, left: records.left } } : {})
      } catch { /* 损坏记录不阻止保存当前浏览位置。 */ }
      saveWorkspaceContext(projectId, sequenceId, { [field]: JSON.stringify({ positions: { ...positions, [identity]: { top: element.scrollTop, left: element.scrollLeft } } }) })
    }
    const observer = new ResizeObserver(restore)
    observer.observe(element); restore(); element.addEventListener('scroll', save)
    return () => { observer.disconnect(); element.removeEventListener('scroll', save) }
  }, [root, projectId, sequenceId, field, identity, selector])
  return setRoot
}
