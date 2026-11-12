import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import { Alert, Button, Modal, Space } from 'antd'
import { useBeforeUnload, useBlocker } from 'react-router-dom'
import { flushSync } from 'react-dom'

type Draft = { name: string; dirty: boolean; busy?: boolean; saveWarning?: string; saveBlockedReason?: string; preserveOnStageChange?: boolean; save?: () => Promise<boolean>; discard: () => void }
type Transition = { action: () => void; cancel?: () => void }
type DraftContext = {
  register: (id: string, draft: MutableRefObject<Draft>) => () => void
  changed: () => void
  request: (transition: Transition) => void
  busy: boolean
  pendingNavigation: boolean
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
  const busyDrafts = useCallback(() => [...drafts.current.values()].filter(draft => draft.current.busy), [])
  const request = useCallback((transition: Transition) => {
    if (!dirtyDrafts().length && !busyDrafts().length) transition.action()
    else { setError(''); setPending(transition) }
  }, [dirtyDrafts, busyDrafts])
  const blocker = useBlocker(({ currentLocation, nextLocation, historyAction }) => {
    if (historyAction === 'REPLACE' && currentLocation.pathname === nextLocation.pathname && nextLocation.state?.directingContextSync) return false
    // 阶段和字段定位不卸载工作单，可以保留编辑往返；身份变化与写入中仍受保护。
    const contentQuery = (search: string) => {
      const query = new URLSearchParams(search)
      for (const key of ['view', 'focus', 'returnView']) query.delete(key)
      query.sort()
      return query.toString()
    }
    if (currentLocation.pathname === nextLocation.pathname && contentQuery(currentLocation.search) === contentQuery(nextLocation.search) && !busyDrafts().length && dirtyDrafts().every(draft => draft.current.preserveOnStageChange)) return false
    return (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search) && (dirtyDrafts().length > 0 || busyDrafts().length > 0)
  })
  useEffect(() => {
    if (blocker.state === 'blocked') request({ action: blocker.proceed, cancel: blocker.reset })
  }, [blocker, request])
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (dirtyDrafts().length || busyDrafts().length) { event.preventDefault(); event.returnValue = '' }
  }, [dirtyDrafts, busyDrafts]))
  const cancel = () => { if (!saving) { pending?.cancel?.(); setPending(undefined); setError('') } }
  const finish = async (save: boolean) => {
    if (!pending || saving || busyDrafts().length) return
    setSaving(true); setError('')
    try {
      for (const draft of dirtyDrafts()) {
        if (save) {
          if (!await draft.current.save?.()) { setError(`${draft.current.name}未保存成功，请处理页面中的提示后重试。`); return }
        } else draft.current.discard()
      }
      const action = pending.action
      flushSync(() => setPending(undefined))
      action()
    } catch { setError('保存未完成，修改已保留。请检查页面中的错误后重试。') }
    finally { setSaving(false) }
  }
  const value = { register, changed, request, pendingNavigation: !!pending, busy: busyDrafts().length > 0, dirtyNames: dirtyDrafts().map(draft => draft.current.name) }
  const processing = busyDrafts().length > 0
  const hasChanges = dirtyDrafts().length > 0
  const saveBlocked = dirtyDrafts().find(draft => draft.current.saveBlockedReason)?.current.saveBlockedReason
  const configuration = hasChanges && dirtyDrafts().some(draft => !draft.current.save)
  return <Context.Provider value={value}>{children}
    <Modal zIndex={2000} title={processing ? '当前操作尚未完成' : configuration ? '有未提交的配置' : hasChanges ? '有未保存的修改' : '当前操作已结束'} open={!!pending} onCancel={cancel} closable={!saving} maskClosable={false} footer={<Space wrap>
      <Button disabled={saving} onClick={cancel}>{processing ? '留在当前页' : configuration ? '继续填写' : '取消，继续编辑'}</Button>
      {(hasChanges || processing) && <Button danger disabled={saving || processing} onClick={() => { void finish(false) }}>{configuration ? '放弃配置' : '放弃修改并继续'}</Button>}
      {!configuration && <Button type="primary" loading={saving} disabled={processing || !!saveBlocked} onClick={() => { void finish(true) }}>{hasChanges || processing ? '保存后继续' : '继续'}</Button>}
    </Space>}>
      <p>{processing ? '请等待当前操作完成后再切换。' : configuration ? '切换前，请处理尚未提交的配置。'
        : hasChanges ? '继续前，请处理以下修改。保存不会确认版本、开始生成或改变当前采用。' : '当前没有未保存的修改，可以继续切换。'}</p>
      <ul>{dirtyDrafts().map(draft => <li key={draft.current.name}>{draft.current.name}</li>)}</ul>
      {dirtyDrafts().filter(draft => draft.current.saveWarning).map(draft => <Alert key={draft.current.name} type="warning" showIcon message={draft.current.saveWarning} />)}
      {saveBlocked && <Alert type="warning" message={saveBlocked} />}
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
  useEffect(() => { changed?.() }, [changed, draft.dirty, draft.name, draft.busy, draft.saveBlockedReason])
  return (action: () => void) => context ? context.request({ action }) : action()
}

/** 写入期间锁定当前编辑区；inert 同时阻止自定义选择、拖动和原生输入。 */
export function WorkspaceWriteBoundary({ busy, children }: { busy: boolean; children: ReactNode }) {
  const context = useContext(Context)
  const locked = busy || !!context?.busy
  return <>
    {busy && <p role="status">操作处理中，完成后可继续编辑。</p>}
    <fieldset disabled={locked} aria-busy={locked} {...(locked ? { inert: '' } : {})} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, width: '100%' }}>{children}</fieldset>
  </>
}

export function useWorkspaceDraftStatus() {
  const context = useContext(Context)
  return { names: context?.dirtyNames || [], pendingNavigation: context?.pendingNavigation || false, resolve: () => context?.request({ action: () => {} }), transition: (action: () => void) => context ? context.request({ action }) : action() }
}
