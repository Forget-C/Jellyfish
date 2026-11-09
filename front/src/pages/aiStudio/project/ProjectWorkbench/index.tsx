import { usePageTitle } from '../../../../layouts/pageTitle'
import React, { useEffect, useState } from 'react'
import { Card, Button, Tabs, Space, Dropdown, Empty } from 'antd'
import type { MenuProps } from 'antd'
import {
  PlusOutlined,
  EllipsisOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { TAB_CONFIG, type TabKey, isTabKey, DEFAULT_TAB } from './constants'
import { generationCanvasLocation } from '../../generationCanvas/navigation'
import { DashboardTab } from './tabs/DashboardTab'
import { ChaptersTab } from './tabs/ChaptersTab'
import { ActorsTab } from './tabs/ActorsTab'
import { RolesTab } from './tabs/RolesTab'
import { ScenesTab } from './tabs/ScenesTab'
import { CostumesTab, PropsTab } from './tabs/PropsTab'
import { FilesTab } from './tabs/FilesTab'
import { SettingsTab } from './tabs/SettingsTab'
import { useProject, useChapters } from './hooks/useProjectData'
import { WorkspaceLayout, WorkspaceScrollPanel } from '../../../../components'
import { StudioDirectingService } from '../../../../services/generated'
import { readRecentWork } from '../../directing/workspaceContext'
import { chapterLocation, workbenchManagementLocation } from '../../directing/chapterNavigation'

const TAB_PARAM = 'tab'

const ProjectWorkbench: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get(TAB_PARAM)
  const resolvedTab: TabKey =
    tabFromUrl !== null && isTabKey(tabFromUrl) ? tabFromUrl : DEFAULT_TAB

  const { project, loading: projectLoading } = useProject(projectId)
  usePageTitle(project?.id === projectId ? project?.name : undefined)
  const { chapters } = useChapters(projectId)
  const [activeTab, setActiveTab] = useState<TabKey>(() => resolvedTab)

  const [recentDestination, setRecentDestination] = useState<string>()
  useEffect(() => {
    let active = true
    setRecentDestination(undefined)
    const recent = projectId ? readRecentWork(projectId) : undefined
    if (projectId && recent && chapters.some(chapter => chapter.id === recent.chapterId)) {
      StudioDirectingService.directingChapterOverview({ projectId, chapterId: recent.chapterId }).then(response => {
        const sequence = response.data?.sequences.find(row => row.id === recent.sequenceId)
        if (active && sequence) {
          setRecentDestination(workbenchManagementLocation(projectId, recent.chapterId, recent.sequenceId))
        }
      }).catch(() => { /* 最近工作不可核实时，仍可从章节浏览。 */ })
    }
    return () => { active = false }
  }, [projectId, chapters])
  const primaryCta = {
    label: recentDestination ? '继续工作' : chapters.length ? '进入章节场次' : '创建第一章',
    hint: '章节原文 → 工作台管理 → 工作台画布',
    icon: <PlusOutlined />,
    onClick: () => {
      if (recentDestination) navigate(recentDestination)
      else if (chapters.length) navigate(chapterLocation(projectId || ''))
      else setSearchParams({ tab: 'chapters', create: '1' })
    },
  }

  // 与 URL 中的 tab 同步：URL 变化时更新 activeTab；初次或无效 tab 时写回 URL
  useEffect(() => {
    if (tabFromUrl !== null && isTabKey(tabFromUrl)) {
      setActiveTab(tabFromUrl)
    } else if (tabFromUrl === null || tabFromUrl === '') {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(TAB_PARAM, DEFAULT_TAB)
          return next
        },
        { replace: true }
      )
    }
  }, [tabFromUrl, setSearchParams])

  const setTabInUrl = (tab: TabKey) => {
    if (tab === 'generation' && projectId) { navigate(generationCanvasLocation(projectId)); return }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set(TAB_PARAM, tab)
        return next
      },
      { replace: true }
    )
  }

  const moreMenuItems: MenuProps['items'] = [
    { key: 'newActor', label: '关联演员', onClick: () => setTabInUrl('actors') },
    { key: 'newRole', label: '新建角色', onClick: () => setTabInUrl('roles') },
    { key: 'upload', label: '上传素材', onClick: () => navigate('/assets') },
    { key: 'newScene', label: '新建场景', onClick: () => setTabInUrl('scenes') },
    { key: 'newProp', label: '新建道具', onClick: () => setTabInUrl('props') },
    { key: 'newCostume', label: '新建服装', onClick: () => setTabInUrl('costumes') },
  ]

  if (!project && !projectLoading) {
    return (
      <Card>
        <Empty description="项目不存在" />
        <Link to="/projects">
          <Button type="link" icon={<ArrowLeftOutlined />}>
            返回项目列表
          </Button>
        </Link>
      </Card>
    )
  }

  return (
    <WorkspaceLayout>
      <div
        className="app-page-toolbar project-workbench-header"
      >
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <Tabs
            activeKey={activeTab}
            onChange={(k) => setTabInUrl(k as TabKey)}
            size="middle"
            className="project-workbench-tabs app-page-tabs flex-1 min-w-0"
            items={TAB_CONFIG.map(({ key, label, icon }) => ({
              key,
              label: (
                <span className="flex items-center gap-1.5">
                  {icon}
                  {label}
                </span>
              ),
            }))}
          />
          {activeTab !== 'generation' && <Space size="small" wrap className="shrink-0">
            <Button
              type="primary"
              icon={primaryCta.icon}
              onClick={primaryCta.onClick}
            >
              {primaryCta.label}
            </Button>
            <Dropdown menu={{ items: moreMenuItems }} placement="bottomRight">
              <Button icon={<EllipsisOutlined />}>更多</Button>
            </Dropdown>
          </Space>}
        </div>
        {activeTab !== 'generation' && <div className="text-xs text-gray-500">
          {primaryCta.hint}
        </div>}
      </div>

      <WorkspaceScrollPanel
        className="app-page-content animate-fadeIn"
        style={{ animation: 'fadeIn 0.25s ease-out' }}
      >
        {activeTab === 'dashboard' && <DashboardTab onSelectTab={setTabInUrl} />}

        {activeTab === 'chapters' && <ChaptersTab />}

        {activeTab === 'actors' && <ActorsTab />}
        {activeTab === 'roles' && <RolesTab />}
        {activeTab === 'scenes' && <ScenesTab />}
        {activeTab === 'props' && <PropsTab />}
        {activeTab === 'costumes' && <CostumesTab />}
        {activeTab === 'files' && <FilesTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </WorkspaceScrollPanel>
    </WorkspaceLayout>
  )
}

export default ProjectWorkbench
