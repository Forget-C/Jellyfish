import type { KeyboardEvent, ReactNode } from 'react'
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
  if (drawer) return <Drawer id={id} rootClassName="resource-editor-drawer" width={680} title={title}
    afterOpenChange={visible => { if (visible) document.getElementById(id)?.setAttribute('aria-label', title) }}
    open={open} onClose={event => {
      if (event.type === 'keydown' && [...document.querySelectorAll<HTMLElement>('.ant-image-preview-wrap')].some(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')) return
      onClose()
    }} footer={actions}>{children}</Drawer>
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
