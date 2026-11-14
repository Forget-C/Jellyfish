import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftOutlined, CloseOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useAppStore } from '../../../../store/useAppStore'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../../components'

type Props = {
  id: string; open: boolean; drawer: boolean; inline?: boolean; title: string; backLabel: string
  onClose: () => void; actions: ReactNode; children: ReactNode
  renderToolbar?: (children: ReactNode) => ReactNode
}

/** 新建使用抽屉，已有对象详情在正文中展示；两种容器复用同一编辑内容。 */
export function ResourceEditorFrame({ id, open, drawer, inline, title, backLabel, onClose, actions, children, renderToolbar }: Props) {
  const appearance = useAppStore(state => state.appearance)
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
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    if (!drawer || !open) return
    const source = anchor.current
    const target = source?.closest('.management-content')
      ?? source?.closest('.project-workbench-content')?.parentElement
      ?? source?.closest('.app-route-viewport')
      ?? source?.closest('.app-workspace')
      ?? document.body
    const update = () => setBounds(target.getBoundingClientRect())
    const observer = new ResizeObserver(update)
    observer.observe(target)
    // 导航行换行或断点切换会改变位置，即使内容宽度不变也要重新定位。
    window.addEventListener('resize', update)
    update()
    const previous = document.activeElement as HTMLElement | null
    const covered = [...target.children].filter((node): node is HTMLElement => node instanceof HTMLElement)
    const inertStates = covered.map(node => node.inert)
    covered.forEach(node => { node.inert = true })
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      covered.forEach((node, index) => { node.inert = inertStates[index] })
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [drawer, open])
  const positioned = !!bounds
  useEffect(() => {
    if (drawer && open && positioned) panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [drawer, open, positioned])
  if (drawer) return <><span ref={anchor} hidden />{open && bounds && createPortal(
    <div className={`resource-editor-drawer ant-drawer resource-editor-appearance-${appearance}${scrollEdges.top ? ' resource-editor-scrolled' : ''}${scrollEdges.bottom ? ' resource-editor-more' : ''}${bounds.x > 0 ? '' : ' resource-editor-no-side'}`}
      style={{ top: bounds.y, left: bounds.x, width: bounds.width, height: bounds.height, maxWidth: `calc(100vw - ${bounds.x}px)`, maxHeight: `calc(100dvh - ${bounds.y}px)` }}>
      <div className="ant-drawer-content-wrapper">
        <div ref={panel} id={id} role="dialog" aria-modal="false" aria-label={title} className="ant-drawer-content"
          style={{ backgroundPosition: `right -${bounds.y}px` }} onKeyDown={event => {
            if (event.key !== 'Escape' || event.defaultPrevented) return
            if ([...document.querySelectorAll<HTMLElement>('.ant-image-preview-wrap')].some(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')) return
            event.stopPropagation()
            onClose()
          }}>
          <div className="ant-drawer-header"><div className="ant-drawer-header-title">
            <Button type="text" className="ant-drawer-close" icon={<CloseOutlined />} aria-label="关闭面板" onClick={onClose} />
            <div className="ant-drawer-title">{title}</div>
          </div></div>
          <div className="ant-drawer-body"><div className="resource-editor-drawer-content" ref={captureBody}>{children}</div></div>
          <div className="ant-drawer-footer">{actions}</div>
        </div>
      </div>
    </div>, document.body)}</>
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
