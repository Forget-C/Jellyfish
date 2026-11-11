import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PageToolbar } from '../../../../components'

const ToolbarContext = createContext<{ target: HTMLDivElement | null; setCustom: (value: boolean) => void } | null>(null)

/** 项目子页面把本页标题和操作放入同一固定工具栏，未迁移页继续使用原入口。 */
export function ProjectToolbarProvider({ title, actions, children }: { title: ReactNode; actions: ReactNode; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const [custom, setCustom] = useState(false)
  return <ToolbarContext.Provider value={{ target, setCustom }}>
    <PageToolbar title={custom ? undefined : title} className="project-content-toolbar">
      {!custom && actions}
      <div ref={setTarget} className="project-content-toolbar-slot" hidden={!custom} />
    </PageToolbar>
    {children}
  </ToolbarContext.Provider>
}

export function ProjectContentToolbar({ children }: { children: ReactNode }) {
  const context = useContext(ToolbarContext)
  const setCustom = context?.setCustom
  useLayoutEffect(() => {
    setCustom?.(true)
    return () => setCustom?.(false)
  }, [setCustom])
  return context?.target ? createPortal(children, context.target) : null
}
