import React, { useCallback, useEffect, useMemo } from 'react'
import { Alert, Button, Card, Dropdown, Empty, Segmented, Select, Space, Tag, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  EllipsisOutlined,
  ArrowLeftOutlined,
  VideoCameraFilled,
  RightOutlined,
  AppstoreOutlined,
  InfoCircleOutlined,
  ReadOutlined,
} from '@ant-design/icons'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { type TabKey, isTabKey } from './constants'
import { DashboardTab } from './tabs/DashboardTab'
import { ChaptersTab } from './tabs/ChaptersTab'
import { ActorsTab } from './tabs/ActorsTab'
import { RolesTab } from './tabs/RolesTab'
import { ScenesTab } from './tabs/ScenesTab'
import { CostumesTab, PropsTab } from './tabs/PropsTab'
import { FilesTab } from './tabs/FilesTab'
import { EditTab } from './tabs/EditTab'
import { SettingsTab } from './tabs/SettingsTab'
import { getChapterStudioPath, getProjectEditorPath } from './routes'
import { useProject, useChapters } from './hooks/useProjectData'
import type { ProjectSignalAsset, ProjectSignalAssetType } from './hooks/useProjectStepSignals'
import { getChapterPreparationState } from './chapterPreparation'
import {
  DEFAULT_PROJECT_STEP,
  getProjectStepIndex,
  getProjectStepMeta,
  isProjectStepKey,
  isStudioProjectStep,
  resolveProjectStep,
  type ProjectStepKey,
} from './projectSteps'
import { useProjectStepSignals } from './hooks/useProjectStepSignals'
import { getDisplayStep, getDisplayStepIndex } from './projectSteps'
import { ProjectStepNav } from './components/ProjectStepNav'
import { ProjectStepSummaryStrip } from './components/ProjectStepSummaryStrip'
import { ProjectExtractCandidatesPanel } from './components/ProjectExtractCandidatesPanel'
import { AssetWorkbench } from './components/workbench/AssetWorkbench'
import { ProjectStudioStepPanel } from './components/ProjectStudioStepPanel'
import { EpisodeVideoPromptBoard } from './components/EpisodeVideoPromptBoard'
import { ProjectDevInfo } from './components/ProjectDevInfo'

const STEP_PARAM = 'step'
const CHAPTER_PARAM = 'chapter'
const TAB_PARAM = 'tab'
const CREATE_PARAM = 'create'
const EDIT_PARAM = 'edit'
/** 第 2 步的显式面板开关：`legacy_extract` = 改版前的提取确认页（见下方注释） */
const PANEL_PARAM = 'panel'
const LEGACY_EXTRACT_PANEL = 'legacy_extract'

/**
 * 旧 `?tab=` 深链 → 六步映射。其它页面（MainLayout / ChapterStudio /
 * ChapterShotsPage / ProjectLobby / RoleDetailPage）都在用这些链接，必须继续可用：
 *
 * （`ChapterPrep` 已删除：它不可达、且有 40+ 处 `（Mock）` 用户可见文案，
 *   审计 §9 第 3 项建议直接删页；两个 prep 路由在 `App.tsx` 里已重定向到 `../shots`。）
 *   `?tab=chapters`（含 create/edit）            → 第 1 步 剧本
 *   `?tab=roles|scenes|props|costumes|actors`    → 第 2 步 提取资产（并选中对应子页签）
 */
const LEGACY_TAB_TO_STEP: Partial<Record<TabKey, ProjectStepKey>> = {
  chapters: 'script',
  roles: 'extract_assets',
  scenes: 'extract_assets',
  props: 'extract_assets',
  costumes: 'extract_assets',
  actors: 'extract_assets',
}

