import { useEffect, useId, useRef, useState } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, Drawer, Input } from 'antd'
import type { InputRef } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useWorkbenchDesktop } from './useWorkbenchDesktop'

/** 当前Drawer版本不透传可访问名称，将名称附到自有内容所在的对话框。 */
export function nameWorkbenchDialog(node: HTMLElement | null, title: string) {
  node?.closest('[role="dialog"]')?.setAttribute('aria-label', title)
}

/** 工具栏仅统一布局；版本、主操作及其授权条件由各业务层提供。 */
export function WorkbenchToolbar({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`sequence-version-bar workbench-toolbar ${className}`} />
}

export function WorkbenchObjectBar({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`workbench-object-bar ${className}`} />
}

export function navigationMatches(query: string, ...labels: string[]) {
  return labels.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}

/** 查询与选择互不修改；收起时清空条件，恢复非空查询时显式展开。 */
export function WorkbenchNavigation({ title, query, onQuery, placeholder, children }: {
  title: string; query: string; onQuery: (query: string) => void; placeholder: string; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(!!query)
  const input = useRef<InputRef>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => { if (query) setExpanded(true) }, [query])
  const close = () => { onQuery(''); setExpanded(false); toggle.current?.focus() }
  return <div className="design-navigation workbench-navigation">
    <header data-navigation-tool><h2>{title}</h2><Button ref={toggle} type="text" aria-label={`搜索${title}`} aria-expanded={expanded} aria-controls={id} icon={<SearchOutlined />} onClick={() => { if (expanded) close(); else { setExpanded(true); requestAnimationFrame(() => input.current?.focus()) } }} /></header>
    <div id={id} hidden={!expanded} data-navigation-tool className="workbench-navigation-search"><Input ref={input} aria-label={placeholder} placeholder={placeholder} prefix={<SearchOutlined />} value={query} allowClear onChange={event => onQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }} /></div>
    {children}
  </div>
}

/** 响应式切换只移动同一个门户容器，编辑器、视频及其草稿不重挂载。 */
export function WorkbenchInspector({ children, className, title, open, onClose, width = 344, visible = true, closable = true }: {
  children: ReactNode; className: string; title?: string; open: boolean; onClose: () => void; width?: number; visible?: boolean; closable?: boolean;
}) {
  const desktop = useWorkbenchDesktop()
  const [container] = useState(() => { const node = document.createElement('div'); node.className = 'workbench-inspector-host'; return node })
  const mount = (node: HTMLElement | null) => { if (node && container.parentElement !== node) node.appendChild(container); nameWorkbenchDialog(node, title || '指令详情') }
  return <>{desktop ? <aside className={className} aria-label={title} hidden={!visible} ref={mount} /> : <Drawer title={title} closable={closable} open={open} onClose={onClose} width={`min(${width}px, 100vw)`} styles={{ body: { padding: 0 } }} forceRender><div className="workbench-inspector-host" ref={mount} /></Drawer>}{createPortal(children, container)}</>
}
