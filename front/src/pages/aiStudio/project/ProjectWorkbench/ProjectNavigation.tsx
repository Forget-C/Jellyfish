import { useEffect, useRef, useState } from 'react'
import { Button, Drawer } from 'antd'
import { ArrowLeftOutlined, MenuOutlined } from '@ant-design/icons'
import { Link, useLocation } from 'react-router-dom'
import { projectNavigationGroups, projectTabLocation, resolveProjectTab } from './constants'
import './project-navigation.css'

/** 项目菜单在各个普通项目路由间共享，窄屏用同一组链接打开抽屉。 */
export function ProjectNavigation({ projectId, projectName }: { projectId: string; projectName?: string }) {
  const { pathname, search } = useLocation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const projectArea = pathname.split('/')[3]
  const current = projectArea === 'roles' ? 'roles'
    : projectArea === 'chapters' ? 'chapters'
      : resolveProjectTab(new URLSearchParams(search).get('tab'))

  const restoreTriggerFocus = () => {
    requestAnimationFrame(() => {
      const trigger = triggerRef.current
      if (trigger?.getAttribute('aria-expanded') === 'false') trigger.focus({ preventScroll: true })
    })
  }
  const closeDrawer = () => {
    if (!open) return
    setOpen(false)
    // Escape 可打断展开动画，焦点恢复不依赖动画完成。
    restoreTriggerFocus()
  }

  useEffect(() => { setOpen(false) }, [pathname, search])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  const menu = <nav className="app-project-navigation" aria-label="项目导航">
    <Link to="/projects" className="app-project-back" onClick={closeDrawer}>
      <ArrowLeftOutlined aria-hidden="true" /><span>返回项目列表</span>
    </Link>
    <strong className="app-project-name" title={projectName}>{projectName || '项目'}</strong>
    {projectNavigationGroups.map(group => <div className="app-project-nav-group" key={group.label}>
      <span className="app-project-nav-heading">{group.label}</span>
      {group.items.map(item => <Link
        key={item.key}
        className="app-project-nav-link"
        to={projectTabLocation(projectId, item.key)}
        aria-current={item.key === current ? 'page' : undefined}
        onClick={closeDrawer}
      ><span aria-hidden="true">{item.icon}</span><span>{item.label}</span></Link>)}
    </div>)}
  </nav>

  return <>
    <aside className="app-project-sidebar">{menu}</aside>
    <div className="app-project-navigation-toggle">
      <Button ref={triggerRef} type="text" aria-label="打开项目导航" aria-expanded={open} icon={<MenuOutlined />} onClick={() => setOpen(true)}>
        {projectName || '项目导航'}
      </Button>
    </div>
    <Drawer
      title="项目导航"
      placement="left"
      width={272}
      open={open}
      onClose={closeDrawer}
      afterOpenChange={visible => { if (!visible) restoreTriggerFocus() }}
    >{menu}</Drawer>
  </>
}
