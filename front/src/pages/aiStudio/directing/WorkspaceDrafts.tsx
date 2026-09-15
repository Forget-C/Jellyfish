import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import { Alert, Button, Modal, Space } from 'antd'
import { useBeforeUnload, useBlocker } from 'react-router-dom'
import { flushSync } from 'react-dom'

type Draft = { name: string; dirty: boolean; save: () => Promise<boolean>; discard: () => void }
type Transition = { action: () => void; cancel?: () => void }
type DraftContext = {
  register: (id: string, draft: MutableRefObject<Draft>) => () => void
  changed: () => void
  request: (transition: Transition) => void
  dirtyNames: string[]
}
const Context = createContext<DraftContext | null>(null)

/** 页面内只注册可保存的人工编辑；通用任务和生成操作不参与“保存后离开”。 */
export function WorkspaceDrafts({ children }: { children: ReactNode }) {
  const drafts = useRef(new Map<string, MutableRefObject<Draft>>())
  const [, update] = useState(0)
  const [pending, setPending] = useState<Transition>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const changed = useCallback(() => update(value => value + 1), [])
  const register = useCallback((id: string, draft: MutableRefObject<Draft>) => {
    drafts.current.set(id, draft)
    changed()
    return () => { drafts.current.delete(id); changed() }
  }, [changed])
  const dirtyDrafts = useCallback(() => [...drafts.current.values()].filter(draft => draft.current.dirty), [])
  const request = useCallback((transition: Transition) => {
    if (!dirtyDrafts().length) transition.action()
    else { setError(''); setPending(transition) }
  }, [dirtyDrafts])
  const blocker = useBlocker(({ currentLocation, nextLocation, historyAction }) => {
    if (historyAction === 'REPLACE' && currentLocation.pathname === nextLocation.pathname && nextLocation.state?.directingContextSync) return false
    return (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search) && dirtyDrafts().length > 0
  })
  useEffect(() => {
    if (blocker.state === 'blocked') request({ action: blocker.proceed, cancel: blocker.reset })
  }, [blocker, request])
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (dirtyDrafts().length) { event.preventDefault(); event.returnValue = '' }
  }, [dirtyDrafts]))
  const cancel = () => { if (!saving) { pending?.cancel?.(); setPending(undefined); setError('') } }
  const finish = async (save: boolean) => {
    if (!pending || saving) return
    setSaving(true); setError('')
    try {
      for (const draft of dirtyDrafts()) {
        if (save) {
          if (!await draft.current.save()) { setError(`${draft.current.name}未保存成功，请处理页面中的提示后重试。`); return }
        } else draft.current.discard()
      }
      const action = pending.action
      flushSync(() => setPending(undefined))
      action()
    } catch { setError('保存未完成，修改已保留。请检查页面中的错误后重试。') }
    finally { setSaving(false) }
  }
  const value = { register, changed, request, dirtyNames: dirtyDrafts().map(draft => draft.current.name) }
  return <Context.Provider value={value}>{children}
    <Modal title="有未保存的修改" open={!!pending} onCancel={cancel} closable={!saving} maskClosable={false} footer={<Space wrap>
      <Button disabled={saving} onClick={cancel}>取消，继续编辑</Button>
      <Button danger disabled={saving} onClick={() => { void finish(false) }}>放弃修改并继续</Button>
      <Button type="primary" loading={saving} onClick={() => { void finish(true) }}>保存后继续</Button>
    </Space>}>
      <p>继续前，请处理以下修改。保存不会确认版本、开始生成或改变当前采用。</p>
      <ul>{dirtyDrafts().map(draft => <li key={draft.current.name}>{draft.current.name}</li>)}</ul>
      {error && <Alert type="error" message={error} />}
    </Modal>
  </Context.Provider>
}

/** 注册最新保存回调，轮询和渲染不会改变编辑基线；返回的函数保护对象切换。 */
export function useWorkspaceDraft(draft: Draft) {
  const context = useContext(Context)
  const id = useId()
  const latest = useRef(draft)
  latest.current = draft
  const register = context?.register
  const changed = context?.changed
  useEffect(() => register?.(id, latest), [register, id])
  useEffect(() => { changed?.() }, [changed, draft.dirty, draft.name])
  return (action: () => void) => context ? context.request({ action }) : action()
}

export function useWorkspaceDraftStatus() {
  const context = useContext(Context)
  return { names: context?.dirtyNames || [], resolve: () => context?.request({ action: () => {} }), transition: (action: () => void) => context ? context.request({ action }) : action() }
}
