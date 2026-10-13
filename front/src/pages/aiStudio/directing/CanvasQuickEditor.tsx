import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from 'antd'

/** 快速字段编辑覆盖画布，不占布局空间；开启状态由工作台统一仲裁。 */
export function CanvasQuickEditor({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null
    const field = panel.current?.querySelector<HTMLElement>('textarea:not(:disabled), input:not(:disabled)') || panel.current?.querySelector<HTMLElement>('button')
    field?.focus({ preventScroll: true })
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }) }
  }, [])
  return createPortal(<aside ref={panel} className="canvas-quick-editor canvas-workbench-dialog" aria-label={title}>
    <header><h2>{title}</h2><Button onClick={onClose}>关闭编辑区</Button></header>
    {children}
  </aside>, document.body)
}
