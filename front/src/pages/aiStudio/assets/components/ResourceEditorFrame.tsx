import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { Button, Drawer } from 'antd'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../../components'

type Props = {
  id: string; open: boolean; drawer: boolean; inline?: boolean; title: string; backLabel: string
  onClose: () => void; actions: ReactNode; children: ReactNode
  renderToolbar?: (children: ReactNode) => ReactNode
}

/** 新建使用抽屉，已有对象详情在正文中展示；两种容器复用同一编辑内容。 */
export function ResourceEditorFrame({ id, open, drawer, inline, title, backLabel, onClose, actions, children, renderToolbar }: Props) {
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false })
  const [body, setBody] = useState<HTMLElement | null>(null)
  const captureBody = useCallback((node: HTMLDivElement | null) => setBody(node?.parentElement ?? null), [])
  useEffect(() => {
    if (!drawer || !open || !body) return
    const update = () => setScrollEdges({ top: body.scrollTop > 0, bottom: body.scrollTop + body.clientHeight < body.scrollHeight - 1 })
    const observer = new ResizeObserver(update)
    observer.observe(body)
    if (body.firstElementChild) observer.observe(body.firstElementChild)
    body.addEventListener('scroll', update, { passive: true })
    update()
    return () => { observer.disconnect(); body.removeEventListener('scroll', update) }
  }, [drawer, open, body])
  if (drawer) return <Drawer id={id} rootClassName={`resource-editor-drawer${scrollEdges.top ? ' resource-editor-scrolled' : ''}${scrollEdges.bottom ? ' resource-editor-more' : ''}`} width="100%" title={title}
    afterOpenChange={visible => {
      if (!visible) { setScrollEdges({ top: false, bottom: false }); return }
      const node = document.getElementById(id)
      node?.setAttribute('aria-label', title)
      const body = node?.querySelector<HTMLElement>('.ant-drawer-body')
      if (body) setScrollEdges({ top: body.scrollTop > 0, bottom: body.scrollTop + body.clientHeight < body.scrollHeight - 1 })
    }}
    open={open} onClose={event => {
      if (event.type === 'keydown' && [...document.querySelectorAll<HTMLElement>('.ant-image-preview-wrap')].some(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')) return
      onClose()
    }} footer={actions}><div className="resource-editor-drawer-content" ref={captureBody}>{children}</div></Drawer>
  if (!open) return null
  const toolbar = <>
    <div className="resource-editor-page-heading"><Button type="text" icon={<ArrowLeftOutlined />} aria-label={backLabel} onClick={onClose}>{backLabel}</Button>
      <h1 className="app-page-title" title={title}>{title}</h1></div>
    <div className="resource-editor-page-actions">{actions}</div>
  </>
  const escape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && backLabel !== '返回' && !event.defaultPrevented) { event.stopPropagation(); onClose() }
  }
  if (inline || renderToolbar) return <section onKeyDown={escape} id={id} aria-label={title} className="resource-editor-page resource-editor-inline">
    {renderToolbar ? renderToolbar(toolbar) : <PageToolbar>{toolbar}</PageToolbar>}
    <div className="resource-editor-body">{children}</div>
  </section>
  return <WorkspaceLayout onKeyDown={escape} id={id} aria-label={title} className="resource-editor-page">
    <PageToolbar>{toolbar}</PageToolbar>
    <WorkspaceScrollPanel className="resource-editor-body">{children}</WorkspaceScrollPanel>
  </WorkspaceLayout>
}
