import React, { useMemo } from 'react'
import { Layout, Menu, theme, Dropdown, Space, Avatar, Select, Breadcrumb } from 'antd'
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  UserOutlined,
  FolderOutlined,
  PictureOutlined,
  FileTextOutlined,
  ApiOutlined,
} from '@ant-design/icons'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { TaskCenter } from '../pages/aiStudio/components/TaskCenter'
import { TaskRuntimeProvider } from '../pages/aiStudio/components/TaskRuntimeProvider'

const { Header, Sider, Content } = Layout

const MainLayout: React.FC = () => {
  const { t, i18n } = useTranslation('layout')
  const location = useLocation()
  const navigate = useNavigate()
  const { token } = theme.useToken()

  const collapsed = useAppStore((state) => state.siderCollapsed)
  const toggleCollapsed = useAppStore((state) => state.toggleSider)
  const user = useAppStore((state) => state.user)
  const language = useAppStore((state) => state.language)
  const setLanguage = useAppStore((state) => state.setLanguage)

  const selectedKeys = useMemo(() => {
    if (location.pathname === '/projects' || location.pathname.startsWith('/projects/')) return ['projects']
    if (location.pathname.startsWith('/assets')) return ['assets']
    if (location.pathname.startsWith('/prompts')) return ['prompts']
    if (location.pathname.startsWith('/files')) return ['files']
    if (location.pathname.startsWith('/agents')) return ['agents']
    if (location.pathname.startsWith('/models')) return ['models']
    if (location.pathname.startsWith('/settings')) return ['settings']
    return []
  }, [location.pathname])

  const breadcrumbItems = useMemo(() => {
    const path = location.pathname.replace(/^\/+/, '').split('/').filter(Boolean)
    if (path.length === 0) return [{ title: t('title') }]
    const items: { title: React.ReactNode; key: string }[] = []
    const pathLabels: Record<string, string> = {
      projects: t('breadcrumbs.projects'),
      assets: t('breadcrumbs.assets'),
      prompts: t('breadcrumbs.prompts'),
      files: t('breadcrumbs.files'),
      agents: t('breadcrumbs.agents'),
      models: t('breadcrumbs.models'),
      settings: t('menu.settings'),
      chapters: t('breadcrumbs.chapters'),
      studio: t('breadcrumbs.studio'),
      prep: t('breadcrumbs.prep'),
      shots: t('breadcrumbs.shots'),
      editor: t('breadcrumbs.editor'),
      edit: t('breadcrumbs.edit'),
    }
    path.forEach((segment, i) => {
      // 特殊：/projects/:projectId/chapters/:chapterId/* 中的 chapterId 段不展示（避免出现“章节”这一层）
      if (path[0] === 'projects' && path[2] === 'chapters' && i === 3) {
        return
      }

      // 默认：按原始路径逐段拼接
      let href = path.slice(0, i + 1).join('/')
      href = `/${href}`

      // 特殊：章节相关的中间路径段在路由里不存在，需映射到有效地址
      // /projects/:projectId/chapters/:chapterId/*
      if (path[0] === 'projects' && path[2] === 'chapters') {
        const projectId = path[1]
        const chapterId = path[3]
        if (segment === 'chapters' && i === 2) {
          // “章节管理”实际在项目工作台页
          href = `/projects/${projectId}?tab=chapters`
        } else if (i === 3) {
          // 章节 ID 段没有对应独立页面，跳到分镜页（存在路由）
          href = `/projects/${projectId}/chapters/${chapterId}/shots`
        }
      }

      const isLast = i === path.length - 1
      let label = pathLabels[segment]
      if (label === undefined) {
        if (path[0] === 'projects' && i === 1) label = t('breadcrumbs.projectWorkbench')
        else if (path[2] === 'chapters' && i === 3) label = t('breadcrumbs.chapter')
        else label = segment
      }
      items.push({
        key: href,
        title: isLast ? label : <Link to={href}>{label}</Link>,
      })
    })
    return items
  }, [location.pathname, t])

  const menuItems = [
    {
      key: 'projects',
      icon: <FolderOutlined />,
      label: <Link to="/projects">{t('menu.projects')}</Link>,
    },
    {
      key: 'assets',
      icon: <PictureOutlined />,
      label: <Link to="/assets">{t('menu.assets')}</Link>,
    },
    {
      key: 'prompts',
      icon: <FileTextOutlined />,
      label: <Link to="/prompts">{t('menu.prompts')}</Link>,
    },
    {
      key: 'models',
      icon: <ApiOutlined />,
      label: <Link to="/models">{t('menu.models')}</Link>,
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: <Link to="/settings">{t('menu.settings')}</Link>,
    },
  ]

  const userMenuItems = [
    {
      key: 'profile',
      label: t('user.profile'),
      onClick: () => navigate('/settings'),
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      label: t('user.logout'),
      onClick: () => {
        // 这里保留占位，实际项目中可接入登录逻辑
      },
    },
  ]

  return (
    <Layout
      style={{
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={220}
        style={{
          flexShrink: 0,
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          overflow: 'auto',
        }}
      >
        <div className="flex items-center h-16 px-4 border-b border-solid" style={{ borderColor: token.colorBorderSecondary }}>
          <Link to="/projects" className="flex items-center gap-2 min-w-0">
            <img src="/logo.svg" alt="Jellyfish" className="w-8 h-8 shrink-0" />
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-base font-semibold text-gray-900 truncate">
                  {t('title')}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {t('subtitle')}
                </div>
              </div>
            )}
          </Link>
        </div>

        <Menu
          mode="inline"
          selectedKeys={selectedKeys}
          items={menuItems}
          style={{ borderRight: 'none', paddingTop: 8 }}
        />
      </Sider>

      <Layout
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <Header
          className="flex items-center justify-between px-4"
          style={{
            flexShrink: 0,
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Space size="middle" className="flex-1 min-w-0">
            <span
              className="cursor-pointer text-xl shrink-0"
              onClick={toggleCollapsed}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </span>
            <Breadcrumb
              items={breadcrumbItems}
              className="hidden sm:block"
              style={{ lineHeight: '32px' }}
            />
          </Space>

          <Space size="middle">
            <Select
              size="small"
              value={language}
              style={{ width: 120 }}
              onChange={(value) => {
                setLanguage(value)
                void i18n.changeLanguage(value)
                window.localStorage.setItem('jellyfish_language', value)
                document.documentElement.lang = value === 'en-US' ? 'en' : 'zh-CN'
              }}
              options={[
                { label: t('lang.zh'), value: 'zh-CN' },
                { label: t('lang.en'), value: 'en-US' },
              ]}
            />

            <Dropdown
              menu={{
                items: userMenuItems,
              }}
              placement="bottomRight"
            >
              <div className="flex items-center gap-2 cursor-pointer">
                <Avatar size={32} icon={<UserOutlined />} />
                <div className="hidden md:flex flex-col leading-tight">
                  <span className="text-sm font-medium text-gray-800">{user.name}</span>
                  <span className="text-xs text-gray-500">{user.role}</span>
                </div>
              </div>
            </Dropdown>
          </Space>
        </Header>

        <TaskRuntimeProvider>
          <Content
            style={{
              margin: 0,
              padding: 5,
              background: token.colorBgLayout,
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div className="w-full h-full min-h-0 overflow-hidden flex flex-col">
              <Outlet />
            </div>
          </Content>
          <TaskCenter />
        </TaskRuntimeProvider>
      </Layout>
    </Layout>
  )
}

export default MainLayout
