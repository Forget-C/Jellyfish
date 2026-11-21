import { useUiText } from '../../../../uiText'
import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { Button, Drawer, Dropdown } from 'antd'
import { MenuOutlined, MoreOutlined } from '@ant-design/icons'
import { useLocation } from 'react-router-dom'
import { PageToolbar, WorkspaceLayout } from '../../../../components'
import { ExperimentSessionConfirmation } from './ExperimentSessionConfirmation'
import './experiment-navigation.css'

type ExperimentLabLayoutProps = {
  title: string
  sessionTitle?: string
  clearContent?: () => Promise<void>
  sidebar: (close: () => void) => ReactNode
  sidebarTrigger: RefObject<HTMLButtonElement>
  history: ReactNode
  composer: ReactNode
  overlays?: ReactNode
}

/** 实验室类型与会话共用同一侧栏，输入区独立于会话和消息滚动。 */
export function ExperimentLabLayout({ title, sessionTitle, clearContent, sidebar, sidebarTrigger, history, composer, overlays }: ExperimentLabLayoutProps) {
  const uiText = useUiText()
  const { key } = useLocation()
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [clearTarget, setClearTarget] = useState<{ title: string; run: () => Promise<void> }>()
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
    <WorkspaceLayout className="experiment-workspace">
      <div className="app-lab-layout">
        {wide && sidebar(closeNavigation)}
        <section className="app-lab-main" aria-label={title}>
          <PageToolbar className="experiment-toolbar" title={<>{title}<span className="experiment-session-title" title={sessionTitle}> · {sessionTitle ?? uiText("新会话")}</span></>}>
            {!wide && <Button className="experiment-navigation-trigger" ref={sidebarTrigger} type="text" icon={<MenuOutlined />}
              title={uiText("会话导航")} aria-label={uiText("会话导航")} aria-expanded={sessionsOpen} onClick={() => setSessionsOpen(true)}><span className="experiment-navigation-label">{uiText("会话导航")}</span></Button>}
            <Dropdown trigger={['click']} menu={{ items: [{
              key: 'clear',
              label: uiText("清空会话内容"),
              danger: true,
              disabled: !clearContent,
              onClick: () => {
                if (clearContent) setClearTarget({ title: sessionTitle ?? uiText("当前会话"), run: clearContent })
              },
            }] }}>
              <Button type="text" className="experiment-icon-action" icon={<MoreOutlined />} aria-label={uiText("更多会话操作")} />
            </Dropdown>
          </PageToolbar>
          <div className="app-lab-content">
            {history}
            {composer}
          </div>
        </section>
      </div>
      {!wide && <Drawer title={uiText("会话导航")} placement="left" width="min(272px, 100vw)"
        open={sessionsOpen} onClose={closeNavigation}>{sidebar(closeNavigation)}</Drawer>}
      <ExperimentSessionConfirmation
        title={uiText("清空会话内容")}
        description={uiText("将清空“{{title}}”的历史消息，保留会话本身。此操作无法撤销。", { title: clearTarget?.title })}
        run={clearTarget?.run}
        failure={uiText("清空会话失败；含生成任务的会话不可清空")}
        onClose={() => setClearTarget(undefined)}
      />
      {overlays}
    </WorkspaceLayout>
  )
}
