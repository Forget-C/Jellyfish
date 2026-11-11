import { useEffect, useRef, useState } from 'react'
import { Avatar, Breadcrumb, Button, ConfigProvider, Dropdown, Grid } from 'antd'
import { CheckOutlined, MoreOutlined, UserOutlined } from '@ant-design/icons'
import { Link, Outlet, useLocation, useMatches, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import brandLogo from '../../logo.svg'
import { appearances, useAppStore } from '../store/useAppStore'
import { TaskCenter } from '../pages/aiStudio/components/TaskCenter'
import { TaskRuntimeProvider } from '../pages/aiStudio/components/TaskRuntimeProvider'
import { ProjectNavigation } from '../pages/aiStudio/project/ProjectWorkbench/ProjectNavigation'
import { projectTabLabel, projectTabLocation, resolveProjectTab } from '../pages/aiStudio/project/ProjectWorkbench/constants'
import { useLastManagementPage } from './useLastManagementPage'
import { AppearancePreview } from './AppearancePreview'
import { activeMainNavigation, mainNavigation, pageBreadcrumbs } from './navigation'
import { useNavigationTitles } from './pageTitle'
import './shell.css'

const ordinaryPageTheme = {
  token: {
    colorPrimary: '#245FC5', colorPrimaryBg: '#E4EDFB', colorBgLayout: '#F7F8FB',
    colorText: '#263244', colorTextSecondary: '#536174',
  },
}

/** 普通路由的导航与主题在独立画布之外应用。 */
function OrdinaryLayout() {
  const { t, i18n } = useTranslation('layout')
  const { pathname, search } = useLocation()
  const projectId = useMatches().find(match => match.id === 'project-navigation')?.params.projectId
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const user = useAppStore(state => state.user)
  const language = useAppStore(state => state.language)
  const setLanguage = useAppStore(state => state.setLanguage)
  const appearance = useAppStore(state => state.appearance)
  const setAppearance = useAppStore(state => state.setAppearance)
  const accountButton = useRef<HTMLButtonElement>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const titles = useNavigationTitles()
  const projectIndex = !!projectId && pathname.split('/').filter(Boolean).length === 2
  const projectTab = projectIndex ? resolveProjectTab(new URLSearchParams(search).get('tab')) : undefined
  const legacyGeneration = projectTab === 'generation'
  const crumbs = projectId && projectTab && !legacyGeneration ? [
    { label: '项目', to: '/projects' },
    { label: titles.page || '项目', to: projectTabLocation(projectId, 'dashboard') },
    { label: projectTabLabel(projectTab) || '项目概览' },
  ] : pageBreadcrumbs(pathname, titles)
  useEffect(() => {
    const resolved = i18n.resolvedLanguage === 'en-US' ? 'en-US' : 'zh-CN'
    setLanguage(resolved)
    document.documentElement.lang = resolved === 'en-US' ? 'en' : 'zh-CN'
  }, [i18n.resolvedLanguage, setLanguage])

  const breadcrumbItems = crumbs.map((item, index) => ({
    key: item.to || `${index}`,
    title: item.to ? <Link to={item.to} title={item.label}>{item.label}</Link> : <span title={item.label}>{item.label}</span>,
  }))
  // 只折叠中间层；当前对象始终可见，完整上级路径通过菜单访问。
  const compactCrumbs = (screens.lg === false || crumbs.reduce((length, item) => length + item.label.length, 0) > 48) && crumbs.length > 2
    ? [{ key: 'parents', title: <Dropdown overlayClassName="app-context-menu" trigger={['click']} menu={{ items: crumbs.slice(0, -1).map((item, index) => ({ key: String(index), label: item.label, onClick: () => { if (item.to) navigate(item.to) } })) }}><Button type="text" size="small" aria-label="查看上级页面" icon={<MoreOutlined />} /></Dropdown> }, breadcrumbItems[breadcrumbItems.length - 1]]
    : breadcrumbItems

  const activeNavigation = activeMainNavigation(pathname)
  const lastManagementPage = useLastManagementPage(pathname)
  const routeContent = <main className="app-route-viewport" id="main-content">
    {crumbs.length > 1 && !/^\/assets\/(actors|scenes|props|costumes)\/[^/]+\/edit\/?$/.test(pathname) && <Breadcrumb aria-label="当前位置" className="app-breadcrumb" items={compactCrumbs} />}
    <Outlet />
  </main>

  return <ConfigProvider theme={ordinaryPageTheme}>
    <div className="app-shell" data-appearance={appearance}>
      <header className="app-topbar">
        <Link to="/" className="app-brand" aria-label={t('brandHome')}><img src={brandLogo} alt="" /><span>Jellyfish</span></Link>
        <nav aria-label={t('primaryNavigation')} className="app-primary-navigation">
          {mainNavigation.map(item => <Link key={item.key} to={item.key === 'management' ? lastManagementPage : item.to} className="app-nav-link" aria-current={activeNavigation === item.key ? 'page' : undefined}>{t(`menu.${item.key}`)}</Link>)}
        </nav>
        <div className="app-global-actions">
          <TaskCenter />
          <Dropdown overlayClassName="app-context-menu" trigger={['click']} placement="bottomRight" autoFocus open={accountOpen} onOpenChange={setAccountOpen} menu={{ selectable: true, selectedKeys: [language, appearance], onClick: () => setAccountOpen(false), items: [
            { key: 'user', label: `${user.name} · ${user.role}`, disabled: true },
            { key: 'settings', label: t('user.profile'), onClick: () => navigate('/settings') },
            { type: 'divider' },
            { type: 'group', key: 'appearance', label: t('appearance.label'), children: appearances.map(value => ({
              key: value,
              role: 'menuitemradio',
              'aria-checked': value === appearance,
              label: <span className="app-appearance-menu-option">
                <AppearancePreview appearance={value} />
                {appearance === value && <CheckOutlined aria-hidden />}
              </span>,
              onClick: () => {
                setAppearance(value)
                // 等菜单关闭后再交还焦点，避免同一次 Enter 重新打开菜单。
                requestAnimationFrame(() => accountButton.current?.focus())
              },
            })) },
            { type: 'divider' },
            { type: 'group', key: 'language', label: language === 'zh-CN' ? '语言' : 'Language', children: [
              { key: 'zh-CN', label: '简体中文', onClick: () => { setLanguage('zh-CN'); void i18n.changeLanguage('zh-CN'); window.localStorage.setItem('jellyfish_language', 'zh-CN'); document.documentElement.lang = 'zh-CN' } },
              { key: 'en-US', label: 'English', onClick: () => { setLanguage('en-US'); void i18n.changeLanguage('en-US'); window.localStorage.setItem('jellyfish_language', 'en-US'); document.documentElement.lang = 'en' } },
            ] },
          ] }}><Button ref={accountButton} type="text" className="app-account" aria-label="用户与语言设置" aria-haspopup="menu" aria-expanded={accountOpen}><Avatar size={28} icon={<UserOutlined />} /></Button></Dropdown>
        </div>
      </header>
      {projectId && !legacyGeneration ? <div className="app-project-frame">
        <ProjectNavigation key={projectId} projectId={projectId} projectName={projectIndex ? titles.page : titles.project} />
        {routeContent}
      </div> : routeContent}
    </div>
  </ConfigProvider>
}

/** 路由切换时保留同一个任务运行时，包括进出独立画布。 */
export default function MainLayout() {
  const { pathname } = useLocation()
  const standaloneCanvas = /^\/projects\/[^/]+\/generation-canvas\/?$/.test(pathname) || /^\/projects\/[^/]+\/chapters\/[^/]+\/sequences\/[^/]+\/?$/.test(pathname)
  return <TaskRuntimeProvider>{standaloneCanvas ? <Outlet /> : <OrdinaryLayout />}</TaskRuntimeProvider>
}
