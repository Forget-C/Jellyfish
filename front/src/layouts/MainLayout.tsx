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
  CloudSyncOutlined,
  ThunderboltOutlined,
  ReadOutlined,
} from '@ant-design/icons'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore, userRoleLabel } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { TaskCenter } from '../pages/aiStudio/components/TaskCenter'
import { TaskRuntimeProvider } from '../pages/aiStudio/components/TaskRuntimeProvider'
import { RealRunModeBadge } from '../pages/aiStudio/components/RealRunModeBadge'

const { Header, Sider, Content } = Layout

const MainLayout: React.FC = () => {
  /* `layout` 是默认命名空间（导航 / 用户菜单都取自它）；
     角色的中文显示名在 `settings` 命名空间里（`roleOptions`），
     所以这里显式把两个命名空间都挂上，用 `settings:` 前缀取键 —— 避免把
     「系统管理员」这份中文口径在代码里再手写一份（审计 §4.7 模式 3）。 */
  const { t, i18n } = useTranslation(['layout', 'settings'])
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
    if (location.pathname.startsWith('/prompt-flow')) return ['prompt-flow']
    if (location.pathname.startsWith('/files')) return ['files']
    if (location.pathname.startsWith('/agents')) return ['agents']
    if (location.pathname.startsWith('/models')) return ['models']
    if (location.pathname.startsWith('/llm-pipeline')) return ['llm-pipeline']
    if (location.pathname.startsWith('/drama-plan')) return ['drama-plan']
    if (location.pathname.startsWith('/settings')) return ['settings']
    return []
  }, [location.pathname])

  const breadcrumbItems = useMemo(() => {
    const path = location.pathname.replace(/^\/+/, '').split('/').filter(Boolean)
    if (path.length === 0) return [{ title: t('title') }]
    const items: { title: React.ReactNode; key: string }[] = []
    const pathLabels: Record<string, string> = {
      projects: '项目列表',
      assets: '资产管理',
      prompts: '提示词模板',
      'prompt-flow': '提示词导入/交付',
      files: '文件管理',
      /* 审计 §4.7 模式 3：`agents: 'Agent管理'` 里混英文不必要 —— 改中文。
         ⚠️ 导航名 `'LLM 调试台（开发）'`（下一项 `llm-pipeline`）**不改名**：
         用户已裁定该页「仅开发可见、阶段 B 不投工、导航入口淡化本轮不改路由」
         （审计 §9.1 第 9 项），改名属产品命名决策，不在本次治理范围。 */
      agents: '智能体管理',
      models: '模型管理',
      'llm-pipeline': 'LLM 调试台（开发）',
      'drama-plan': '剧情策划',
      settings: t('menu.settings'),
      chapters: '章节管理',
      studio: '分镜工作室',
      prep: '章节编辑',
      shots: '分镜',
      editor: '视频剪辑',
      edit: '编辑',
      /* 资产子路径（审计 §4.6-R20 运行时实测：`/assets/scenes/{id}/edit` 的面包屑里
         出现了英文段 `scenes` 与 percent-encoded 的内部 ID）。 */
      actors: '演员',
      scenes: '场景',
      props: '道具',
      costumes: '服装',
      roles: '角色',
      images: '图片',
      videos: '视频',
      audios: '声音',
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
        if (path[0] === 'projects' && i === 1) label = '项目工作台'
        else if (path[2] === 'chapters' && i === 3) label = '章节'
        /* 兜底**禁止回落 URL 段原样**（审计 §4.6-R20 / §7.2 序 4 点名）：
           `/assets/scenes/{id}/edit` 的 `{id}` 段是 percent-encoded 的内部 ID，
           未登记的英文段（`actors` / `roles` …）也会原样上屏 —— 两者都是 §2.3 模式 1/2。
           未登记段一律说「详情」；已登记的路由段在 `pathLabels` 里补中文名。 */
        else label = '详情'
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
      label: <Link to="/projects">项目列表</Link>,
    },
    {
      key: 'assets',
      icon: <PictureOutlined />,
      label: <Link to="/assets">资产管理</Link>,
    },
    {
      key: 'prompts',
      icon: <FileTextOutlined />,
      label: <Link to="/prompts">提示词模板</Link>,
    },
    {
      key: 'prompt-flow',
      icon: <CloudSyncOutlined />,
      label: <Link to="/prompt-flow">提示词导入/交付</Link>,
    },
    // 广告剧情流程：商品卖点 → 剧情方案 → 确认落成章节/分镜/资产（进工作台之前的入口）
    {
      key: 'drama-plan',
      icon: <ReadOutlined />,
      label: <Link to="/drama-plan">剧情策划</Link>,
    },
    {
      key: 'models',
      icon: <ApiOutlined />,
      label: <Link to="/models">模型管理</Link>,
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: <Link to="/settings">{t('menu.settings')}</Link>,
    },
    // 开发调试入口：LLM 能力已嵌入生产流程的各步骤页面，此项仅供排查用
    {
      key: 'llm-pipeline',
      icon: <ThunderboltOutlined />,
      label: <Link to="/llm-pipeline">LLM 调试台（开发）</Link>,
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
            {/* 当前是「演练模式」还是「真实模式」：点开有各出口放行状态与中文开启步骤。
                演练模式下被守卫拦住的记录也会在这里显示原因与开启办法。 */}
            <RealRunModeBadge />
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
                  {/* 角色存的是稳定码（`admin` / `operator` / `guest`），显示走 i18n；
                      未登记的码给「未知角色」兜底，**绝不把码本身渲到右上角**（审计 §4.7-R24 第 3 条）。 */}
                  <span className="text-xs text-gray-500">{userRoleLabel(user.role, t)}</span>
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
