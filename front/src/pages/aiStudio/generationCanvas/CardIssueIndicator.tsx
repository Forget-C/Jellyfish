import { useEffect, useId, useRef, useState } from 'react'
import { Popover, theme, Tooltip } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import type { CanvasDiagnostic } from '../../../services/generated'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'

/** 标题图标只负责展开说明，跳转由用户选择具体问题的入口触发。 */
export function CardIssueIndicator({ issues, onLocate, actionFor }: {
  issues: CanvasDiagnostic[]
  onLocate: (issue: CanvasDiagnostic, trigger: HTMLElement) => void
  actionFor: (issue: CanvasDiagnostic) => string | undefined
}) {
  const [open, setOpen] = useState(false)
  const { token } = theme.useToken()
  const id = useId()
  const panel = useRef<HTMLElement>(null)
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
  const messages = issues.map(issue => `${severity(issue)}：${issue.message}`)
  return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomRight"
    content={<section id={id} ref={panel} tabIndex={-1} aria-label="卡片问题" className="generation-card-issues" onKeyDown={event => {
      if (event.key !== 'Escape') return
      event.stopPropagation(); setOpen(false)
      document.getElementById(`${id}-trigger`)?.focus({ preventScroll: true })
    }}>
      <ul>{issues.map((issue, index) => {
        const action = actionFor(issue)
        return <li key={`${issue.code}:${index}`}><small>{severity(issue)}</small><span>{issue.message}</span>
          {action && <WorkbenchButton size="small" onClick={() => {
            setOpen(false)
            const trigger = document.getElementById(`${id}-trigger`)
            if (trigger) onLocate(issue, trigger)
          }}>{action}</WorkbenchButton>}
        </li>
      })}</ul>
    </section>}>
    <span className="wb-icon-trigger">
      <Tooltip title={messages.join('；')} trigger={['hover', 'focus']} open={open ? false : undefined}>
        <WorkbenchButton id={`${id}-trigger`} variant="quiet" className="wb-icon-action" aria-label="查看卡片问题"
          aria-expanded={open} aria-controls={open ? id : undefined}
          icon={<ExclamationCircleOutlined style={{ color: error ? token.colorError : token.colorWarning }} />}
          onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false) } }} />
      </Tooltip>
    </span>
  </Popover>
}
