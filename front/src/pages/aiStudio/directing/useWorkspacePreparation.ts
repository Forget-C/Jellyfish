import { useCallback, useRef, useState } from 'react'
import { useWorkspaceDraft } from './WorkspaceDrafts'
import { readPreparation, writePreparation } from './workspacePreparation'
import type { Preparation } from './workspacePreparation'

/** 未提交的准备输入自动暂存于本浏览器；暂存失败才进入保存/放弃/取消保护。 */
export function useWorkspacePreparation<T extends Preparation>(name: string, scope: string, defaults: T) {
  const initial = () => { const value = readPreparation(scope, defaults); return { scope, value, saved: value, error: '' } }
  const [state, setState] = useState(initial)
  if (state.scope !== scope) setState(initial())
  const current = useRef(state)
  current.current = state
  const save = async () => {
    const latest = current.current
    const ok = writePreparation(scope, latest.value)
    setState({ ...latest, saved: ok ? latest.value : latest.saved, error: ok ? '' : '准备输入未能暂存到本浏览器；离开前请重试保存或明确放弃。' })
    return ok
  }
  useWorkspaceDraft({ name: `${name}（暂存到本浏览器）`, dirty: JSON.stringify(state.value) !== JSON.stringify(state.saved), save, discard: () => setState({ ...current.current, value: structuredClone(current.current.saved), error: '' }) })
  const update = useCallback((patch: Partial<T>) => {
    const latest = current.current
    const value = { ...latest.value, ...patch }
    const ok = writePreparation(scope, value)
    const next = { ...latest, value, saved: ok ? value : latest.saved, error: ok ? '' : '准备输入未能暂存到本浏览器；离开前请重试保存或明确放弃。' }
    current.current = next
    setState(next)
  }, [scope])
  /** 服务端补齐的默认值不算人工编辑，存储受限时也不制造未保存警告。 */
  const initialize = useCallback((patch: Partial<T>) => {
    const value = { ...current.current.value, ...patch }
    const next = { ...current.current, value, saved: value, error: '' }
    current.current = next
    setState(next)
  }, [])
  return { value: state.value, update, initialize, error: state.error }
}
