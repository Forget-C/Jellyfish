import { useUiText } from '../../../uiText'
import { Alert, Button, Modal, Space } from 'antd'
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'

type TextRun = { ready: boolean; stopping: boolean; stop: () => Promise<void> }
type LeaveStatus = { dirty: boolean; run?: TextRun }
type ReadStatus = () => LeaveStatus
type Register = (read: ReadStatus) => () => void

export const ExperimentLeaveStatusContext = createContext<Register | undefined>(undefined)

/** Report applied input and open panel edits independently so closing a panel only clears its own contribution. */
export function useExperimentLeaveStatus(dirty: boolean, run?: TextRun) {
  const register = useContext(ExperimentLeaveStatusContext)
  const latest = useRef(run)
  const ready = run?.ready
  const stopping = run?.stopping
  useLayoutEffect(() => { latest.current = run }, [run])
  useLayoutEffect(() => register?.(() => ({ dirty, run: latest.current })), [dirty, ready, stopping, register])
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
    return { dirty: statuses.some(status => status.dirty), run: statuses.find(status => status.run)?.run }
  }, [])
  const permitted = useRef(false)
  const allowNavigation = useCallback((action: () => void) => {
    permitted.current = true
    try { action() } finally { permitted.current = false }
  }, [])
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (permitted.current || (currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search)) return false
    const status = readStatus()
    return status.dirty || Boolean(status.run)
  })
  useBeforeUnload(useCallback(event => {
    const status = readStatus()
    if (status.dirty || status.run) {
      event.preventDefault()
      event.returnValue = ''
    }
  }, [readStatus]))

  const [pending, setPending] = useState<() => void>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const confirming = useRef(false)
  const promptOrigin = useRef<HTMLElement>()
  const returnFocus = useRef<HTMLElement>()
  const request = (action: () => void) => {
    const status = readStatus()
    if (!status.dirty && !status.run) action()
    else {
      promptOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      setFailed(false)
      setPending(() => action)
    }
  }
  const transition = pending ?? (blocker.state === 'blocked' ? blocker.proceed : undefined)
  const { dirty, run } = readStatus()
  const cancel = () => {
    if (confirming.current) return
    returnFocus.current = promptOrigin.current
    setPending(undefined)
    setFailed(false)
    if (blocker.state === 'blocked') blocker.reset()
  }
  const confirm = async () => {
    if (!transition || confirming.current) return
    const active = readStatus().run
    if (active && (!active.ready || active.stopping)) return
    confirming.current = true
    setFailed(false)
    try {
      if (active) {
        setBusy(true)
        await active.stop()
      }
      setPending(undefined)
      transition()
    } catch {
      setFailed(true)
    } finally {
      confirming.current = false
      setBusy(false)
    }
  }
  const dialog = <Modal
    zIndex={2000}
    title={run ? uiText("文本正在生成") : dirty ? uiText("有未发送内容") : uiText("离开实验室？")}
    open={Boolean(transition)}
    onCancel={cancel}
    afterClose={() => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus()
      returnFocus.current = undefined
      promptOrigin.current = undefined
    }}
    modalRender={node => <div onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); cancel() }
    }}>{node}</div>}
    closable={!busy}
    keyboard={!busy}
    maskClosable={false}
    footer={<Space wrap>
      <Button disabled={busy} onClick={cancel}>{run ? uiText("继续等待") : uiText("继续编辑")}</Button>
      <Button danger type="primary" loading={busy} disabled={Boolean(run && (!run.ready || run.stopping))}
        onClick={() => void confirm()}>{run ? uiText("停止生成并离开") : dirty ? uiText("放弃未发送内容并离开") : uiText("离开")}</Button>
    </Space>}
  >
    <p>{run
      ? dirty ? uiText("离开将停止本轮文本生成，并放弃当前未发送内容。") : uiText("离开将停止本轮文本生成。")
      : dirty ? uiText("当前未发送的提示词或配置将被放弃。") : uiText("本轮文本运行已结束，可以继续离开。")}</p>
    {run && !run.ready && <p role="status">{uiText("等待服务端接收后可请求停止。")}</p>}
    {run && failed && <Alert type="error" message={uiText("停止生成请求失败，已保留当前会话。请重试或继续等待。")} showIcon />}
  </Modal>

  return { register, request, allowNavigation, dialog, dirty, textRunActive: Boolean(run), isTextRunActive: () => Boolean(readStatus().run), pendingNavigation: Boolean(transition) }
}