/** 「提取资产」的子页签沿用 `?tab=` 参数，保证 `?tab=roles&create=1` 这类旧链接继续生效。 */
const ASSET_SUB_TABS = ['roles', 'scenes', 'props', 'costumes', 'actors'] as const
type AssetSubTab = (typeof ASSET_SUB_TABS)[number]
const DEFAULT_ASSET_SUB_TAB: AssetSubTab = 'roles'
const ASSET_SUB_TAB_LABELS: Record<AssetSubTab, string> = {
  roles: '角色',
  scenes: '场景',
  props: '道具',
  costumes: '服装',
  actors: '演员',
}

function isAssetSubTab(value: string | null): value is AssetSubTab {
  return value !== null && (ASSET_SUB_TABS as readonly string[]).includes(value)
}

/** 旧功能页（原 10 个 Tab 里不参与六步流程的部分）→ 保留为「其他」下拉入口 */
const LEGACY_PANEL_TABS: { key: TabKey; label: string }[] = [
  { key: 'dashboard', label: '仪表盘' },
  { key: 'files', label: '项目文件' },
  { key: 'edit', label: '剪辑' },
  { key: 'settings', label: '设置' },
]

const ProjectWorkbench: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const stepFromUrl = searchParams.get(STEP_PARAM)
  const explicitStep: ProjectStepKey | null =
    stepFromUrl !== null && isProjectStepKey(stepFromUrl) ? stepFromUrl : null
  const tabFromUrl = searchParams.get(TAB_PARAM)
  const legacyTab: TabKey | null = tabFromUrl !== null && isTabKey(tabFromUrl) ? tabFromUrl : null
  const assetSubTab: AssetSubTab = isAssetSubTab(tabFromUrl) ? tabFromUrl : DEFAULT_ASSET_SUB_TAB
  const mappedStepFromLegacyTab: ProjectStepKey | null = legacyTab
    ? LEGACY_TAB_TO_STEP[legacyTab] ?? null
    : null
  /** 旧功能页（仪表盘/文件/剪辑/设置）：没有对应的六步，单独渲染 */
  const legacyPanelTab: TabKey | null =
    legacyTab && !LEGACY_TAB_TO_STEP[legacyTab] ? legacyTab : null

  /** URL 里显式指定的步骤（六步导航/旧链接映射）优先；否则先用默认步骤占位，等判定结果再替换 URL。 */
  const activeStep: ProjectStepKey | null =
    explicitStep ?? mappedStepFromLegacyTab ?? (legacyPanelTab ? null : DEFAULT_PROJECT_STEP)

  const { project, loading: projectLoading } = useProject(projectId)
  const { chapters } = useChapters(projectId)

  const chaptersByIndex = useMemo(
    () => [...chapters].sort((a, b) => a.index - b.index),
    [chapters],
  )

  const recommendedChapter = useMemo(() => {
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
  }, [chaptersByIndex])

  /** 当前集：URL 里的 `?chapter=` 优先，其次沿用原来的「推荐章节」逻辑。 */
  const focusChapter = useMemo(() => {
    const fromUrl = searchParams.get(CHAPTER_PARAM)
    if (fromUrl) {
      const matched = chaptersByIndex.find((chapter) => chapter.id === fromUrl)
      if (matched) return matched
    }
    return recommendedChapter
  }, [chaptersByIndex, recommendedChapter, searchParams])

  const {
    loading: signalsLoading,
    input: stepSignals,
    assets: projectAssets,
    detail: stepDetail,
    reload: reloadSignals,
  } = useProjectStepSignals({
    projectId,
    chapters,
    focusChapterId: focusChapter?.id ?? null,
    startMode: project?.startMode ?? 'script',
  })

  const resolution = useMemo(() => resolveProjectStep(stepSignals), [stepSignals])
  const resolvedStepMeta = getProjectStepMeta(resolution.step)

  const chapterLabel = focusChapter ? `第${focusChapter.index}集 · ${focusChapter.title}` : null

  const updateSearchParams = (mutate: (next: URLSearchParams) => void) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        mutate(next)
        return next
      },
      { replace: true },
    )
  }

  /** 切到某个步骤（第 1-3 步就地渲染；第 4-6 步由调用方决定是否跳工作室）。 */
  const openStep = (step: ProjectStepKey, subTab?: AssetSubTab | null) => {
    updateSearchParams((next) => {
      next.set(STEP_PARAM, step)
      if (step === 'extract_assets') {
        next.set(TAB_PARAM, subTab ?? assetSubTab)
      } else {
        next.delete(TAB_PARAM)
      }
      if (step !== 'script') {
        next.delete(CREATE_PARAM)
        next.delete(EDIT_PARAM)
      }
    })
  }

  /** 兼容入口：原来的 `setTabInUrl` / `onSelectTab` 语义（旧 Tab → 六步或旧功能页）。 */
  const setTabInUrl = (tab: TabKey) => {
    const mappedStep = LEGACY_TAB_TO_STEP[tab]
    updateSearchParams((next) => {
      if (mappedStep) {
        next.set(STEP_PARAM, mappedStep)
      } else {
        next.delete(STEP_PARAM)
      }
      next.set(TAB_PARAM, tab)
    })
  }

  const setAssetSubTab = (subTab: AssetSubTab) => {
    updateSearchParams((next) => {
      next.set(STEP_PARAM, 'extract_assets')
      next.set(TAB_PARAM, subTab)
    })
  }

  const setChapterInUrl = (chapterId: string) => {
    updateSearchParams((next) => {
      next.set(CHAPTER_PARAM, chapterId)
    })
  }

  /** 进入章节工作室（第 4-6 步）：带上 `?studio=<step>` 与当前集，供下一轮拆分工作室使用。 */
  const openChapterStudio = (step: ProjectStepKey) => {
    if (!projectId || !focusChapter) return
    const studioPath = getChapterStudioPath(projectId, focusChapter.id)
    navigate(`${studioPath}?studio=${step}&${CHAPTER_PARAM}=${encodeURIComponent(focusChapter.id)}`)
  }

  const handleSelectStep = (step: ProjectStepKey) => {
    if (!focusChapter) {
      // 没有可用集时：把步骤写进 URL，由第 4-6 步入口面板给出「先选/建一集」的空状态。
      openStep(step, null)
      return
    }
    if (step === 'video_prompt') {
      // 第 4 步是**集级视频提示词页面**（在工作台内就地渲染 `EpisodeVideoPromptBoard`）：
      // 批量生成 / 批量导入 / 统一确认保存都在这里，右上角「进入分镜工作台」再去逐镜检查。
      // 之前这里直接跳章节工作室，等于把集级主入口整个跳过，页面上的批量导入点不到。
      openStep(step)
      return
    }
    if (isStudioProjectStep(step)) {
      openChapterStudio(step)
      return
    }
    openStep(step)
  }

  // 未显式指定步骤时，按项目当前状态判定「第一个未完成步骤」并替换 URL（replace，避免返回时反复弹跳）。
  useEffect(() => {
    if (!projectId) return
    if (explicitStep || mappedStepFromLegacyTab || legacyPanelTab) return
    if (signalsLoading) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set(STEP_PARAM, resolution.step)
        return next
      },
      { replace: true },
    )
  }, [projectId, explicitStep, mappedStepFromLegacyTab, legacyPanelTab, signalsLoading, resolution.step, setSearchParams])

  /**
   * 「继续」的目标步骤、禁用理由与点击动作——三者全部来自同一份 `resolveProjectStep` 结果。
   *
   * 历史问题（本次修复）：旧实现里按钮文案来自项目级六步判定，而点击动作在
   * 「已处于目标步骤」时回退执行章节级 `getChapterPreparationState()` 得出的 primaryCta，
   * 于是按钮写着「继续：准备资产图片」却跳进了分镜工作室，直接跳过
   * 图片准备 → 整集视频提示词 → 关联绑定。现在只认 resolution.step。
   */
  const continueTarget = resolution.step
  /** 第 4 步的主入口在工作台内（集级提示词页面），不进工作室。 */
  const continueEntersStudio =
    isStudioProjectStep(continueTarget) && continueTarget !== 'video_prompt' && Boolean(focusChapter)
  /** 第 1 步且还没有章节：动作就是打开「新建章节」，这仍是第 1 步自己的动作。 */
  const continueOpensChapterCreate = continueTarget === 'script' && !recommendedChapter
  const continueChangesView =
    continueEntersStudio || continueOpensChapterCreate || continueTarget !== activeStep

  const continueDisabledReason = signalsLoading
    ? '正在判断项目进度，稍候…'
    : continueChangesView
      ? ''
      : `当前就在第 ${getProjectStepIndex(continueTarget) + 1} 步：请在本页完成本步操作`
  /** 已经站在判定出的这一步上：按钮不给假动作，也不假装还能「继续」。 */
  const continueAtCurrentStep = !signalsLoading && !continueChangesView

  /** 两个「继续」按钮共用同一句话——文案、目标与动作同源。 */
  const continueLabel = signalsLoading
    ? '正在判断项目进度'
    : continueAtCurrentStep
      ? `已在本步：${resolvedStepMeta.label}`
      : `继续：${resolution.nextActionLabel}`

  /** T3「继续」：唯一入口，只按判定结果导航（不再有任何「跳到工作室」的隐式回退）。 */
  const handleContinue = () => {
    if (!projectId || signalsLoading) return
    if (continueOpensChapterCreate) {
      setTabInUrl('chapters')
      updateSearchParams((next) => {
        next.set(STEP_PARAM, 'script')
        next.set(CREATE_PARAM, '1')
      })
      return
    }
    if (continueEntersStudio) {
      openChapterStudio(continueTarget)
      return
    }
    openStep(continueTarget)
  }

  const moreMenuItems: MenuProps['items'] = [
    { key: 'newActor', label: '关联演员', onClick: () => setTabInUrl('actors') },
    { key: 'newRole', label: '新建角色', onClick: () => setTabInUrl('roles') },
    { key: 'upload', label: '上传素材', onClick: () => navigate('/assets') },
    { key: 'newScene', label: '新建场景', onClick: () => setTabInUrl('scenes') },
    { key: 'newProp', label: '新建道具', onClick: () => setTabInUrl('props') },
    { key: 'newCostume', label: '新建服装', onClick: () => setTabInUrl('costumes') },
  ]

  /** 原 10 个 Tab 里未进入六步流程的入口，保留在这里，保证功能不丢。 */
  const workspaceMenuItems: MenuProps['items'] = [
    ...LEGACY_PANEL_TABS.map((item) => ({
      key: item.key,
      label: item.label,
      onClick: () => setTabInUrl(item.key),
    })),
    { type: 'divider' as const },
    { key: 'chapterList', label: '章节列表（第 1 步）', onClick: () => setTabInUrl('chapters') },
    { key: 'assetsPath', label: '资产管理', onClick: () => navigate('/assets') },
    { key: 'filesPath', label: '文件管理', onClick: () => navigate('/files') },
  ]

  /**
   * 项目不存在 / 已删除：只算一个布尔值，**不再在这里早期 return**。
   *
   * 历史问题（审计 §5.5-A1 / R26，截图 `p2_e3_bad_project-1.png`）：这条分支原来就写在
   * 这里——在 ~40 个 hook 之后、`openAssetEditor`（`useCallback`）之前。于是当
   * `projectLoading` 由 true 翻成 false 而 `project === undefined` 时，这一次渲染比上一次
   * **少调用一个 hook**，React 直接抛
   * `Rendered fewer hooks than expected. This may be caused by an accidental early return statement.`，
   * 被 `main.tsx` 顶层 ErrorBoundary 接住，整棵树（含 `MainLayout` 侧边导航）一起消失，
   * 页面完全不可用。
   *
   * 现在所有 hook 在每次渲染都无条件执行，空态挪到组件最后一个 return 处渲染。
   * 本页由 `App.tsx` 的 `<Route path="projects/:projectId">` 嵌套在
   * `<Route path="/" element={<MainLayout />}>` 之下，正常渲染空态即可保住侧边导航。
   */
  const projectMissing = !project && !projectLoading

  /**
   * 打开既有资产编辑页（原第 2 步面板里的同一套跳转口径，改版后由工作台卡片调用）。
   *
   * `generate=true` 时带上 `?generate=1`：资产编辑页会自动打开该资产的出图确认弹窗。
   * 两条路径都带项目作用域（character 走项目角色路由，其余带 returnTo），
   * 避免出现「从资产库进入 → 缺项目作用域 → 出图静默失败」。
   */
  const openAssetEditor = useCallback(
    (asset: ProjectSignalAsset, options?: { generate?: boolean }) => {
      if (!projectId) return
      const assetType = asset.type
      const generateParam = options?.generate ? '?generate=1' : ''
      if (assetType === 'character') {
        navigate(`/projects/${projectId}/roles/${asset.id}/edit${generateParam}`)
        return
      }
      const segment = assetType === 'scene' ? 'scenes' : assetType === 'prop' ? 'props' : 'costumes'
      const tabByType: Record<Exclude<ProjectSignalAssetType, 'character'>, 'scenes' | 'props' | 'costumes'> = {
        scene: 'scenes',
        prop: 'props',
        costume: 'costumes',
      }
      const returnTo = encodeURIComponent(`/projects/${projectId}?step=extract_assets&tab=${tabByType[assetType]}`)
      navigate(`/assets/${segment}/${asset.id}/edit?returnTo=${returnTo}${options?.generate ? '&generate=1' : ''}`)
    },
    [navigate, projectId],
  )

  const renderStepContent = () => {
    if (!activeStep) return null
    if (activeStep === 'script') return <ChaptersTab />
    if (activeStep === 'extract_assets' || activeStep === 'image_prep') {
      /**
       * 用户看到的第 2 步「资产准备」= **一个资产生产工作台**（`AssetWorkbench`）。
       *
       * 内部两个 step（`extract_assets` / `image_prep`）渲染的是**同一屏**，
       * 所以旧深链（`?step=image_prep`）依然可用，只是不再单独占一步。
       *
       * 为什么不再是旧的两块面板上下拼接：旧结构里上游表 → 资产生产表 → 提示词表
       * 各有一套选择与展示，同一批资产被重复选择和重复展示，主页面还摊开了大量后台维度。
       *
       * 旧的 `ProjectExtractCandidatesPanel` / `ProjectImagePrepPanel` 文件**保留**，
       * 并且仍然可达：`?step=extract_assets&panel=legacy_extract` 渲染原样的一屏
       * （入口收在「技术详情」里的一条链接，以及「待处理 N 项」抽屉没有对应资产时的兜底），
       * 所以"写入前逐条人工确认"的能力不会因为改版而丢失。
       */
      if (searchParams.get(PANEL_PARAM) === LEGACY_EXTRACT_PANEL) {
        return (
          <div className="h-full min-h-0 flex flex-col overflow-auto pr-1">
            <Alert
              type="info"
              showIcon
              className="mb-2"
              message="这是改版前的提取确认页（入口保留，不再是第 2 步的主界面）"
              description={
                <span className="text-xs">
                  第 2 步的默认界面是资产生产工作台；这一页保留用于写入前的逐条人工确认。
                  <Button
                    type="link"
                    size="small"
                    onClick={() =>
                      updateSearchParams((next) => {
                        next.delete(PANEL_PARAM)
                      })
                    }
                  >
                    回到资产生产工作台
                  </Button>
                </span>
              }
            />
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-gray-500">写入前的人工确认：关联已有资产或新建。</span>
              <Segmented
                size="small"
                value={assetSubTab}
                onChange={(value) => {
                  const nextSubTab = String(value)
                  if (isAssetSubTab(nextSubTab)) setAssetSubTab(nextSubTab)
                }}
                options={ASSET_SUB_TABS.map((key) => ({
                  label: ASSET_SUB_TAB_LABELS[key],
                  value: key,
                }))}
              />
            </div>
            <ProjectExtractCandidatesPanel
              projectId={projectId ?? null}
              chapterId={focusChapter?.id ?? null}
              chapterLabel={chapterLabel}
              onReload={reloadSignals}
            />
            <div className="mt-3 min-h-0">
              {assetSubTab === 'roles' && <RolesTab />}
              {assetSubTab === 'scenes' && <ScenesTab />}
              {assetSubTab === 'props' && <PropsTab />}
              {assetSubTab === 'costumes' && <CostumesTab />}
              {assetSubTab === 'actors' && <ActorsTab />}
            </div>
          </div>
        )
      }
      return (
        <AssetWorkbench
          projectId={projectId ?? null}
          chapter={{
            id: focusChapter?.id ?? null,
            index: focusChapter?.index ?? null,
            title: focusChapter?.title ?? '未选择章节',
            rawText: focusChapter?.rawText ?? '',
            scriptChars: (focusChapter?.rawText ?? '').replace(/\s/g, '').length,
          }}
          assets={projectAssets}
          detail={stepDetail}
          loading={signalsLoading}
          onReload={reloadSignals}
          onOpenAssetEditor={openAssetEditor}
          onOpenLegacyExtractConfirm={() =>
            updateSearchParams((next) => {
              next.set(PANEL_PARAM, LEGACY_EXTRACT_PANEL)
            })
          }
        />
      )
    }
    if (activeStep === 'video_prompt') {
      // 第 4 步的**主入口**：集级批量生成/导入 + 统一确认保存（进入分镜工作台之前的必经页面）。
      return (
        <EpisodeVideoPromptBoard
          projectId={projectId ?? ''}
          chapterId={focusChapter?.id ?? null}
          chapterLabel={chapterLabel ?? '未选择章节'}
          onEnterStudio={() => openChapterStudio('video_prompt')}
          onContinueAssets={() => openStep('extract_assets')}
          onGoBinding={() => openChapterStudio('binding')}
        />
      )
    }
    return (
      <ProjectStudioStepPanel
        step={activeStep}
        chapterLabel={chapterLabel}
        hasChapter={Boolean(focusChapter)}
        projectId={projectId}
        chapterId={focusChapter?.id ?? null}
        onEnterStudio={(step) => openChapterStudio(step)}
        onGoStep={openStep}
      />
    )
  }

  // 空态在**所有 hook 之后**渲染：hook 数量在 loading → 不存在 的前后两次渲染之间保持一致（§5.5-A1）。
  if (projectMissing) {
    return (
      <Card>
        <Empty description="项目不存在或已被删除" />
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
        style={{ margin: -5, marginBottom: 0, padding: '12px 24px 0' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="text-xs text-gray-500">当前项目</span>
            <Link to="/projects" className="font-medium truncate max-w-[220px]" title={project?.name}>
              {project?.name ?? '加载中…'}
            </Link>
            <span className="text-xs text-gray-500 ml-1">当前集</span>
            {chaptersByIndex.length > 0 ? (
              <Select
                size="small"
                className="min-w-[200px]"
                value={focusChapter?.id}
                onChange={(value: string) => setChapterInUrl(value)}
                options={chaptersByIndex.map((chapter) => ({
                  value: chapter.id,
                  label: `第${chapter.index}集 · ${chapter.title}`,
                }))}
              />
            ) : (
              <Tag bordered={false} className="text-[11px]">
                还没有章节
              </Tag>
            )}
          </div>

          <Space size="small" wrap className="shrink-0">
            <Tooltip title={continueDisabledReason || resolution.reason}>
              <Button
                type="primary"
                icon={<RightOutlined />}
                loading={signalsLoading}
                disabled={Boolean(continueDisabledReason)}
                onClick={handleContinue}
              >
                {continueLabel}
              </Button>
            </Tooltip>
            <Button
              icon={<VideoCameraFilled />}
              onClick={() => projectId && navigate(getProjectEditorPath(projectId))}
            >
              进入后期剪辑
            </Button>
            {/*
              广告剧情流程的入口（「剧情策划」）。
              它**不是**第六步：五步模型（resolveProjectStep / ProjectStepNav）一个字都没改，
              方案确认落库后产出的就是第 1 步要读的章节与分镜，用户回来照常点「继续」。
              之所以做成工作台里的按钮而不是新步骤：入口批已按用户口径后置，
              本批只保证"项目内能进去"。
            */}
            <Button
              icon={<ReadOutlined />}
              disabled={!projectId}
              onClick={() => projectId && navigate(`/drama-plan?projectId=${encodeURIComponent(projectId)}`)}
            >
              剧情策划
            </Button>
            <Dropdown menu={{ items: moreMenuItems }} placement="bottomRight">
              <Button icon={<EllipsisOutlined />}>更多</Button>
            </Dropdown>
            <Dropdown menu={{ items: workspaceMenuItems }} placement="bottomRight">
              <Button icon={<AppstoreOutlined />}>其他</Button>
            </Dropdown>
          </Space>
        </div>

        <ProjectStepNav
          activeStep={activeStep}
          resolvedStep={resolution.step}
          startMode={project?.startMode ?? 'script'}
          loading={signalsLoading}
          onSelectStep={handleSelectStep}
        />

        <div className="mt-0 mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          {/* 同一份判定的理由：不再展示章节级状态机给出的「建议」，避免两套口径同屏打架。 */}
          <span>{signalsLoading ? '正在读取章节、分镜、资产与提示词状态…' : resolution.reason}</span>
          <span className="flex items-center gap-1">
            <InfoCircleOutlined />
            {signalsLoading
              ? '正在判断项目进度…'
              : `当前流程位置：第 ${getDisplayStepIndex(resolution.step) + 1} 步 · ${
                  getDisplayStep(resolution.step).label
                }`}
          </span>
        </div>
      </div>

      <div
        className="pt-3 animate-fadeIn flex-1 min-h-0 overflow-hidden"
        style={{ animation: 'fadeIn 0.25s ease-out' }}
      >
        {legacyPanelTab ? (
          <div className="h-full min-h-0 overflow-hidden flex flex-col">
            <Card size="small" className="mb-3" styles={{ body: { padding: '8px 12px' } }}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                <span>
                  你正在查看工作台的其他功能页（{LEGACY_PANEL_TABS.find((item) => item.key === legacyPanelTab)?.label}），
                  它不属于五步主流程。
                </span>
                <Space size="small">
                  <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => openStep(resolution.step)}>
                    回到第 {getProjectStepIndex(resolution.step) + 1} 步：{resolvedStepMeta.label}
                  </Button>
                </Space>
              </div>
            </Card>
            <div className="flex-1 min-h-0 overflow-hidden">
              {legacyPanelTab === 'dashboard' && <DashboardTab onSelectTab={setTabInUrl} />}
              {legacyPanelTab === 'files' && <FilesTab />}
              {legacyPanelTab === 'edit' && <EditTab />}
              {legacyPanelTab === 'settings' && <SettingsTab />}
            </div>
          </div>
        ) : (
          <div className="h-full min-h-0 overflow-hidden flex flex-col">
            {activeStep ? (
              <ProjectStepSummaryStrip
                step={activeStep}
                resolution={resolution}
                chapterLabel={chapterLabel}
                loading={signalsLoading}
                continueDisabledReason={continueDisabledReason}
                continueLabel={continueLabel}
                onGoStep={openStep}
                onContinue={handleContinue}
                devInfo={
                  <ProjectDevInfo
                    detail={stepDetail}
                    model={stepSignals}
                    resolution={resolution}
                    onReload={reloadSignals}
                  />
                }
              />
            ) : null}
            {/* 资产类子页签自带 h-full + overflow-auto；剧本/图片准备/工作室入口用外层滚动兜底 */}
            <div className="flex-1 min-h-0 overflow-auto">{renderStepContent()}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ProjectWorkbench
