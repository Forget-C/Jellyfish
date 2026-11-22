import { useEffect, useRef, useState } from 'react'
import { CommentOutlined, CloseOutlined } from '@ant-design/icons'
import { Alert, Input, Spin } from 'antd'
import { WorkbenchButton, WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'
import { StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasAssistantExchange, CanvasAssistantMessage } from '../../../services/generated'
import { useUiText } from '../../../uiText'
import './canvasAssistant.css'

/** Nonmodal conversation for one saved canvas. Closing it keeps the draft and in-flight reply. */
export function CanvasAssistant({ canvasId, projectId }: { canvasId: string; projectId: string }) {
  const uiText = useUiText()
  const trigger = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<CanvasAssistantExchange[]>()
  const [historyError, setHistoryError] = useState(false)
  const [retryLoad, setRetryLoad] = useState(0)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState(false)
  const [sending, setSending] = useState(false)
  const pending = useRef<CanvasAssistantMessage>()
  const sendingNow = useRef(false)
  const lastTurn = useRef<HTMLDivElement>(null)
  const panelId = 'canvas-assistant-' + canvasId
  const inputId = panelId + '-input'

  useEffect(() => {
    if (!open) return
    const request = Canvases.canvasAssistantHistory({ canvasId, projectId })
    let current = true
    void request.then(response => {
      if (!response.data) throw new Error('missing assistant history')
      const saved = response.data.turns
      if (current) setTurns(previous => (previous?.[previous.length - 1]?.sequence ?? 0) > (saved[saved.length - 1]?.sequence ?? 0)
        ? previous : saved)
    }).catch(() => { if (current) setHistoryError(true) })
    return () => { current = false; request.cancel() }
  }, [open, canvasId, projectId, retryLoad])

  useEffect(() => {
    if (open) lastTurn.current?.scrollIntoView({ block: 'nearest' })
  }, [open, turns])

  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  const send = async () => {
    const text = draft.trim()
    if (sendingNow.current || !turns || !text) return
    const requestBody = pending.current?.text === text
      ? pending.current : { text, request_id: crypto.randomUUID() }
    pending.current = requestBody
    sendingNow.current = true
    setSending(true)
    setSendError(false)
    try {
      const { data: turn } = await Canvases.canvasAssistantSend({ canvasId, projectId, requestBody })
      if (!turn) throw new Error('missing assistant reply')
      setTurns(current => current?.some(existing => existing.request_id === turn.request_id)
        ? current : [...(current || []), turn])
      setDraft('')
      pending.current = undefined
    } catch {
      setSendError(true)
    } finally {
      sendingNow.current = false
      setSending(false)
    }
  }

  return <div className="canvas-assistant-dock">
    <WorkbenchIconButton ref={trigger} label={uiText("打开画布助手")} icon={<CommentOutlined />}
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => { if (open) close(); else { setHistoryError(false); setOpen(true) } }} />
    {open && <aside id={panelId} className="canvas-assistant-panel" aria-label={uiText("画布助手")}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.stopPropagation()
          close()
        }
      }}>
      <header className="canvas-assistant-header">
        <strong>{uiText("画布助手")}</strong>
        <WorkbenchIconButton label={uiText("关闭画布助手")} icon={<CloseOutlined />} variant="quiet" onClick={close} />
      </header>
      <div className="canvas-assistant-history" role="log" aria-live="polite">
        {historyError && <Alert type="error" message={uiText("暂时无法读取助手对话")}
          action={<WorkbenchButton onClick={() => { setHistoryError(false); setRetryLoad(value => value + 1) }}>{uiText("重试")}</WorkbenchButton>} />}
        {!turns && !historyError && <Spin aria-label={uiText("正在读取助手对话")} />}
        {turns?.map(turn => <article className="canvas-assistant-turn" key={turn.request_id}>
          <div className="canvas-assistant-question">{turn.text}</div>
          <div>{turn.reply}</div>
        </article>)}
        {sending && <p role="status">{uiText("助手正在回复")}</p>}
        <div ref={lastTurn} />
      </div>
      <form className="canvas-assistant-composer" onSubmit={event => { event.preventDefault(); void send() }}>
        {sendError && <Alert type="error" message={uiText("未收到助手回复，请检查默认文本模型后重试")} />}
        <Input.TextArea id={inputId} aria-label={uiText("给画布助手发消息")} value={draft} maxLength={16000}
          autoSize={{ minRows: 2, maxRows: 5 }} disabled={sending}
          onChange={event => setDraft(event.target.value)} />
        <WorkbenchButton htmlType="submit" variant="primary" loading={sending}
          disabled={!turns || !draft.trim()}>{uiText("发送消息")}</WorkbenchButton>
      </form>
    </aside>}
  </div>
}
