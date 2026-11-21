import { useUiText } from '../../../uiText'
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Input, Typography, type InputRef } from 'antd'
import { CanvasEditorTitle } from './CanvasCardEditor'
import { DesignReferenceContext } from './DesignReferenceEditor'
import { duplicateDesignName } from './canvasDiagnosticNavigation'

/** 名称原位编辑沿用画布自动保存；退出只结束编辑，回退使用画布撤销。 */
export function DesignNameField({ label, placeholder, value, disabled, error, onChange }: { label: string; placeholder: string; value?: string; disabled?: boolean; error?: string; onChange: (value: string) => void }) {
  const uiText = useUiText()
  const title = useContext(CanvasEditorTitle), references = useContext(DesignReferenceContext)
  const id = useId(), input = useRef<InputRef>(null), action = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  const name = value?.trim() || ''
  const card = references?.card
  const duplicate = card && duplicateDesignName(card, references?.document.cards || [])
  const issue = error || (duplicate ? uiText("该名称已被同类型卡片使用，请使用其他名称") : undefined)
  useEffect(() => {
    if (!title?.open || disabled) setEditing(false)
    else if (error && !name) setEditing(true)
  }, [title?.open, disabled, error, name])
  useLayoutEffect(() => {
    if (!editing || !title?.open) return
    let frame = 0, attempts = 0
    const focus = () => {
      const node = input.current?.input
      if (node && !node.closest('[inert]') && node.getClientRects().length) input.current?.focus({ cursor: 'all', preventScroll: true })
      else if (++attempts < 30) frame = requestAnimationFrame(focus)
    }
    frame = requestAnimationFrame(focus)
    return () => cancelAnimationFrame(frame)
  }, [editing, title?.open])
  const finish = () => {
    setEditing(false)
    requestAnimationFrame(() => action.current?.focus({ preventScroll: true }))
  }
  if (!title?.host) return null
  return createPortal(<div className="design-title-name" data-diagnostic-name tabIndex={-1}>
    <div className="design-title-row">
      {editing && !disabled ? <Input ref={input} id={id} aria-label={label} aria-invalid={!!issue} aria-describedby={issue ? `${id}-error` : undefined} value={value} placeholder={placeholder} status={issue ? 'error' : undefined} onChange={event => onChange(event.target.value)} onBlur={() => setEditing(false)} onKeyDown={event => {
        if (!event.nativeEvent.isComposing && (event.key === 'Enter' || event.key === 'Escape')) { event.preventDefault(); event.stopPropagation(); finish() }
      }} /> : name ? <h2 className="design-title-heading" title={name}>{name}</h2> : disabled && <small>{uiText("未设置名称")}</small>}
      <span className="design-title-tools">
        {!editing && !disabled && <><button type="button" ref={action} className="design-title-edit" aria-label={uiText("编辑{{label}}", { label })} aria-describedby={issue ? `${id}-error` : undefined} onClick={() => setEditing(true)}>{issue && <Typography.Text type="danger" className="design-title-error-dot" aria-hidden="true">●</Typography.Text>}{name ? uiText("重命名") : uiText("未设置名称")}</button><span aria-hidden="true">-</span></>}
        <small className="design-title-type">{title.typeLabel}</small>
      </span>
    </div>
    {issue && <Typography.Text type="danger" id={`${id}-error`} role="alert" className="design-reference-issue">{issue}</Typography.Text>}
  </div>, title.host)
}
