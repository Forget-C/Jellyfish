import { useState } from 'react'
import { Button } from 'antd'

/** 长正文先显示摘要；展开仅影响阅读，不修改业务内容。 */
export function CanvasTextPreview({ text, label }: { text: string; label: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 160 || text.split('\n').length > 5
  return <div className="canvas-text-preview">
    <p className={long && !expanded ? 'is-collapsed' : undefined}>{text}</p>
    {long && <Button type="text" size="small" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? `收起${label}` : `展开${label}`}
    </Button>}
  </div>
}
