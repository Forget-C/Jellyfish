import React, { useEffect, useState } from 'react'
import { Card, Button, Tabs, Space, Dropdown, Empty, message } from 'antd'
import type { MenuProps } from 'antd'
import {
  PlusOutlined,
  EllipsisOutlined,
  ArrowLeftOutlined,
  VideoCameraFilled,
} from '@ant-design/icons'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { TAB_CONFIG, type TabKey, isTabKey, DEFAULT_TAB } from './constants'
import { DashboardTab } from './tabs/DashboardTab'
import { ChaptersTab } from './tabs/ChaptersTab'
import { ActorsTab } from './tabs/ActorsTab'
import { RolesTab } from './tabs/RolesTab'
import { ScenesTab } from './tabs/ScenesTab'
import { CostumesTab, PropsTab } from './tabs/PropsTab'
import { FilesTab } from './tabs/FilesTab'
import { EditTab } from './tabs/EditTab'
import { SettingsTab } from './tabs/SettingsTab'
import { getChapterShotsPath, getChapterStudioPath, getChapterTimelinePath } from './routes'
import { useProject, useChapters } from './hooks/useProjectData'
import { ensureHasShotsBeforeShooting } from './ensureHasShotsBeforeShooting'
import { getChapterPreparationState } from './chapterPreparation'

const TAB_PARAM = 'tab'
const CREATE_PARAM = 'create'
const EDIT_PARAM = 'edit'

const ProjectWorkbench: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get(TAB_PARAM)
  const resolvedTab: TabKey =
    tabFromUrl !== null && isTabKey(tabFromUrl) ? tabFromUrl : DEFAULT_TAB

  const { project, loading: projectLoading } = useProject(projectId)
  const { chapters } = useChapters(projectId)
  const [activeTab, setActiveTab] = useState<TabKey>(() => resolvedTab)

  const chaptersByIndex = [...chapters].sort((a, b) => a.index - b.index)

  const recommendedChapter = (() => {
    const findByState = (key: ReturnType<typeof getChapterPreparationState>['key']) =>
      chaptersByIndex.find((chapter) => getChapterPreparationState(chapter).key === key)
    return (
      findByState('edit_raw') ??
      findByState('extract_shots') ??
      findByState('prepare_shots') ??
      findByState('shoot') ??
      chaptersByIndex[0] ??
      null
    )
  })()

  const primaryCta = (() => {
    if (!projectId) {
      return {
        label: '创建第一章',
        hint: '先创建章节，再进入分镜准备流程',
        icon: <PlusOutlined />,
        onClick: () => {},
      }
    }
    if (!recommendedChapter) {
      return {
        label: '创建第一章',
        hint: '先创建章节，再进入分镜准备流程',
        icon: <PlusOutlined />,
        onClick: () => {
          setTabInUrl('chapters')
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev)
              next.set(CREATE_PARAM, '1')
              return next
            },
            { replace: true }
          )
        },
      }
    }
    const state = getChapterPreparationState(recommendedChapter)
    const chapterLabel = `第${recommendedChapter.index}章`
    if (state.key === 'edit_raw') {
      return {
        label: `编辑${chapterLabel}原文`,
        hint: `${chapterLabel}还没有原文内容，建议先补章节原文`,
        icon: state.primaryIcon,
        onClick: () => {
          setTabInUrl('chapters')
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev)
              next.set(TAB_PARAM, 'chapters')
              next.set(EDIT_PARAM, recommendedChapter.id)
              return next
            },
            { replace: true }
          )
        },
      }
    }
    if (state.key === 'extract_shots') {
      return {
        label: `提取${chapterLabel}分镜`,
        hint: `${chapterLabel}已有原文，下一步更适合先提取分镜`,
        icon: state.primaryIcon,
        onClick: () => navigate(getChapterShotsPath(projectId, recommendedChapter.id)),
      }
    }
    if (state.key === 'prepare_shots') {
      return {
        label: `进入${chapterLabel}分镜工作室`,
        hint: `${chapterLabel}已有分镜，建议继续补齐镜头准备`,
        icon: state.primaryIcon,
        onClick: () => navigate(getChapterStudioPath(projectId, recommendedChapter.id)),
      }
    }
    return {
      label: `进入${chapterLabel}拍摄`,
      hint: `${chapterLabel}已具备分镜，可继续进入拍摄流程`,
      icon: state.primaryIcon,
      onClick: () =>
        ensureHasShotsBeforeShooting({
          projectId,
          chapterId: recommendedChapter.id,
          storyboardCount: recommendedChapter.storyboardCount,
          navigate,
        }),
    }
  })()

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
    <div className="h-full min-h-0 flex flex-col">
      <div
        className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm"
        style={{ margin: -5, marginBottom: 0, padding: '16px 24px' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-100">
          <Tabs
            activeKey={activeTab}
            onChange={(k) => setTabInUrl(k as TabKey)}
            size="middle"
            className="project-workbench-tabs flex-1 min-w-0"
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
          <Space size="small" wrap className="shrink-0">
            <Button
              type="primary"
              icon={primaryCta.icon}
              onClick={primaryCta.onClick}
            >
              {primaryCta.label}
            </Button>
            <Button
              icon={<VideoCameraFilled />}
              onClick={() => {
                if (!projectId) return
                const target = recommendedChapter ?? chaptersByIndex[0]
                if (!target) {
                  message.warning('请先创建章节，再进入章节剪辑')
                  setTabInUrl('chapters')
                  return
                }
                navigate(getChapterTimelinePath(projectId, target.id))
              }}
            >
              进入后期剪辑
            </Button>
            <Dropdown menu={{ items: moreMenuItems }} placement="bottomRight">
              <Button icon={<EllipsisOutlined />}>更多</Button>
            </Dropdown>
          </Space>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          {primaryCta.hint}
        </div>
      </div>

      <div
        className="pt-4 animate-fadeIn flex-1 min-h-0 overflow-hidden"
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
        {activeTab === 'edit' && <EditTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>
    </div>
  )
}

export default ProjectWorkbench
