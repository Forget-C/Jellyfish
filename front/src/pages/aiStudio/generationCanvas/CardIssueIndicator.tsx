import { useUiText } from '../../../uiText'
import { useEffect, useId, useRef, useState } from 'react'
import { Popover, theme } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import type { CanvasDiagnostic } from '../../../services/generated'
import { WorkbenchButton, WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'

/** 标题图标只负责展开说明，跳转由用户选择具体问题的入口触发。 */
export function CardIssueIndicator({ issues, onLocate, actionFor, relatedActionsFor }: {
  issues: CanvasDiagnostic[]
  onLocate: (issue: CanvasDiagnostic, trigger: HTMLElement, target?: CanvasDiagnostic['target']) => void
  actionFor: (issue: CanvasDiagnostic) => string | undefined
  relatedActionsFor?: (issue: CanvasDiagnostic) => { id: string; label: string; target?: CanvasDiagnostic['target'] }[]
}) {
  const uiText = useUiText()
  const [open, setOpen] = useState(false)
  const { token } = theme.useToken()
  const id = useId()
  const panel = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const first = panel.current?.querySelector<HTMLElement>('button') || panel.current
      first?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [open])
  const error = issues.some(issue => issue.severity !== 'warning')
  const severity = (issue: CanvasDiagnostic) => issue.severity === 'warning' ? '警告' : '错误'
  const locate = (issue: CanvasDiagnostic, target?: CanvasDiagnostic['target']) => {
    setOpen(false)
    if (trigger.current) onLocate(issue, trigger.current, target)
  }
  const messages = issues.map(issue => `${severity(issue)}：${issue.message}`)
  return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomRight"
    content={<section id={id} ref={panel} tabIndex={-1} aria-label={uiText("卡片问题")} className="generation-card-issues" onKeyDown={event => {
      if (event.key !== 'Escape') return
      event.stopPropagation(); setOpen(false)
      trigger.current?.focus({ preventScroll: true })
    }}>
      <ul>{issues.map((issue, index) => {
        const action = actionFor(issue)
        return <li key={`${issue.code}:${index}`}><small>{severity(issue)}</small><span>{issue.message}</span>
          {action && <WorkbenchButton size="small" onClick={() => locate(issue)}>{action}</WorkbenchButton>}
          {relatedActionsFor?.(issue).map(({ id, label, target }) => target
            ? <WorkbenchButton key={id} size="small" onClick={() => locate(issue, target)}>{label}</WorkbenchButton>
            : <small key={id}>{label}</small>)}
        </li>
      })}</ul>
    </section>}>
    <span>
      <WorkbenchIconButton ref={trigger} variant="quiet" label={uiText("查看卡片问题")} tooltip={messages.join('；')}
        tooltipTrigger={['hover', 'focus']} tooltipOpen={open ? false : undefined}
        aria-expanded={open} aria-controls={open ? id : undefined}
        icon={<ExclamationCircleOutlined style={{ color: error ? token.colorError : token.colorWarning }} />}
        onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false) } }} />
    </span>
  </Popover>
}
