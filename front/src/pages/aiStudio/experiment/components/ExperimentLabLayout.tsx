import { useEffect, useState, type ReactNode } from 'react'
import { Button, Drawer, Grid } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import { useLocation } from 'react-router-dom'
import { PageToolbar, WorkspaceLayout } from '../../../../components'

type ExperimentLabLayoutProps = {
  title: string
  extra?: ReactNode
  sidebar?: ReactNode
  history: ReactNode
  composer: ReactNode
  overlays?: ReactNode
}

/** 会话侧栏与生成区共享全站边界；窄屏打开同一个会话导航，输入区独立于历史滚动。 */
export function ExperimentLabLayout({ title, extra, sidebar, history, composer, overlays }: ExperimentLabLayoutProps) {
  const { xl } = Grid.useBreakpoint()
  const { search } = useLocation()
  const [sessionsOpen, setSessionsOpen] = useState(false)
  useEffect(() => { setSessionsOpen(false) }, [search])
  return (
    <WorkspaceLayout>
      <div className="app-lab-layout">
        {xl && sidebar}
        <section className="app-lab-main" aria-label={title}>
          <PageToolbar title={title}>
            {!xl && <Button icon={<MenuOutlined />} onClick={() => setSessionsOpen(true)}>会话导航</Button>}
            <div className="app-page-actions">{extra}</div>
          </PageToolbar>
          <div className="app-lab-content">
            <div className="app-lab-history">{history}</div>
            {composer}
          </div>
        </section>
      </div>
      {!xl && <Drawer title="会话导航" placement="left" width={272} open={sessionsOpen} onClose={() => setSessionsOpen(false)}>{sidebar}</Drawer>}
      {overlays}
    </WorkspaceLayout>
  )
}
