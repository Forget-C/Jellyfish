import React, { useEffect, useMemo, useState } from 'react'
import {
  Card,
  Input,
  Button,
  Progress,
  Statistic,
  Row,
  Col,
  Modal,
  Form,
  Select,
  InputNumber,
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
import type { ChapterRead, ProjectRead, ProjectStyle } from '../../../services/generated'
import {
  ProjectVisualStyleAndStyleFields,
  type ProjectVisualStyleChoice,
} from './ProjectVisualStyleAndStyleFields'
import { useProjectStyleOptions } from './useProjectStyleOptions'

type ViewMode = 'grid' | 'compact' | 'large'
type FilterTab = 'all' | 'editRaw'
type SortKey = 'updatedAt' | 'name' | 'createdAt' | 'chapters'
type ChapterPreparationInput = { id: string; index: number; rawText?: string; sequenceCount?: number }
type ProjectStageSummary = {
  key: 'edit_raw' | 'sequences' | 'create_first_chapter'
  stageText: string
  stageColor: string
  nextActionLabel: string
  nextActionHint: string
  chapterId?: string
  sequenceCount?: number
}
type ProjectView = Project & {
  visualStyle?: ProjectVisualStyleChoice
  defaultVideoRatio?: string | null
}

const ProjectLobby: React.FC = () => {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectView | null>(null)
  const [projectStageMap, setProjectStageMap] = useState<Record<string, ProjectStageSummary>>({})
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

    const updatedAt =
      (typeof stats.updated_at === 'string' && stats.updated_at) ||
      (typeof stats.updatedAt === 'string' && stats.updatedAt) ||
      new Date().toISOString()

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
        const res = await StudioProjectsService.listProjectsApiV1StudioProjectsGet({
          page: 1,
          pageSize: 10,
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
      const chapter = chaptersByIndex.find(chapter => !chapter.rawText?.trim()) || chaptersByIndex[0]
      const missingRaw = !chapter.rawText?.trim()
      return {
        key: missingRaw ? 'edit_raw' : 'sequences',
        stageText: missingRaw ? '待补原文' : '场次创作',
        stageColor: missingRaw ? 'default' : 'blue',
        nextActionLabel: missingRaw ? '编辑原文' : '进入场次',
        nextActionHint: `第${chapter.index}章 · 原文划场、设计、试拍与剪辑`,
        chapterId: chapter.id,
        sequenceCount: chapter.sequenceCount,
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
                  sequenceCount: chapter.sequenceCount,
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
                  sequenceCount: chapter.sequence_count ?? 0,
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
                sequenceCount: chapter.sequence_count ?? 0,
                status: chapter.status ?? 'draft',
                updatedAt: new Date().toISOString(),
              })),
            ] as const
          }),
        )
        setProjectStageMap(
          Object.fromEntries(chapterResponses.map(([projectId, summary]) => [projectId, summary])),
        )

      } catch {
        setProjectStageMap({})
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
      if (filterTab === 'editRaw') return stage?.key === 'edit_raw' || stage?.key === 'create_first_chapter'
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
        av = a.id
        bv = b.id
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
  }, [projects, search, filterTab, sortKey, sortOrder, projectStageMap])

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
      seed: Math.floor(Math.random() * 99999),
      unifyStyle: true,
      default_video_ratio: defaultVideoRatio,
    })
    setCreateModalOpen(true)
  }

  const handleCreateSubmit = async (values: {
    name: string
    description?: string
    style: string
    visual_style: ProjectVisualStyleChoice
    seed: number
    unifyStyle: boolean
    default_video_ratio?: string
  }) => {
    try {
      const createdId = newProjectId()
      const res = await StudioProjectsService.createProjectApiV1StudioProjectsPost({
        requestBody: {
          id: createdId,
          name: values.name,
          description: values.description ?? '',
          style: values.style as ProjectStyle,
          visual_style: values.visual_style as any,
          seed: values.seed,
          unify_style: values.unifyStyle,
          default_video_ratio: values.default_video_ratio || null,
          progress: 0,
        },
      })
      const created = res.data
      if (!created) throw new Error('empty project')
      const ui = toUIProject(created)
      message.success('项目创建成功')
      setCreateModalOpen(false)
      setProjects((prev) => (Array.isArray(prev) ? [...prev, ui] : [ui]))
      navigate(`/projects/${ui.id}`)
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
      seed: p.seed,
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
    seed: number
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
          style: values.style as ProjectStyle,
          visual_style: values.visual_style as any,
          seed: values.seed,
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
    if (status === 'completed') return <Tag color="green" className="mr-0 text-xs leading-4">已完成</Tag>
    if (status === 'draft') return <Tag color="default" className="mr-0 text-xs leading-4">草稿</Tag>
    return <Tag color="orange" className="mr-0 text-xs leading-4">进行中</Tag>
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
    navigate(`/projects/${project.id}/chapters/${stageSummary.chapterId}/sequences`)
  }

  const selectedProject = filteredSorted.find((p) => p.id === selectedProjectId) ?? filteredSorted[0]

  const renderCard = (p: ProjectView) => {
    const status = getProjectStatus(p)
    const stageSummary = projectStageMap[p.id]
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
          isSelected ? 'ring-1 ring-blue-500' : 'hover:border-blue-300'
        }`}
        bodyStyle={{ padding: 16 }}
        onClick={() => {
          handleSelectProject(p.id)
          if (!multiSelectMode) {
            navigate(`/projects/${p.id}`)
          }
        }}
        onMouseEnter={() => handleSelectProject(p.id)}
        onFocusCapture={() => handleSelectProject(p.id)}
      >
        <div
          className="relative mb-1.5 rounded bg-blue-50 text-gray-900 p-2 overflow-hidden"
        >
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <div className="text-xs text-gray-500 mb-0.5">{p.style}</div>
              <div className={`${isCompact ? 'text-sm' : 'text-base'} font-semibold truncate text-gray-900`}>
                {p.name}
              </div>
              <div className="text-xs text-gray-500 truncate">
                {p.updatedAt}
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
            <span className="text-xs text-gray-500">当前阶段</span>
            <Tag color={stageSummary?.stageColor ?? 'default'} className="mr-0 text-xs leading-4">
              {stageSummary?.stageText ?? '待推进'}
            </Tag>
          </div>
          <div className={`mt-1 text-xs text-gray-600 ${isLarge ? 'line-clamp-2 min-h-[2rem]' : 'line-clamp-1 min-h-0'}`}>
            {stageSummary?.nextActionHint ?? '进入项目工作台后继续推进主流程'}
          </div>
          <div className="mt-1 text-xs text-gray-500 truncate">
            下一步：{stageSummary?.nextActionLabel ?? '进入项目'}
          </div>
        </div>

        {!isCompact && (
          <div className="mb-1.5">
            <div className="flex justify-between text-xs mb-0.5 text-gray-500">
              <span>进度</span>
              <span>{p.progress}%</span>
            </div>
            <Progress
              percent={p.progress}
              size="small"
              showInfo={false}
              strokeColor="#1677ff"
            />
          </div>
        )}

        {isLarge ? (
          <Row gutter={6} className="mb-1.5">
            <Col span={6}>
              <Statistic title={<span className="text-xs">章节</span>} value={p.stats.chapters} valueStyle={{ fontSize: '13px' }} />
            </Col>
            <Col span={6}>
              <Statistic title={<span className="text-xs">角色</span>} value={p.stats.roles} valueStyle={{ fontSize: '13px' }} />
            </Col>
            <Col span={6}>
              <Statistic title={<span className="text-xs">场景</span>} value={p.stats.scenes} valueStyle={{ fontSize: '13px' }} />
            </Col>
            <Col span={6}>
              <Statistic title={<span className="text-xs">道具</span>} value={p.stats.props} valueStyle={{ fontSize: '13px' }} />
            </Col>
          </Row>
        ) : (
          <div className="mb-1.5 text-xs text-gray-500 truncate">
            章 {p.stats.chapters} · 角 {p.stats.roles} · 场 {p.stats.scenes} · 道 {p.stats.props}
          </div>
        )}

        <div className={`mt-1 border-t border-gray-100 flex items-center justify-between gap-1 ${isCompact ? 'pt-1' : 'pt-1.5'}`}>
          <span className="text-xs text-gray-500 truncate">{p.updatedAt}</span>
          <Space size="small" onClick={(e) => e.stopPropagation()}>
            <Button
              type="primary"
              size="small"
              icon={<EnterOutlined />}
              onClick={() => handlePrimaryAction(p, stageSummary)}
              className="text-xs"
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
                  className="text-xs"
                />
                <Popconfirm
                  title="确定删除该项目？"
                  description="删除后无法恢复，相关章节与素材将不再关联。"
                  onConfirm={() => handleDelete(p.id)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} className="text-xs" />
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
      <div className="flex-shrink-0">
      <div className="app-page-toolbar project-lobby-toolbar">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Space wrap size="middle" className="flex-1 min-w-[240px]">
            <Input.Search
              placeholder="搜索项目名称或描述"
              allowClear
              size="middle"
              className="w-64 max-w-full"
              onSearch={setSearch}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Space size="middle" wrap>
              <Button
                type={filterTab === 'all' ? 'primary' : 'text'}
                size="middle"
                className="text-xs"
                onClick={() => setFilterTab('all')}
              >
                全部
              </Button>
              <Button
                type={filterTab === 'editRaw' ? 'primary' : 'text'}
                size="middle"
                className="text-xs"
                onClick={() => setFilterTab('editRaw')}
              >
                待补原文
              </Button>
            </Space>
          </Space>

            <Space size="middle" wrap>
            <Space size="middle">
              <span className="text-xs text-gray-500">排序</span>
              <Select
                size="middle"
                value={sortKey}
                style={{ width: 128 }}
                onChange={(value: SortKey) => setSortKey(value)}
                options={[
                  { label: '最近更新', value: 'updatedAt' },
                  { label: '名称 A-Z', value: 'name' },
                  { label: '章节数量', value: 'chapters' },
                ]}
              />
              <Button
                size="middle"
                type="text"
                className="text-xs"
                onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </Button>
            </Space>

            <Space size="middle">
              <span className="text-xs text-gray-500">视图</span>
              <Button
                size="middle"
                type={viewMode === 'grid' ? 'primary' : 'text'}
                icon={<AppstoreOutlined />}
                onClick={() => setViewMode('grid')}
              />
              <Button
                size="middle"
                type={viewMode === 'compact' ? 'primary' : 'text'}
                icon={<BarsOutlined />}
                onClick={() => setViewMode('compact')}
              />
              <Button
                size="middle"
                type={viewMode === 'large' ? 'primary' : 'text'}
                icon={<UnorderedListOutlined />}
                onClick={() => setViewMode('large')}
              />
            </Space>

            <Space size="middle">
              <Button
                size="middle"
                type={multiSelectMode ? 'primary' : 'text'}
                className="text-xs"
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
                  <Button size="middle" danger disabled={!selectedIds.length} className="text-xs">
                    删除选中
                  </Button>
                </Popconfirm>
              )}
            </Space>

            <Button type="primary" size="middle" className="text-xs" icon={<PlusOutlined />} onClick={handleOpenCreate}>
              新建项目
            </Button>
          </Space>
        </div>
      </div>
      </div>

      <div className="app-page-content min-h-0 flex-1 overflow-auto">
      <div className="project-lobby-panels">
        <div className="min-w-0">
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
        </div>

        <aside className="project-lobby-inspector">
          <div className="h-full">
            <Card
              size="small"
              title="项目速览"
              className="mb-1.5"
              bodyStyle={{ padding: 16 }}
              headStyle={{ minHeight: 48, paddingInline: 16 }}
            >
              {selectedProject ? (
                <div className="space-y-2">
                  <div>
                    <div className="text-xs text-gray-500 mb-0.5">项目名称</div>
                    <div className="font-medium">{selectedProject.name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-0.5">简介</div>
                    <div className="text-xs text-gray-600 line-clamp-2">
                      {selectedProject.description || '暂无描述'}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>视频风格：{selectedProject.style}</span>
                    <span>种子：{selectedProject.seed}</span>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-0.5">进度</div>
                    <Progress
                      percent={selectedProject.progress}
                      size="small"
                      strokeColor="#1677ff"
                    />
                  </div>
                  <div className="text-xs text-gray-500">
                    章 {selectedProject.stats.chapters} · 角 {selectedProject.stats.roles} · 场 {selectedProject.stats.scenes} · 道 {selectedProject.stats.props}
                  </div>
                  <Button
                    type="primary"
                    block
                    size="small"
                    icon={<EnterOutlined />}
                    onClick={() => navigate(`/projects/${selectedProject.id}`)}
                    className="text-xs"
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
        </aside>
      </div>
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
            seed: Math.floor(Math.random() * 99999),
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
          <ProjectVisualStyleAndStyleFields form={form} options={projectStyleOptions} />
          <Form.Item
            name="seed"
            label="全局种子值"
            tooltip="固定种子可确保整部短剧视觉调性一致"
          >
            <InputNumber min={0} className="w-full" />
          </Form.Item>
          <Form.Item name="default_video_ratio" label="默认视频比例">
            <Select allowClear placeholder="未设置时由模型/供应商决定" options={videoRatioOptions} />
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
          <Form.Item name="seed" label="全局种子值" tooltip="固定种子可确保整部短剧视觉调性一致">
            <InputNumber min={0} className="w-full" />
          </Form.Item>
          <Form.Item name="default_video_ratio" label="默认视频比例">
            <Select allowClear placeholder="未设置时由模型/供应商决定" options={videoRatioOptions} />
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
