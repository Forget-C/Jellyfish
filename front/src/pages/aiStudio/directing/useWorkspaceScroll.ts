import { useEffect, useState } from 'react'
import { readWorkspaceContext, saveWorkspaceContext } from './workspaceContext'
import type { WorkspaceSelection } from './workspaceContext'

/** 只记住特定对象/视图的滚动；隐藏面板不覆盖记录，恢复不触发业务写入。 */
export function useWorkspaceScroll(projectId: string, sequenceId: string, field: WorkspaceSelection, identity: string, selector?: string) {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const element = selector ? root?.querySelector<HTMLElement>(selector) : root
    if (!element) return
    let saved = { top: 0, left: 0 }
    try {
      const value = JSON.parse(readWorkspaceContext(projectId, sequenceId)[field] || '{}')
      if (value.identity === identity && Number.isFinite(value.top) && value.top >= 0 && Number.isFinite(value.left) && value.left >= 0) saved = value
    } catch { /* 无效浏览记录按首次进入处理。 */ }
    let restored = false
    const restore = () => {
      if (restored || !element.clientWidth || !element.clientHeight) return
      restored = true; element.scrollTop = saved.top; element.scrollLeft = saved.left
    }
    const save = () => {
      if (restored && element.clientWidth && element.clientHeight) saveWorkspaceContext(projectId, sequenceId, { [field]: JSON.stringify({ identity, top: element.scrollTop, left: element.scrollLeft }) })
    }
    const observer = new ResizeObserver(restore)
    observer.observe(element); restore(); element.addEventListener('scroll', save)
    return () => { observer.disconnect(); element.removeEventListener('scroll', save) }
  }, [root, projectId, sequenceId, field, identity, selector])
  return setRoot
}
