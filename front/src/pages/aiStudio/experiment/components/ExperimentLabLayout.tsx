import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { Button, Drawer } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import { useLocation } from 'react-router-dom'
import { PageToolbar, WorkspaceLayout } from '../../../../components'
import './experiment-navigation.css'

type ExperimentLabLayoutProps = {
  title: string
  extra?: ReactNode
  sidebar: (close: () => void) => ReactNode
  sidebarTrigger: RefObject<HTMLButtonElement>
  history: ReactNode
  composer: ReactNode
  overlays?: ReactNode
}

/** 实验室类型与会话共用同一侧栏，输入区独立于会话和消息滚动。 */
export function ExperimentLabLayout({ title, extra, sidebar, sidebarTrigger, history, composer, overlays }: ExperimentLabLayoutProps) {
  const { key } = useLocation()
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const update = () => {
      setWide(query.matches)
      if (query.matches) setSessionsOpen(false)
    }
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => { setSessionsOpen(false) }, [key])

  const closeNavigation = () => {
    if (!sessionsOpen) return
    setSessionsOpen(false)
    // 跨模态时布局重新挂载，返回页面持有的同一个入口引用。
    requestAnimationFrame(() => sidebarTrigger.current?.focus({ preventScroll: true }))
  }

  return (
    <WorkspaceLayout>
      <div className="app-lab-layout">
        {wide && sidebar(closeNavigation)}
        <section className="app-lab-main" aria-label={title}>
          <PageToolbar title={title}>
            {!wide && <Button ref={sidebarTrigger} type="text" icon={<MenuOutlined />}
              aria-label="会话导航" aria-expanded={sessionsOpen} onClick={() => setSessionsOpen(true)}>会话导航</Button>}
            <div className="app-page-actions">{extra}</div>
          </PageToolbar>
          <div className="app-lab-content">
            <div className="app-lab-history">{history}</div>
            {composer}
          </div>
        </section>
      </div>
      {!wide && <Drawer title="会话导航" placement="left" width="min(272px, 100vw)"
        open={sessionsOpen} onClose={closeNavigation}>{sidebar(closeNavigation)}</Drawer>}
      {overlays}
    </WorkspaceLayout>
  )
}
