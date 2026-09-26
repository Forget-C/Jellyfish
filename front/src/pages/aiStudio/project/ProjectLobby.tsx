import React, { useEffect, useMemo, useState } from 'react'
import { formatUserFacingTime } from '../components/userFacingTime'
import {
  Card,
  Input,
  Button,
  Progress,
  Radio,
  Statistic,
  Row,
  Col,
  Modal,
  Form,
  Select,
  AutoComplete,
  Switch,
  message,
  Space,
  Tag,
  Popconfirm,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EnterOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  BarsOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { chapters as mockChapters, projects as mockProjects, type Project } from '../../../mocks/data'
import { StudioChaptersService, StudioProjectsService } from '../../../services/generated'
import type { ChapterRead, ProjectRead } from '../../../services/generated'
import {
  ProjectVisualStyleAndStyleFields,
  type ProjectVisualStyleChoice,
} from './ProjectVisualStyleAndStyleFields'
import { useProjectStyleOptions } from './useProjectStyleOptions'
import { getChapterPreparationState } from './ProjectWorkbench/chapterPreparation'
import { getChapterShotsPath } from './ProjectWorkbench/routes'
import { loadProjectFlowStatsForChapters, type ProjectFlowStats } from './ProjectWorkbench/projectFlowStats'
import {
  OVERALL_STYLE_PRESETS,
  resolveProjectVideoRatio,
  START_MODE_OPTIONS,
  resolveLandingStep,
  resolveOverallStyleFields,
  type OverallStyleKey,
  type ProjectStartModeChoice,
} from './projectStartPresets'

type ViewMode = 'grid' | 'compact' | 'large'
type FilterTab = 'all' | 'editRaw' | 'extractShots' | 'prepareShots' | 'generating' | 'ready'
type SortKey = 'updatedAt' | 'name' | 'createdAt' | 'chapters'
type ChapterPreparationInput = Parameters<typeof getChapterPreparationState>[0]
type ProjectStageSummary = {
  key: ReturnType<typeof getChapterPreparationState>['key'] | 'create_first_chapter'
  stageText: string
  stageColor: string
  nextActionLabel: string
  nextActionHint: string
  chapterId?: string
  storyboardCount?: number
}
type ProjectFlowStatsMap = Record<string, ProjectFlowStats>
type ProjectView = Project & {
  visualStyle?: ProjectVisualStyleChoice
  defaultVideoRatio?: string | null
}

/**
 * 项目卡片上的时间显示。
 *
 * 只显示后端下发的真实创建时间（`created_at`）；拿不到就显示「—」，
 * 绝不用 `new Date()` 兜底——那正是「每个项目的时间都等于打开页面那一刻」的来源。
 *
 * 阶段 B 第 2 批把实现搬到共享模块 `components/userFacingTime.ts`：
 * 工作台步骤 1 的「更新时间」列原来直接渲 ISO 串（审计 §4.2 模式 3），
 * 修法要求「复用这份既有实现」，所以这里改成从**唯一**实现取，
 * 全仓不再有第二份 `YYYY-MM-DD HH:mm` 拼装。
 */
const formatProjectTime = formatUserFacingTime

/**
 * 「孤立项目 <内部编号>（迁移）」形态的项目名。
 *
 * 迁移时有些项目按内部编号自动生成了名字（例：`孤立项目 script_9c3aafd08a（迁移）`），
 * 这种名字本身就是一个内部标识，直接渲染等于把内部编号端给用户看。
 * 判定要求编号里含**连续 8 位以上十六进制字符**，这样用户自己起的
 * 「孤立项目 1」之类不会被误判成自动生成的。
 */
const ORPHAN_PROJECT_NAME_PATTERN =
  /^孤立项目[\s\u3000]+[\w-]*[0-9a-f]{8,}[\w-]*[\s\u3000]*(（迁移）|\(迁移\))?$/i

/**
 * 项目名的展示口径：只在名字形如「孤立项目 <内部编号>（迁移）」时才折叠成
 * 「未命名项目（迁移）」，其余名字**一个字符都不改**地原样返回。
 *
 * 为什么放在展示层：改名要经过运营确认，前端不该写回库；但主区也不该出现内部编号，
 * 所以在渲染前折叠。原名仍留在数据层（`ProjectView.name`），技术详情层需要时可直接取用。
 *
 * 导出为纯函数（只吃字符串、只吐字符串，不碰状态、不发请求），便于单独单测形态判断。
 */
export function displayProjectName(name: string): string {
  const source = typeof name === 'string' ? name : ''
  const matched = ORPHAN_PROJECT_NAME_PATTERN.exec(source.trim())
  if (!matched) return name
  return matched[1] ? '未命名项目（迁移）' : '未命名项目'
}

/**
 * 排序下拉的中文文案。
 *
 * 为什么必须是一张「全集」映射表：`SortKey` 是内部键，而下拉的 `value` 用的就是 `sortKey`。
 * 以前选项里**没有** `createdAt` 这一项，默认值却是 `'createdAt'` —— antd 在
 * 「当前值在 options 里找不到」时会把 value 原样当文案渲染，于是「排序」后面直接跟着
 * 那个内部键的英文原文（首屏可见）。用 `Record<SortKey, string>` 收口后，
 * 任何一个合法键都必然有中文文案，内部键不可能再上屏。
 *
 * TODO(阶段B①): 迁移到 enumLabels.ts（SortKey）
 */
const SORT_KEY_LABELS: Record<SortKey, string> = {
  updatedAt: '最近更新',
  createdAt: '创建时间',
  name: '名称 A-Z',
  chapters: '章节数量',
}

/** 排序方向的业务说法：按当前排序键给出「新→旧」这类中文，不显示内部键，也不用裸箭头。 */
const SORT_DIRECTION_LABELS: Record<SortKey, { asc: string; desc: string }> = {
  updatedAt: { asc: '旧→新', desc: '新→旧' },
  createdAt: { asc: '旧→新', desc: '新→旧' },
  name: { asc: 'A→Z', desc: 'Z→A' },
  chapters: { asc: '少→多', desc: '多→少' },
}

/** 下拉可选项：从上面的中文文案表推导，保证「有键必有中文文案」。 */
const SORT_SELECT_OPTIONS: { label: string; value: SortKey }[] = (
  Object.keys(SORT_KEY_LABELS) as SortKey[]
).map((key) => ({ label: SORT_KEY_LABELS[key], value: key }))

const ProjectLobby: React.FC = () => {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectView | null>(null)
  const [projectStageMap, setProjectStageMap] = useState<Record<string, ProjectStageSummary>>({})
  const [projectFlowStatsMap, setProjectFlowStatsMap] = useState<ProjectFlowStatsMap>({})
  const {
    options: projectStyleOptions,
    videoRatioOptions,
    defaultVideoRatio,
  } = useProjectStyleOptions()
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()

  const useMock = import.meta.env.VITE_USE_MOCK === 'true'

  const toUIProject = (p: ProjectRead): ProjectView => {
    const stats = (p.stats ?? {}) as Record<string, unknown>
    const getNum = (key: string) => {
      const v = stats[key]
      return typeof v === 'number' && Number.isFinite(v) ? v : 0
    }

    /**
     * 时间戳只认后端下发的真实值。
     *
     * 历史问题：这里原来读 `stats.updated_at`，后端从不写 stats，于是所有项目都回退成
     * `new Date().toISOString()`——列表上每个项目的时间都等于「打开页面的那一刻」，
     * 「最近更新」排序因此完全失效，卡片上显示的也是这个假时间。
     */
    const createdAt = typeof p.created_at === 'string' ? p.created_at : ''
    const updatedAt = (typeof p.updated_at === 'string' && p.updated_at) || createdAt

    return {
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      style: (p.style as Project['style']) ?? '现实主义',
      seed: p.seed ?? 0,
      unifyStyle: p.unify_style ?? true,
      progress: p.progress ?? 0,
      stats: {
        chapters: getNum('chapters'),
        roles: getNum('roles'),
        scenes: getNum('scenes'),
        props: getNum('props'),
      },
      createdAt,
      updatedAt,
      visualStyle: (p.visual_style as ProjectVisualStyleChoice | undefined) ?? '现实',
      defaultVideoRatio: p.default_video_ratio ?? null,
    }
  }

  const newProjectId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }

  const load = async () => {
    setLoading(true)
    try {
      if (useMock) {
        setProjects(mockProjects)
      } else {
        /**
         * 一次拉满一页（100 条），不再写死 `pageSize: 10`。
         *
         * 为什么必须改：这个列表页**没有翻页控件、也没有服务端搜索**，写死 10 条意味着
         * 第 11 个项目之后在项目列表里根本点不到 —— 新建完项目再回列表就"找不到自己的项目"。
         * 列表页下方本来就靠 `filteredSorted` 做本地筛选/排序，条数放宽不会改变交互。
         */
        const res = await StudioProjectsService.listProjectsApiV1StudioProjectsGet({
          page: 1,
          pageSize: 100,
        })
        const items = res.data?.items ?? []
        setProjects(items.map(toUIProject))
      }
    } catch {
      setProjects(useMock ? mockProjects : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const getProjectStatus = (p: ProjectView): 'draft' | 'inProgress' | 'completed' => {
    if (p.progress >= 90) return 'completed'
    if (p.progress <= 5) return 'draft'
    return 'inProgress'
  }

  useEffect(() => {
    const list = Array.isArray(projects) ? projects : []
    if (!list.length) {
      setProjectStageMap({})
      setProjectFlowStatsMap({})
      return
    }

    const summarizeProjectChapters = (chapters: ChapterPreparationInput[]): ProjectStageSummary => {
      const chaptersByIndex = [...chapters].sort((a, b) => a.index - b.index)
      if (!chaptersByIndex.length) {
        return {
          key: 'create_first_chapter',
          stageText: '待创建章节',
          stageColor: 'default',
          nextActionLabel: '创建第一章',
          nextActionHint: '项目还没有章节，建议先创建第一章',
        }
      }
      const findByState = (key: ReturnType<typeof getChapterPreparationState>['key']) =>
        chaptersByIndex.find((chapter) => getChapterPreparationState(chapter).key === key)
      const chapter =
        findByState('edit_raw') ??
        findByState('extract_shots') ??
        findByState('prepare_shots') ??
        findByState('shoot') ??
        chaptersByIndex[0]
      const state = getChapterPreparationState(chapter)
      return {
        key: state.key,
        stageText: state.text,
        stageColor: state.color,
        nextActionLabel: state.primaryAction,
        nextActionHint: `第${chapter.index}章 · ${state.hint}`,
        chapterId: chapter.id,
        storyboardCount: chapter.storyboardCount,
      }
    }

    const loadSummaries = async () => {
      try {
        if (useMock) {
          const chapterGroups = Object.fromEntries(
            list.map((project) => [
              project.id,
              mockChapters
                .filter((chapter) => chapter.projectId === project.id)
                .map((chapter) => ({
                  id: chapter.id,
                  projectId: chapter.projectId,
                  index: chapter.index,
                  title: chapter.title,
                  summary: chapter.summary ?? '',
                  rawText: chapter.summary ?? '',
                  storyboardCount: chapter.storyboardCount,
                  status: chapter.status,
                  updatedAt: chapter.updatedAt,
                })),
            ]),
          )
          setProjectStageMap(
            Object.fromEntries(
              Object.entries(chapterGroups).map(([projectId, chapters]) => [
                projectId,
                summarizeProjectChapters(chapters),
              ]),
            ),
          )
          const flowStatsEntries = await Promise.all(
            Object.entries(chapterGroups).map(async ([projectId, chapters]) => [
              projectId,
              await loadProjectFlowStatsForChapters(chapters),
            ] as const),
          )
          setProjectFlowStatsMap(Object.fromEntries(flowStatsEntries))
          return
        }

        const chapterResponses = await Promise.all(
          list.map(async (project) => {
            const res = await StudioChaptersService.listChaptersApiV1StudioChaptersGet({
              projectId: project.id,
              page: 1,
              pageSize: 100,
            })
            const items: ChapterRead[] = res.data?.items ?? []
            return [
              project.id,
              summarizeProjectChapters(
                items.map((chapter) => ({
                  id: chapter.id,
                  projectId: chapter.project_id,
                  index: chapter.index,
                  title: chapter.title,
                  summary: chapter.summary ?? '',
                  rawText: chapter.raw_text ?? '',
                  storyboardCount: chapter.shot_count ?? chapter.storyboard_count ?? 0,
                  status: chapter.status ?? 'draft',
                  updatedAt: new Date().toISOString(),
                })),
              ),
              items.map((chapter) => ({
                id: chapter.id,
                projectId: chapter.project_id,
                index: chapter.index,
                title: chapter.title,
                summary: chapter.summary ?? '',
                rawText: chapter.raw_text ?? '',
                storyboardCount: chapter.shot_count ?? chapter.storyboard_count ?? 0,
                status: chapter.status ?? 'draft',
                updatedAt: new Date().toISOString(),
              })),
            ] as const
          }),
        )
        setProjectStageMap(
          Object.fromEntries(chapterResponses.map(([projectId, summary]) => [projectId, summary])),
        )
        const flowStatsEntries = await Promise.all(
          chapterResponses.map(async ([projectId, _summary, chapters]) => [
            projectId,
            await loadProjectFlowStatsForChapters(chapters),
          ] as const),
        )
        setProjectFlowStatsMap(Object.fromEntries(flowStatsEntries))
      } catch {
        setProjectStageMap({})
        setProjectFlowStatsMap({})
      }
    }

    void loadSummaries()
  }, [projects, useMock])

  const filteredSorted = useMemo(() => {
    const list = Array.isArray(projects) ? projects : []
    const keyword = search.trim().toLowerCase()

    let next = list.filter((p) => {
      if (keyword) {
        const inText =
          p.name.toLowerCase().includes(keyword) ||
          p.description.toLowerCase().includes(keyword)
        if (!inText) return false
      }

      if (filterTab === 'all') return true
      const stage = projectStageMap[p.id]
      const flowStats = projectFlowStatsMap[p.id]
      if (filterTab === 'editRaw') return stage?.key === 'edit_raw' || stage?.key === 'create_first_chapter'
      if (filterTab === 'extractShots') return stage?.key === 'extract_shots'
      if (filterTab === 'prepareShots') return stage?.key === 'prepare_shots'
      if (filterTab === 'generating') return (flowStats?.generatingShots ?? 0) > 0
      if (filterTab === 'ready') return (flowStats?.readyShots ?? 0) > 0
      return true
    })

    next.sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      if (sortKey === 'name') {
        av = a.name
        bv = b.name
      } else if (sortKey === 'chapters') {
        av = a.stats.chapters
        bv = b.stats.chapters
      } else if (sortKey === 'createdAt') {
        // 真实创建时间：后端 created_at（ISO 字符串，可直接字典序比较）。
        // 以前这里比较的是 a.id / b.id，跟时间毫无关系。
        av = a.createdAt ?? ''
        bv = b.createdAt ?? ''
      } else {
        av = a.updatedAt
        bv = b.updatedAt
      }

      if (typeof av === 'number' && typeof bv === 'number') {
        return sortOrder === 'asc' ? av - bv : bv - av
      }
      const res = String(av).localeCompare(String(bv))
      return sortOrder === 'asc' ? res : -res
    })

    return next
  }, [projects, search, filterTab, sortKey, sortOrder, projectStageMap, projectFlowStatsMap])

  const handleSelectProject = (id: string) => {
    setSelectedProjectId(id)
  }

  const handleToggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)
    )
  }

  const handleBatchDelete = async () => {
    if (!selectedIds.length) return
    try {
      await Promise.all(
        selectedIds.map((id) =>
          StudioProjectsService.deleteProjectApiV1StudioProjectsProjectIdDelete({ projectId: id }),
        ),
      )
      setProjects((prev) =>
        Array.isArray(prev) ? prev.filter((p) => !selectedIds.includes(p.id)) : prev
      )
      setSelectedIds([])
      message.success('已批量删除选中项目')
    } catch {
      message.error('批量删除失败')
    }
  }

  const handleOpenCreate = () => {
    form.resetFields()
    const defaultVisual = (projectStyleOptions.visualStyles[0]?.value ?? '现实') as ProjectVisualStyleChoice
    const defaultStyle =
      projectStyleOptions.defaultStyleByVisual?.[defaultVisual] ??
      projectStyleOptions.stylesByVisual[defaultVisual]?.[0]?.value
    form.setFieldsValue({
      visual_style: defaultVisual,
      style: defaultStyle,
      unifyStyle: true,
      default_video_ratio: defaultVideoRatio,
      startMode: 'script',
      overallStyle: 'live_portrait',
    })
    setCreateModalOpen(true)
  }

  const handleCreateSubmit = async (values: {
    name: string
    description?: string
    style: string
    visual_style: ProjectVisualStyleChoice
    unifyStyle: boolean
    default_video_ratio?: string
    startMode: ProjectStartModeChoice
    overallStyle: OverallStyleKey
  }) => {
    try {
      const createdId = newProjectId()
      const startMode: ProjectStartModeChoice = values.startMode ?? 'script'
      // 「整体风格」预设覆盖三个既有列；选「其他自定义」时用用户自己填的值。
      const preset = resolveOverallStyleFields(values.overallStyle)
      const res = await StudioProjectsService.createProjectApiV1StudioProjectsPost({
        requestBody: {
          id: createdId,
          name: values.name,
          description: values.description ?? '',
          style: preset?.style ?? values.style,
          visual_style: (preset?.visual_style ?? values.visual_style) as any,
          unify_style: values.unifyStyle,
          // 方案 B（2026-09-23）：预设只负责「自动填入默认值」，用户手填的优先
          default_video_ratio: resolveProjectVideoRatio(values.overallStyle, values.default_video_ratio),
          start_mode: startMode as any,
          progress: 0,
        },
      })
      const created = res.data
      if (!created) throw new Error('empty project')
      const ui = toUIProject(created)
      message.success(
        startMode === 'prompts'
          ? '项目创建成功：已自动创建默认章节，正在进入整集视频提示词看板'
          : '项目创建成功',
      )
      setCreateModalOpen(false)
      setProjects((prev) => (Array.isArray(prev) ? [...prev, ui] : [ui]))
      // 两种起点汇入同一条生产流程，只是第一步不同
      navigate(`/projects/${ui.id}?step=${resolveLandingStep(startMode)}`)
    } catch {
      message.error('创建失败')
    }
  }

  const handleOpenEdit = (e: React.MouseEvent, p: ProjectView) => {
    e.stopPropagation()
    setEditingProject(p)
    editForm.setFieldsValue({
      name: p.name,
      description: p.description,
      style: p.style,
      visual_style: p.visualStyle ?? '现实',
      unifyStyle: p.unifyStyle,
      default_video_ratio: p.defaultVideoRatio ?? undefined,
    })
    setEditModalOpen(true)
  }

  const handleEditSubmit = async (values: {
    name: string
    description?: string
    style: string
    visual_style: ProjectVisualStyleChoice
    unifyStyle: boolean
    default_video_ratio?: string
  }) => {
    if (!editingProject) return
    try {
      const res = await StudioProjectsService.updateProjectApiV1StudioProjectsProjectIdPatch({
        projectId: editingProject.id,
        requestBody: {
          name: values.name,
          description: values.description ?? '',
          style: values.style,
          visual_style: values.visual_style as any,
          unify_style: values.unifyStyle,
          default_video_ratio: values.default_video_ratio || null,
        },
      })
      const updated = res.data
      if (!updated) throw new Error('empty project')
      const ui = toUIProject(updated)
      message.success('项目已更新')
      setEditModalOpen(false)
      setEditingProject(null)
      setProjects((prev) =>
        Array.isArray(prev) ? prev.map((x) => (x.id === ui.id ? ui : x)) : prev
      )
    } catch {
      message.error('更新失败')
    }
  }

  const handleDelete = async (projectId: string) => {
    try {
      await StudioProjectsService.deleteProjectApiV1StudioProjectsProjectIdDelete({ projectId })
      message.success('已删除')
      setProjects((prev) => (Array.isArray(prev) ? prev.filter((p) => p.id !== projectId) : []))
    } catch {
      message.error('删除失败')
    }
  }

  const renderStatusTag = (p: ProjectView) => {
    const status = getProjectStatus(p)
    if (status === 'completed') return <Tag color="green" className="mr-0 text-[11px] leading-4">已完成</Tag>
    if (status === 'draft') return <Tag color="default" className="mr-0 text-[11px] leading-4">草稿</Tag>
    return <Tag color="orange" className="mr-0 text-[11px] leading-4">进行中</Tag>
  }

  const handlePrimaryAction = (project: ProjectView, stageSummary?: ProjectStageSummary) => {
    if (!stageSummary) {
      navigate(`/projects/${project.id}`)
      return
    }
    if (stageSummary.key === 'create_first_chapter') {
      navigate(`/projects/${project.id}?tab=chapters&create=1`)
      return
    }
    if (!stageSummary.chapterId) {
      navigate(`/projects/${project.id}`)
      return
    }
    if (stageSummary.key === 'edit_raw') {
      navigate(`/projects/${project.id}?tab=chapters&edit=${stageSummary.chapterId}`)
      return
    }
    if (stageSummary.key === 'extract_shots') {
      navigate(getChapterShotsPath(project.id, stageSummary.chapterId))
      return
    }
    if (stageSummary.key === 'prepare_shots' || stageSummary.key === 'shoot') {
      // 有分镜之后不再从列表直接跳进分镜工作室：交给项目工作台，
      // 由 `resolveProjectStep` 判定当前应该落在哪一步（资产提取 / 图片准备 / …）。
      navigate(`/projects/${project.id}`)
      return
    }
    navigate(`/projects/${project.id}`)
  }

  /**
   * 根据项目 ID 生成稳定的浅色渐变背景，避免深色背景。
   */
  const getLightGradientByProjectId = (id: string): string => {
    const gradients = [
      'from-sky-100 via-sky-50 to-white',
      'from-emerald-100 via-emerald-50 to-white',
      'from-indigo-100 via-indigo-50 to-white',
      'from-amber-100 via-amber-50 to-white',
      'from-rose-100 via-rose-50 to-white',
      'from-violet-100 via-violet-50 to-white',
      'from-teal-100 via-teal-50 to-white',
    ]

    let hash = 0
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0
    }

    const index = hash % gradients.length
    return gradients[index]
  }

  const selectedProject = filteredSorted.find((p) => p.id === selectedProjectId) ?? filteredSorted[0]

  const renderCard = (p: ProjectView) => {
    const status = getProjectStatus(p)
    const stageSummary = projectStageMap[p.id]
    const flowStats = projectFlowStatsMap[p.id]
    const isCompact = viewMode === 'compact'
    const isLarge = viewMode === 'large'
    const mainActionLabel = stageSummary?.nextActionLabel ?? (status === 'completed' ? '继续剪辑' : p.progress > 0 ? '继续拍摄' : '进入项目')

    const isSelected = selectedProject && selectedProject.id === p.id
    const isChecked = selectedIds.includes(p.id)

    return (
      <Card
        key={p.id}
        hoverable
        loading={loading}
        size="small"
        className={`h-full cursor-pointer transition-all duration-200 ${
          isSelected ? 'ring-2 ring-indigo-500 ring-offset-1' : 'hover:shadow-lg'
        }`}
        bodyStyle={{ padding: '10px' }}
        onClick={() => {
          handleSelectProject(p.id)
          if (!multiSelectMode) {
            navigate(`/projects/${p.id}`)
          }
        }}
        onMouseEnter={() => handleSelectProject(p.id)}
      >
        <div
          className={`relative mb-1.5 rounded bg-gradient-to-r ${getLightGradientByProjectId(
            p.id,
          )} text-gray-900 p-2 overflow-hidden`}
        >
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <div className="text-xs text-gray-500 mb-0.5">{p.style}</div>
              <div className={`${isCompact ? 'text-sm' : 'text-base'} font-semibold truncate text-gray-900`}>
                {displayProjectName(p.name)}
              </div>
              <div className="text-[10px] text-gray-500 truncate">
                {formatProjectTime(p.createdAt)}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              {renderStatusTag(p)}
              {multiSelectMode && (
                <input
                  type="checkbox"
                  className="cursor-pointer"
                  checked={isChecked}
                  onChange={(e) => {
                    e.stopPropagation()
                    handleToggleSelect(p.id, e.target.checked)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>
          </div>
        </div>

        {!isCompact && (
          <p className={`text-gray-600 text-xs mb-1.5 ${isLarge ? 'line-clamp-2 min-h-[2rem]' : 'line-clamp-1 min-h-0'}`}>
            {p.description}
          </p>
        )}

        <div className={`mb-1.5 rounded border border-gray-100 bg-gray-50 ${isCompact ? 'px-2 py-1' : 'px-2 py-1.5'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-500">当前阶段</span>
            <Tag color={stageSummary?.stageColor ?? 'default'} className="mr-0 text-[11px] leading-4">
              {stageSummary?.stageText ?? '待推进'}
            </Tag>
          </div>
          <div className={`mt-1 text-[11px] text-gray-600 ${isLarge ? 'line-clamp-2 min-h-[2rem]' : 'line-clamp-1 min-h-0'}`}>
            {stageSummary?.nextActionHint ?? '进入项目工作台后继续推进主流程'}
          </div>
          {isCompact ? (
            <div className="mt-1 text-[11px] text-gray-500 truncate">
              下一步：{stageSummary?.nextActionLabel ?? '进入项目'}
            </div>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Tag bordered={false} color="gold" className="mr-0 text-[11px]">
                待确认 {flowStats?.pendingConfirmShots ?? 0}
              </Tag>
              <Tag bordered={false} color="green" className="mr-0 text-[11px]">
                已就绪 {flowStats?.readyShots ?? 0}
              </Tag>
              <Tag bordered={false} color="processing" className="mr-0 text-[11px]">
                生成中 {flowStats?.generatingShots ?? 0}
              </Tag>
            </div>
          )}
        </div>

        {!isCompact && (
          <div className="mb-1.5">
            <div className="flex justify-between text-[11px] mb-0.5 text-gray-500">
              <span>进度</span>
              <span>{p.progress}%</span>
            </div>
            <Progress
              percent={p.progress}
              size="small"
              showInfo={false}
              strokeColor={{ from: '#6366f1', to: '#a855f7' }}
            />
          </div>
        )}

        {isLarge ? (
          <Row gutter={6} className="mb-1.5">
            <Col span={6}>
              <Statistic title={<span className="text-[11px]">章节</span>} value={p.stats.chapters} valueStyle={{ fontSize: '13px' }} />
            </Col>
            <Col span={6}>
              <Statistic title={<span className="text-[11px]">角色</span>} value={p.stats.roles} valueStyle={{ fontSize: '13px' }} />
            </Col>
            <Col span={6}>
              <Statistic title={<span className="text-[11px]">场景</span>} value={p.stats.scenes} valueStyle={{ fontSize: '13px' }} />
            </Col>
            <Col span={6}>
              <Statistic title={<span className="text-[11px]">道具</span>} value={p.stats.props} valueStyle={{ fontSize: '13px' }} />
            </Col>
          </Row>
        ) : (
          <div className="mb-1.5 text-[11px] text-gray-500 truncate">
            章 {p.stats.chapters} · 角 {p.stats.roles} · 场 {p.stats.scenes} · 道 {p.stats.props}
          </div>
        )}

        <div className={`mt-1 border-t border-gray-100 flex items-center justify-between gap-1 ${isCompact ? 'pt-1' : 'pt-1.5'}`}>
          <span className="text-[11px] text-gray-500 truncate">{formatProjectTime(p.createdAt)}</span>
          <Space size="small" onClick={(e) => e.stopPropagation()}>
            <Button
              type="primary"
              size="small"
              icon={<EnterOutlined />}
              onClick={() => handlePrimaryAction(p, stageSummary)}
              className="text-[11px]"
            >
              {isCompact ? '进入' : mainActionLabel}
            </Button>
            {!isCompact && (
              <>
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => handleOpenEdit(e, p)}
                  className="text-[11px]"
                />
                <Popconfirm
                  title="确定删除该项目？"
                  description="删除后无法恢复，相关章节与素材将不再关联。"
                  onConfirm={() => handleDelete(p.id)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} className="text-[11px]" />
                </Popconfirm>
              </>
            )}
          </Space>
        </div>
      </Card>
    )
  }

  return (
    <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 space-y-2 pb-2">
      <div className="sticky top-0 z-10 pb-1.5 bg-gradient-to-b from-[rgba(249,250,251,0.96)] to-[rgba(249,250,251,0.9)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Space wrap size="small" className="flex-1 min-w-[240px]">
            <Input.Search
              placeholder="搜索项目名称或描述"
              allowClear
              size="small"
              className="w-64 max-w-full"
              onSearch={setSearch}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Space size="small" wrap>
              <Button
                type={filterTab === 'all' ? 'primary' : 'text'}
                size="small"
                className="text-[11px]"
                onClick={() => setFilterTab('all')}
              >
                全部
              </Button>
              <Button
                type={filterTab === 'editRaw' ? 'primary' : 'text'}
                size="small"
                className="text-[11px]"
                onClick={() => setFilterTab('editRaw')}
              >
                待补原文
              </Button>
              <Button
                type={filterTab === 'extractShots' ? 'primary' : 'text'}
                size="small"
                className="text-[11px]"
                onClick={() => setFilterTab('extractShots')}
              >
                待提取分镜
              </Button>
              <Button
                type={filterTab === 'prepareShots' ? 'primary' : 'text'}
                size="small"
                className="text-[11px]"
                onClick={() => setFilterTab('prepareShots')}
              >
                待准备镜头
              </Button>
              <Button
                type={filterTab === 'generating' ? 'primary' : 'text'}
                size="small"
                className="text-[11px]"
                onClick={() => setFilterTab('generating')}
              >
                生成中
              </Button>
              <Button
                type={filterTab === 'ready' ? 'primary' : 'text'}
                size="small"
                className="text-[11px]"
                onClick={() => setFilterTab('ready')}
              >
                可继续推进
              </Button>
            </Space>
          </Space>

            <Space size="small" wrap>
            <Space size="small">
              <span className="text-xs text-gray-500">排序</span>
              <Select
                size="small"
                value={sortKey}
                style={{ width: 128 }}
                onChange={(value: SortKey) => setSortKey(value)}
                options={SORT_SELECT_OPTIONS}
              />
              <Button
                size="small"
                type="text"
                className="text-[11px]"
                title="切换排序方向"
                onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              >
                {SORT_DIRECTION_LABELS[sortKey][sortOrder]}
              </Button>
            </Space>

            <Space size="small">
              <span className="text-xs text-gray-500">视图</span>
              <Button
                size="small"
                type={viewMode === 'grid' ? 'primary' : 'text'}
                icon={<AppstoreOutlined />}
                onClick={() => setViewMode('grid')}
              />
              <Button
                size="small"
                type={viewMode === 'compact' ? 'primary' : 'text'}
                icon={<BarsOutlined />}
                onClick={() => setViewMode('compact')}
              />
              <Button
                size="small"
                type={viewMode === 'large' ? 'primary' : 'text'}
                icon={<UnorderedListOutlined />}
                onClick={() => setViewMode('large')}
              />
            </Space>

            <Space size="small">
              <Button
                size="small"
                type={multiSelectMode ? 'primary' : 'text'}
                className="text-[11px]"
                onClick={() => {
                  setMultiSelectMode((prev) => !prev)
                  setSelectedIds([])
                }}
              >
                批量
              </Button>
              {multiSelectMode && (
                <Popconfirm
                  title="批量删除项目"
                  description="确定删除选中的所有项目？该操作不可恢复。"
                  onConfirm={handleBatchDelete}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  disabled={!selectedIds.length}
                >
                  <Button size="small" danger disabled={!selectedIds.length} className="text-[11px]">
                    删除选中
                  </Button>
                </Popconfirm>
              )}
            </Space>

            <Button type="primary" size="small" className="text-[11px]" icon={<PlusOutlined />} onClick={handleOpenCreate}>
              新建项目
            </Button>
          </Space>
        </div>
      </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
      <Row gutter={12}>
        <Col xs={24} lg={18}>
          <Row gutter={viewMode === 'compact' ? [8, 8] : viewMode === 'large' ? [14, 14] : [12, 12]}>
            {!loading && filteredSorted.length === 0 && (
              <Col span={24}>
                <Card>
                  <div className="text-center text-gray-500 py-8 text-sm">
                    {search ? '没有匹配的项目' : '暂无项目，点击「新建项目」开始'}
                  </div>
                </Card>
              </Col>
            )}
            {filteredSorted.map((p) => (
              <Col
                key={p.id}
                xs={24}
                sm={viewMode === 'compact' ? 12 : viewMode === 'grid' ? 12 : 24}
                md={viewMode === 'compact' ? 8 : viewMode === 'grid' ? 8 : 24}
                lg={viewMode === 'compact' ? 6 : viewMode === 'grid' ? 6 : 24}
                xl={viewMode === 'compact' ? 4 : viewMode === 'grid' ? 6 : 24}
              >
                {renderCard(p)}
              </Col>
            ))}
          </Row>
        </Col>

        <Col xs={24} lg={6} className="flex-shrink-0">
          <div className="h-full">
            <Card
              size="small"
              title="项目速览"
              className="mb-1.5"
              bodyStyle={{ padding: '10px' }}
              headStyle={{ minHeight: 36, paddingInline: 10 }}
            >
              {selectedProject ? (
                <div className="space-y-2">
                  <div>
                    <div className="text-[11px] text-gray-500 mb-0.5">项目名称</div>
                    <div className="font-medium">{displayProjectName(selectedProject.name)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500 mb-0.5">简介</div>
                    <div className="text-xs text-gray-600 line-clamp-2">
                      {selectedProject.description || '暂无描述'}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>视频风格：{selectedProject.style}</span>
                    <span>创建：{formatProjectTime(selectedProject.createdAt)}</span>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500 mb-0.5">进度</div>
                    <Progress
                      percent={selectedProject.progress}
                      size="small"
                      strokeColor={{ from: '#6366f1', to: '#22c55e' }}
                    />
                  </div>
                  <div className="text-[11px] text-gray-500">
                    章 {selectedProject.stats.chapters} · 角 {selectedProject.stats.roles} · 场 {selectedProject.stats.scenes} · 道 {selectedProject.stats.props}
                  </div>
                  <Button
                    type="primary"
                    block
                    size="small"
                    icon={<EnterOutlined />}
                    onClick={() => navigate(`/projects/${selectedProject.id}`)}
                    className="text-[11px]"
                  >
                    进入章节工作台
                  </Button>
                </div>
              ) : (
                <div className="text-gray-500 text-sm py-6 text-center">
                  将鼠标悬停在项目卡片上查看详情
                </div>
              )}
            </Card>
          </div>
        </Col>
      </Row>
      </div>

      <Modal
        title="新建短剧项目"
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        footer={null}
        width={520}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateSubmit}
          initialValues={{
            visual_style: projectStyleOptions.visualStyles[0]?.value ?? '现实',
            style:
              projectStyleOptions.defaultStyleByVisual?.[projectStyleOptions.visualStyles[0]?.value ?? '现实'] ??
              projectStyleOptions.stylesByVisual[projectStyleOptions.visualStyles[0]?.value ?? '现实']?.[0]?.value ??
              '真人都市',
            unifyStyle: true,
            default_video_ratio: defaultVideoRatio,
          }}
        >
          <Form.Item
            name="name"
            label="项目名称"
            rules={[{ required: true, message: '请输入项目名称' }]}
          >
            <Input placeholder="例如：现实都市爱情短剧" />
          </Form.Item>
          <Form.Item name="description" label="项目简介（选填）">
            <Input.TextArea rows={4} placeholder="项目简介与风格说明，建议 80–120 字" />
          </Form.Item>
          {/* 第一步：先选生产方式（两种起点最后汇入同一条生产流程） */}
          <Form.Item name="startMode" label="生产方式" rules={[{ required: true }]}>
            <Radio.Group className="w-full">
              <Space direction="vertical" size={4} className="w-full">
                {START_MODE_OPTIONS.map((option) => (
                  <Radio key={option.key} value={option.key}>
                    <span className="text-sm">{option.label}</span>
                    <span className="ml-2 text-[11px] text-gray-500">{option.description}</span>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>
          {/* 第二步：项目整体风格（预设直接写进既有列：视觉风格 + 视频风格 + 画幅） */}
          <Form.Item name="overallStyle" label="整体风格" rules={[{ required: true }]}>
            <Radio.Group
              className="w-full"
              onChange={(event) => {
                // 方案 B：选风格 = 把该风格的预设画幅**自动填进**下面的输入框（用户仍可手动改成别的）
                const key = event.target.value as OverallStyleKey
                const preset = resolveOverallStyleFields(key)
                if (preset?.default_video_ratio) {
                  form.setFieldValue('default_video_ratio', preset.default_video_ratio)
                }
              }}
            >
              <Space wrap size={6}>
                {OVERALL_STYLE_PRESETS.map((preset) => (
                  <Radio.Button key={preset.key} value={preset.key}>
                    {preset.label}
                  </Radio.Button>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {() =>
              form.getFieldValue('overallStyle') === 'custom' ? (
                <ProjectVisualStyleAndStyleFields form={form} options={projectStyleOptions} />
              ) : (
                <div className="mb-3 text-[11px] text-gray-500">
                  {OVERALL_STYLE_PRESETS.find((p) => p.key === form.getFieldValue('overallStyle'))?.description ??
                    '选择整体风格后，视觉风格、视频风格与默认画幅会一并写入项目配置。'}
                  （画幅会按风格自动带入，需要别的比例可以直接改；如需自己指定视觉风格 / 视频风格，请选「其他自定义」）
                </div>
              )
            }
          </Form.Item>
          {/*
            全局种子值暂时隐藏：目前没有任何生成路径消费项目级 seed
            （图片/视频请求里的 seed 都是单次请求字段，前端也从不传），
            留着只会让用户以为它能控制全片一致性。数据库字段保留兼容，不做迁移。
          */}
          <Form.Item
            name="default_video_ratio"
            label="默认视频比例"
            tooltip="可选预设，也可直接输入自定义比例（格式如 9:16）；留空则由系统默认画幅决定"
          >
            <AutoComplete
              allowClear
              placeholder="选择或输入比例，如 9:16"
              options={videoRatioOptions}
            />
          </Form.Item>
          <Form.Item
            name="unifyStyle"
            label="所有章节强制继承此风格"
            valuePropName="checked"
            tooltip="开启后所有章节继承项目风格"
          >
            <Switch />
          </Form.Item>
          <Form.Item className="mb-0">
            <Space>
              <Button onClick={() => setCreateModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit">
                创建并进入
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑项目"
        open={editModalOpen}
        onCancel={() => { setEditModalOpen(false); setEditingProject(null) }}
        footer={null}
        width={520}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={handleEditSubmit}
          initialValues={{ style: '真人都市', visual_style: '现实', unifyStyle: true }}
        >
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="项目名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="项目简介与风格说明" />
          </Form.Item>
          <ProjectVisualStyleAndStyleFields form={editForm} options={projectStyleOptions} />
          <Form.Item
            name="default_video_ratio"
            label="默认视频比例"
            tooltip="可选预设，也可直接输入自定义比例（格式如 9:16）；留空则由系统默认画幅决定"
          >
            <AutoComplete
              allowClear
              placeholder="选择或输入比例，如 9:16"
              options={videoRatioOptions}
            />
          </Form.Item>
          <Form.Item name="unifyStyle" label="风格统一" valuePropName="checked" tooltip="开启后所有章节继承项目风格">
            <Switch />
          </Form.Item>
          <Form.Item className="mb-0">
            <Space>
              <Button onClick={() => { setEditModalOpen(false); setEditingProject(null) }}>取消</Button>
              <Button type="primary" htmlType="submit">保存</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ProjectLobby
