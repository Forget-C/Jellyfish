import { CanvasEditorTabs } from './CanvasEditorTabs'
import { designFieldEntries } from './designFieldReferences'
import { isDesignFieldConfigured } from './designFieldConfiguration'
import { useGraphRules } from './CanvasCatalogContext'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import { Tooltip, theme } from 'antd'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { DesignReferenceContext } from './DesignReferenceEditor'

/** Fixed parameter groups retain their session without moving the modal chrome. */
export function DesignParameterTabs({ items, editorOpen }: { items: { key: string; label: ReactNode; fields: string[]; children: ReactNode }[]; editorOpen?: boolean }) {
  const { token } = theme.useToken()
  const [active, setActive] = useState(items[0].key)
  const references = useContext(DesignReferenceContext)
  const { cardDefinitions } = useGraphRules()
  const fields = references ? Object.fromEntries(designFieldEntries(references.card)) : {}
  const owner = useRef<HTMLDivElement>(null)
  const positions = useRef<Record<string, number>>({})
  const defaultKey = items[0].key
  useEffect(() => { if (editorOpen === false) { setActive(defaultKey); positions.current = {} } }, [editorOpen, defaultKey])
  const targetGroup = items.find(item => references?.targetField && item.fields.includes(references.targetField.fieldId))?.key
  useEffect(() => {
    if (editorOpen !== false && targetGroup) setActive(targetGroup)
  }, [editorOpen, targetGroup, references?.targetField?.serial])
  const [hint, setHint] = useState<string>()
  return <div ref={owner} className="design-parameter-tabs" onFocusCapture={event => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('.ant-tabs-tab')
    setHint(tab?.dataset.nodeKey)
  }} onBlurCapture={() => setHint(undefined)}><CanvasEditorTabs activeKey={active} items={items.map(item => {
    const issues = references?.issues.filter(issue => item.fields.includes(issue.field_id)) || []
    const configured = item.fields.some(field => isDesignFieldConfigured(fields[field], references && cardDefinitions[references.card.type!]?.fields.find(value => value.id === field)?.default_value))
    const status = issues.length ? `存在引用错误：${issues.map(issue => issue.message).join('；')}` : configured ? '已有内容' : undefined
    return { ...item, label: <Tooltip title={status} open={!!status && hint === item.key} onOpenChange={open => setHint(previous => open ? item.key : previous === item.key ? undefined : previous)}><span className="design-tab-label">{item.label}<span className="design-tab-status" role={status ? 'img' : undefined} aria-label={status} aria-hidden={!status}>{issues.length ? <ExclamationCircleOutlined style={{ color: token.colorError }} /> : configured ? <i /> : null}</span></span></Tooltip>, forceRender: true, children: <div className="canvas-editor-tab-page design-parameter-page" onScroll={event => { positions.current[item.key] = event.currentTarget.scrollTop }}>{item.children}</div> }
  })} onChange={key => {
    references?.changeMode()
    setActive(key)
    requestAnimationFrame(() => { const panel = owner.current?.querySelector<HTMLElement>(`.ant-tabs-tabpane-active .design-parameter-page`); if (panel) panel.scrollTop = positions.current[key] || 0 })
  }} /></div>
}
