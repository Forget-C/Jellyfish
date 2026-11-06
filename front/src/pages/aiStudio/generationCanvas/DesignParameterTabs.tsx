import { designFieldEntries } from './designFieldReferences'
import { isDesignFieldConfigured } from './designFieldConfiguration'
import { useGraphRules } from './CanvasCatalogContext'
import { Tabs, theme } from 'antd'
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
  return <div ref={owner} className="design-parameter-tabs"><Tabs activeKey={active} items={items.map(item => ({ ...item, label: <>{item.label}{item.fields.some(field => references?.issues.some(issue => issue.field_id === field)) ? <span className="design-tab-error" style={{ color: token.colorError }} aria-label="存在引用错误"> !</span> : item.fields.some(field => isDesignFieldConfigured(fields[field], references && cardDefinitions[references.card.type!]?.fields.find(value => value.id === field)?.default_value)) ? <span className="design-tab-configured" aria-label="已有内容"> ·</span> : null}</>, forceRender: true, children: <div className="design-parameter-page" onScroll={event => { positions.current[item.key] = event.currentTarget.scrollTop }}>{item.children}</div> }))} onChange={key => {
    references?.changeMode()
    setActive(key)
    requestAnimationFrame(() => { const panel = owner.current?.querySelector<HTMLElement>(`.ant-tabs-tabpane-active .design-parameter-page`); if (panel) panel.scrollTop = positions.current[key] || 0 })
  }} /></div>
}
