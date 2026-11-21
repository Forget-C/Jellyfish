import { useUiText } from '../../uiText'
import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { DownOutlined, UpOutlined } from '@ant-design/icons'
import { WorkbenchButton } from './WorkbenchButton'

/** 单一正文按实际行数原位展开；响应宽度变化，不改变业务内容。 */
export function CanvasTextPreview({ text, label, lines = 6, paragraphClassName = '' }: { text: string; label: string; lines?: number; paragraphClassName?: string }) {
  const uiText = useUiText()
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const paragraph = useRef<HTMLParagraphElement>(null)
  const id = useId()
  useEffect(() => {
    setExpanded(false)
    const node = paragraph.current
    if (!node) return
    const measure = () => setOverflows(node.scrollHeight > parseFloat(getComputedStyle(node).lineHeight) * lines + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    measure()
    return () => observer.disconnect()
  }, [text, lines])
  return <div className="canvas-text-preview" style={{ '--wb-preview-lines': lines } as CSSProperties}>
    <p id={id} ref={paragraph} className={`${paragraphClassName} ${expanded ? '' : 'is-collapsed'}`}>{text}</p>
    {overflows && <WorkbenchButton variant="quiet" size="small" icon={expanded ? <UpOutlined aria-hidden="true" /> : <DownOutlined aria-hidden="true" />} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? uiText("收起{{label}}", { label }) : uiText("展开{{label}}", { label })}</WorkbenchButton>}
  </div>
}
