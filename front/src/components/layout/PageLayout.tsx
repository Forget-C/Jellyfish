import type { HTMLAttributes, ReactNode } from 'react'

type LayoutSlotProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode
}

/** 页面共用的标题与操作区；业务页签及内容保留在各自页面。 */
export function PageToolbar({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return <div className="app-page-toolbar">
    {title && <h1 className="app-page-title">{title}</h1>}
    {children}
  </div>
}

/**
 * Provides the full-height flex boundary used by route pages with local panels.
 * It deliberately owns no scroll behavior so a workspace can explicitly choose
 * the panel that scrolls instead of accidentally clipping route content.
 */
export function WorkspaceLayout({ children, className = '', ...props }: LayoutSlotProps) {
  return (
    <section className={`app-workspace ${className}`.trim()} {...props}>
      {children}
    </section>
  )
}

/**
 * Defines the default vertical scroll surface inside a WorkspaceLayout.
 * Use this for natural-height content such as dashboards and lists.
 */
export function WorkspaceScrollPanel({ children, className = '', ...props }: LayoutSlotProps) {
  return (
    <div className={`app-workspace-scroll ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}
