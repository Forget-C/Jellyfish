import { useUiText } from '../uiText'
import { useEffect, useRef, useState } from 'react'
import { Button, Drawer } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { WorkspaceLayout, WorkspaceScrollPanel } from '../components/layout/PageLayout'
import { managementNavigation, managementPageForPath } from './navigation'
import './management-layout.css'

/** 现有管理地址共用一个领域侧栏，详情页依然由原业务路由承载。 */
export default function ManagementLayout() {
  const uiText = useUiText()
  const { key, pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const navigationTrigger = useRef<HTMLButtonElement>(null)
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const currentPage = managementPageForPath(pathname)?.to

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const update = () => {
      setWide(query.matches)
      if (query.matches) setOpen(false)
    }
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => { setOpen(false) }, [key])

  const links = (
    <nav className="management-links" aria-label={uiText("管理导航")}>
      {managementNavigation.map(({ to, label }) => (
        <Link key={to} to={to} className="app-nav-link"
          aria-current={currentPage === to ? 'page' : undefined} onClick={() => setOpen(false)}>
          {uiText(label)}
        </Link>
      ))}
    </nav>
  )

  return (
    <WorkspaceLayout className="management-layout">
      {wide ? links : <>
        <div className="management-navigation-trigger">
          <Button ref={navigationTrigger} type="text" icon={<MenuOutlined />} aria-label={uiText("打开管理导航")}
            aria-expanded={open} onClick={() => setOpen(true)}>{uiText("管理导航")}</Button>
        </div>
        <Drawer title={uiText("管理导航")} aria-label={uiText("管理导航")} placement="left" width="min(272px, 100vw)" open={open}
          onClose={() => setOpen(false)}
          afterOpenChange={shown => { if (!shown) requestAnimationFrame(() => navigationTrigger.current?.focus({ preventScroll: true })) }}>{links}</Drawer>
      </>}
      <WorkspaceScrollPanel className="management-content"><Outlet /></WorkspaceScrollPanel>
    </WorkspaceLayout>
  )
}
