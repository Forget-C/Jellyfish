import { useEffect, useState } from 'react'
import { Avatar, Breadcrumb, Button, Drawer, Dropdown, Grid, Tooltip } from 'antd'
import { ApiOutlined, AppstoreOutlined, FileOutlined, FileTextOutlined, FolderOutlined, MenuOutlined, MessageOutlined, MoreOutlined, PictureOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../store/useAppStore'
import { TaskCenter } from '../pages/aiStudio/components/TaskCenter'
import { TaskRuntimeProvider } from '../pages/aiStudio/components/TaskRuntimeProvider'
import { mainNavigation, pageBreadcrumbs } from './navigation'
import { useNavigationTitles } from './pageTitle'
import './shell.css'

const navigationIcons = { projects: <FolderOutlined />, assets: <PictureOutlined />, prompts: <FileTextOutlined />, files: <FileOutlined />, models: <ApiOutlined />, agents: <AppstoreOutlined />, lab: <MessageOutlined />, settings: <SettingOutlined /> }

/** 全站共用顶栏与窄导航；路由内容自己声明滚动面，任务运行时在导航过程中只挂载一次。 */
export default function MainLayout() {
  const { t, i18n } = useTranslation('layout')
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const mobile = screens.md === false
  const [navigationOpen, setNavigationOpen] = useState(false)
  const user = useAppStore(state => state.user)
  const language = useAppStore(state => state.language)
  const setLanguage = useAppStore(state => state.setLanguage)
  const titles = useNavigationTitles()
  const crumbs = pageBreadcrumbs(pathname, titles)
  useEffect(() => { setNavigationOpen(false) }, [pathname])
  useEffect(() => {
    const resolved = i18n.resolvedLanguage === 'en-US' ? 'en-US' : 'zh-CN'
    setLanguage(resolved)
    document.documentElement.lang = resolved === 'en-US' ? 'en' : 'zh-CN'
  }, [i18n.resolvedLanguage, setLanguage])

  const navigation = (compact: boolean) => <nav aria-label={compact ? '主导航' : '移动主导航'} className={compact ? 'app-nav-rail' : 'app-nav-menu'}>
    {mainNavigation.map(item => <Tooltip key={item.key} title={compact ? item.label : undefined} placement="right">
      <NavLink to={item.to} aria-label={item.label} className={({ isActive }) => `app-nav-link${isActive ? ' is-active' : ''}${item.key === 'settings' ? ' app-nav-settings' : ''}`} onClick={() => setNavigationOpen(false)}>
        {navigationIcons[item.key]}{!compact && <span>{item.label}</span>}
      </NavLink>
    </Tooltip>)}
  </nav>

  const breadcrumbItems = crumbs.map((item, index) => ({
    key: item.to || `${index}`,
    title: item.to ? <Link to={item.to} title={item.label}>{item.label}</Link> : <span title={item.label}>{item.label}</span>,
  }))
  // 只折叠中间层；当前对象始终可见，完整上级路径通过菜单访问。
  const compactCrumbs = (mobile || screens.lg === false || crumbs.reduce((length, item) => length + item.label.length, 0) > 48) && crumbs.length > 2
    ? [{ key: 'parents', title: <Dropdown overlayClassName="app-context-menu" trigger={['click']} menu={{ items: crumbs.slice(0, -1).map((item, index) => ({ key: String(index), label: item.label, onClick: () => { if (item.to) navigate(item.to) } })) }}><Button type="text" size="small" aria-label="查看上级页面" icon={<MoreOutlined />} /></Dropdown> }, breadcrumbItems[breadcrumbItems.length - 1]]
    : breadcrumbItems

  return <TaskRuntimeProvider>
    <div className="app-shell">
      <header className="app-topbar">
        {mobile && <Button className="app-nav-trigger" type="text" aria-label="打开主导航" aria-expanded={navigationOpen} icon={<MenuOutlined />} onClick={() => setNavigationOpen(true)} />}
        <Link to="/projects" className="app-brand" aria-label="Jellyfish 项目首页"><img src="/logo.svg" alt="" /><span>Jellyfish</span></Link>
        <Breadcrumb aria-label="当前位置" className="app-breadcrumb" items={compactCrumbs} />
        <div className="app-global-actions">
          <TaskCenter />
          <Dropdown overlayClassName="app-context-menu" trigger={['click']} placement="bottomRight" menu={{ selectable: true, selectedKeys: [language], items: [
            { key: 'user', label: `${user.name} · ${user.role}`, disabled: true },
            { key: 'settings', label: t('user.profile'), onClick: () => navigate('/settings') },
            { type: 'divider' },
            { type: 'group', key: 'language', label: language === 'zh-CN' ? '语言' : 'Language', children: [
              { key: 'zh-CN', label: '简体中文', onClick: () => { setLanguage('zh-CN'); void i18n.changeLanguage('zh-CN'); window.localStorage.setItem('jellyfish_language', 'zh-CN'); document.documentElement.lang = 'zh-CN' } },
              { key: 'en-US', label: 'English', onClick: () => { setLanguage('en-US'); void i18n.changeLanguage('en-US'); window.localStorage.setItem('jellyfish_language', 'en-US'); document.documentElement.lang = 'en' } },
            ] },
          ] }}><Button type="text" className="app-account" aria-label="用户与语言设置"><Avatar size={28} icon={<UserOutlined />} /></Button></Dropdown>
        </div>
      </header>
      <div className="app-shell-body">
        {!mobile && navigation(true)}
        <main className="app-route-viewport" id="main-content"><Outlet /></main>
      </div>
      <Drawer title="Jellyfish" placement="left" width={272} open={mobile && navigationOpen} onClose={() => setNavigationOpen(false)}>{navigation(false)}</Drawer>
    </div>
  </TaskRuntimeProvider>
}
