import { useUiText } from '../../../uiText'
import { Button, Modal, Space } from 'antd'
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'

type LeaveStatus = { dirty: boolean; textRunActive: boolean }
type ReadStatus = () => LeaveStatus
type Register = (read: ReadStatus) => () => void

export const ExperimentLeaveStatusContext = createContext<Register | undefined>(undefined)

/** Report applied input and open panel edits independently so closing a panel only clears its own contribution. */
export function useExperimentLeaveStatus(dirty: boolean, textRunActive = false) {
  const register = useContext(ExperimentLeaveStatusContext)
  useLayoutEffect(() => register?.(() => ({dirty, textRunActive})), [dirty, textRunActive, register])
}

/** The same confirmation gates explicit session actions and router links/history. */
export function useExperimentLeaveGuard() {
  const uiText = useUiText()
  const readers = useRef(new Set<ReadStatus>())
  const [, refresh] = useState(0)
  const register = useCallback<Register>(read => {
    readers.current.add(read)
    refresh(version => version + 1)
    return () => {
      readers.current.delete(read)
      refresh(version => version + 1)
    }
  }, [])
  const readStatus = useCallback(() => {
    const statuses = [...readers.current].map(read => read())
    return {dirty: statuses.some(status => status.dirty), textRunActive: statuses.some(status => status.textRunActive)}
  }, [])
  const permitted = useRef(false)
  const allowNavigation = useCallback((action: () => void) => {
    permitted.current = true
    try { action() } finally { permitted.current = false }
  }, [])
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (permitted.current || (currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search)) return false
    const status = readStatus()
    return status.dirty
  })
  useBeforeUnload(useCallback(event => {
    const status = readStatus()
    if (status.dirty) {
      event.preventDefault()
      event.returnValue = ''
    }
  }, [readStatus]))

  const [pending, setPending] = useState<() => void>()
  const promptOrigin = useRef<HTMLElement>()
  const returnFocus = useRef<HTMLElement>()
  const request = (action: () => void) => {
    const status = readStatus()
    if (!status.dirty) action()
    else {
      promptOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      setPending(() => action)
    }
  }
  const transition = pending ?? (blocker.state === 'blocked' ? blocker.proceed : undefined)
  const { dirty, textRunActive } = readStatus()
  const cancel = () => {
    returnFocus.current = promptOrigin.current
    setPending(undefined)
    if (blocker.state === 'blocked') blocker.reset()
  }
  const confirm = () => {
    if (!transition) return
    setPending(undefined)
    transition()
  }
  const dialog = <Modal
    zIndex={2000}
    title={dirty ? uiText("有未发送内容") : uiText("离开实验室？")}
    open={Boolean(transition)}
    onCancel={cancel}
    afterClose={() => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus()
      returnFocus.current = undefined
      promptOrigin.current = undefined
    }}
    modalRender={node => <div onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
    }}>{node}</div>}
    maskClosable={false}
    footer={<Space wrap>
      <Button onClick={cancel}>{uiText("继续编辑")}</Button>
      <Button danger type="primary" onClick={confirm}>{dirty ? uiText("放弃未发送内容并离开") : uiText("离开")}</Button>
    </Space>}
  >
    {dirty && <p>{uiText("当前未发送的提示词或配置将被放弃。")}</p>}
  </Modal>

  return { register, request, allowNavigation, dialog, dirty, textRunActive, isTextRunActive: () => readStatus().textRunActive, pendingNavigation: Boolean(transition) }

}
