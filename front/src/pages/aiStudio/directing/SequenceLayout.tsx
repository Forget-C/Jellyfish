import { useWorkbenchDesktop } from './useWorkbenchDesktop'
import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, Drawer } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import { nameWorkbenchDialog } from './WorkbenchChrome'

const NavigationContext = createContext<HTMLElement | null>(null)

/** 业务导航与阶段栏各占一列；门户只移动展示位置，不重挂载业务编辑状态。 */
export function SequenceLayout({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const mountNavigation = useCallback((node: HTMLDivElement | null) => { setTarget(node); nameWorkbenchDialog(node, '场次导航') }, [])
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(208)
  const desktop = useWorkbenchDesktop()
  const compact = !desktop
  const navigation = <div className="sequence-navigation-content" ref={mountNavigation} onClick={event => { if (compact && (event.target as Element).closest('button') && !(event.target as Element).closest('[data-navigation-tool]')) setOpen(false) }} />
  return <NavigationContext.Provider value={target}>
    <div className="sequence-layout" style={{ '--sequence-nav-width': `${collapsed ? 48 : width}px` } as React.CSSProperties}>
      {!compact && <aside className={`sequence-navigation${collapsed ? ' is-collapsed' : ''}`}>
        <Button type="text" className="sequence-collapse" aria-label={collapsed ? '展开场次导航' : '收起场次导航'} icon={<MenuOutlined />} onClick={() => setCollapsed(!collapsed)} />
        {navigation}
        {!collapsed && <div className="sequence-resizer" role="separator" aria-label="调整场次导航宽度" tabIndex={0} aria-valuemin={176} aria-valuemax={280} aria-valuenow={width} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidth(v => Math.max(176, Math.min(280, v + (event.key === 'ArrowRight' ? 8 : -8)))) } if (event.key === 'Home') setWidth(208) }} onDoubleClick={() => setWidth(208)} onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId)
        }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(Math.max(176, Math.min(280, event.clientX - 64))) }} />}
      </aside>}
      <main className="sequence-main">{compact && <Button aria-label="场次导航" className="sequence-mobile-navigation" icon={<MenuOutlined />} onClick={() => setOpen(true)}>场次导航</Button>}{children}</main>
      <footer className="sequence-status">{footer}<Button type="text" size="small" onClick={() => { setWidth(208); setCollapsed(false); window.dispatchEvent(new Event('sequence-reset-layout')) }}>恢复默认布局</Button></footer>
      {compact && <Drawer title="场次导航" placement="left" width={272} open={open} onClose={() => setOpen(false)} forceRender>{navigation}</Drawer>}
    </div>
  </NavigationContext.Provider>
}

export function SequenceNavigation({ children }: { children: ReactNode }) {
  const target = useContext(NavigationContext)
  return target ? createPortal(children, target) : null
}
