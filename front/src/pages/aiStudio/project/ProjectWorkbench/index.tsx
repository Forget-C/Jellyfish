import { usePageTitle } from '../../../../layouts/pageTitle'
import { useEffect, useState, type FC } from 'react'
import { Card, Button, Space, Dropdown, Empty } from 'antd'
import type { MenuProps } from 'antd'
import {
  PlusOutlined,
  EllipsisOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { DEFAULT_TAB, projectTabLabel, projectTabLocation, resolveProjectTab, type TabKey } from './constants'
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

import { ProjectToolbarProvider } from './ProjectContentToolbar'
import './project-production.css'

const TAB_PARAM = 'tab'

const ProjectWorkbench: FC = () => {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get(TAB_PARAM)
  const activeTab = resolveProjectTab(tabFromUrl)
  const productionPage = activeTab === 'dashboard' || activeTab === 'chapters'

  const { project, loading: projectLoading, saving, saveProject } = useProject(projectId)
  usePageTitle(project?.id === projectId ? project?.name : undefined)
  const { chapters } = useChapters(projectId)

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
    icon: <PlusOutlined />,
    onClick: () => {
      if (recentDestination) navigate(recentDestination)
      else if (chapters.length) navigate(chapterLocation(projectId || ''))
      else setSearchParams({ tab: 'chapters', create: '1' })
    },
  }

  // 保留旧的默认分区地址，同时以 URL 为选中状态的唯一来源。
  useEffect(() => {
    if (tabFromUrl !== activeTab) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(TAB_PARAM, DEFAULT_TAB)
          return next
        },
        { replace: true }
      )
    }
  }, [activeTab, tabFromUrl, setSearchParams])

  const setTabInUrl = (tab: TabKey) => {
    if (projectId) navigate(projectTabLocation(projectId, tab))
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
      <ProjectToolbarProvider title={projectTabLabel(activeTab)} actions={
        <Space size="small" wrap className="app-page-actions">
          {(!productionPage || recentDestination) && <Button type="primary" icon={primaryCta.icon} onClick={primaryCta.onClick}>{primaryCta.label}</Button>}
          <Dropdown menu={{ items: moreMenuItems }} placement="bottomRight">
            <Button icon={<EllipsisOutlined />}>更多</Button>
          </Dropdown>
        </Space>
      }>

        <WorkspaceScrollPanel
          className="app-page-content project-workbench-content animate-fadeIn"
          style={{ animation: 'fadeIn 0.25s ease-out' }}
        >
          {activeTab === 'dashboard' && <DashboardTab />}

          {activeTab === 'chapters' && <ChaptersTab />}

          {activeTab === 'actors' && <ActorsTab />}
          {activeTab === 'roles' && <RolesTab />}
          {activeTab === 'scenes' && <ScenesTab />}
          {activeTab === 'props' && <PropsTab />}
          {activeTab === 'costumes' && <CostumesTab />}
          {activeTab === 'files' && <FilesTab />}
          {activeTab === 'settings' && project && project.id === projectId && (
            <SettingsTab key={project.id} project={project} saving={saving} onSave={saveProject} />
          )}
        </WorkspaceScrollPanel>
      </ProjectToolbarProvider>
    </WorkspaceLayout>
  )
}

export default ProjectWorkbench
