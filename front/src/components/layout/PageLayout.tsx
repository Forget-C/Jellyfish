import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

type LayoutSlotProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode
}

/** 页面共用的标题与操作区；业务页签及内容保留在各自页面。 */
export function PageToolbar({ title, children, className }: { title?: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={className ? `app-page-toolbar ${className}` : 'app-page-toolbar'}>
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
export const WorkspaceScrollPanel = forwardRef<HTMLDivElement, LayoutSlotProps>(function WorkspaceScrollPanel(
  { children, className = '', ...props }, ref,
) {
  return (
    <div ref={ref} className={`app-workspace-scroll ${className}`.trim()} {...props}>
      {children}
    </div>
  )
})
