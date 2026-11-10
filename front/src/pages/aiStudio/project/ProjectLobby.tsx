import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Button, Checkbox, Dropdown, Empty, Form, Input, InputNumber,
  Modal, Popconfirm, Select, Space, Spin, Switch, Tag, message,
} from 'antd'
import type { MenuProps } from 'antd'
import { ArrowRightOutlined, MoreOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components/layout/PageLayout'
import { chapters as mockChapters, projects as mockProjects, type Project } from '../../../mocks/data'
import { StudioChaptersService, StudioProjectsService } from '../../../services/generated'
import type { ProjectRead, ProjectStyle, ProjectVisualStyle } from '../../../services/generated'
import { chapterLocation } from '../directing/chapterNavigation'
import { summarizeProjectChapters, type ProjectStageSummary } from './projectStageSummary'
import {
  ProjectVisualStyleAndStyleFields,
  type ProjectVisualStyleChoice,
} from './ProjectVisualStyleAndStyleFields'
import { useProjectStyleOptions } from './useProjectStyleOptions'

import './project-lobby.css'

type ViewMode = 'grid' | 'compact' | 'large'
type FilterTab = 'all' | 'editRaw'
type SortKey = 'updatedAt' | 'name' | 'chapters'
const desktopToolbar = '(min-width: 1024px)'
type ProjectView = Omit<Project, 'stats'> & {
  stats: Partial<Project['stats']>
  visualStyle?: ProjectVisualStyleChoice
  defaultVideoRatio?: string | null
}

const sortOptions: { key: SortKey; label: string }[] = [
  { key: 'updatedAt', label: '最近更新' },
  { key: 'name', label: '名称' },
  { key: 'chapters', label: '章节数量' },
]
const viewOptions: { key: ViewMode; label: string }[] = [
  { key: 'grid', label: '卡片视图' },
  { key: 'compact', label: '紧凑视图' },
  { key: 'large', label: '大卡视图' },
]

const toUIProject = (p: ProjectRead): ProjectView => {
  const stats = (p.stats ?? {}) as Record<string, unknown>
  const getNum = (key: string) => {
    const v = stats[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  }

  const updatedAt =
    (typeof stats.updated_at === 'string' && stats.updated_at) ||
    (typeof stats.updatedAt === 'string' && stats.updatedAt) ||
    ''

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

function ProjectLobby() {
  const navigate = useNavigate()
  const [wideToolbar, setWideToolbar] = useState(() => window.matchMedia(desktopToolbar).matches)
  useEffect(() => {
    const media = window.matchMedia(desktopToolbar)
    const update = () => setWideToolbar(media.matches)
    media.addEventListener('change', update)
    update()
    return () => media.removeEventListener('change', update)
  }, [])
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const loadRevision = useRef(0)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectView | null>(null)
  const [projectStageMap, setProjectStageMap] = useState<Record<string, ProjectStageSummary | 'error'>>({})
  const {
    options: projectStyleOptions,
    videoRatioOptions,
    defaultVideoRatio,
  } = useProjectStyleOptions()
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()

  const useMock = import.meta.env.VITE_USE_MOCK === 'true'
  const newestFirst = sortKey !== 'updatedAt' || sortOrder === 'desc'

  const newProjectId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }

  const load = useCallback(async () => {
    const revision = ++loadRevision.current
    setLoading(true)
    setLoadError(false)
    try {
      if (useMock) {
        setProjects(mockProjects)
      } else {
        const res = await StudioProjectsService.listProjectsApiV1StudioProjectsGet({
          page: 1,
          pageSize: 10,
          order: 'updated_at',
          isDesc: newestFirst,
        })
        if (!res.data?.items) throw new Error('项目列表不可用')
        if (revision === loadRevision.current) setProjects(res.data.items.map(toUIProject))
      }
    } catch {
      if (revision === loadRevision.current) setLoadError(true)
    } finally {
      if (revision === loadRevision.current) setLoading(false)
    }
  }, [newestFirst, useMock])

  useEffect(() => {
    void load()
    return () => { loadRevision.current += 1 }
  }, [load])

  const readProjectStage = useCallback(async (projectId: string): Promise<ProjectStageSummary | 'error'> => {
    try {
      if (useMock) {
        const chapters = mockChapters.filter(chapter => chapter.projectId === projectId).map(chapter => ({
          id: chapter.id, index: chapter.index, title: chapter.title,
          raw_text: chapter.summary ?? '', sequence_count: chapter.sequenceCount,
        }))
        return summarizeProjectChapters(projectId, chapters)
      }
      const response = await StudioChaptersService.listChaptersApiV1StudioChaptersGet({
        projectId, page: 1, pageSize: 100,
      })
      if (!response.data?.items) return 'error'
      return summarizeProjectChapters(projectId, response.data.items.filter(chapter => chapter.project_id === projectId))
    } catch {
      return 'error'
    }
  }, [useMock])

  useEffect(() => {
    let active = true
    projects.forEach(project => {
      void readProjectStage(project.id).then(summary => {
        if (active) setProjectStageMap(previous => ({ ...previous, [project.id]: summary }))
      })
    })
    return () => { active = false }
  }, [projects, readProjectStage])

  const retryProjectStage = async (projectId: string) => {
    setProjectStageMap(previous => {
      const next = { ...previous }
      delete next[projectId]
      return next
    })
    const summary = await readProjectStage(projectId)
    setProjectStageMap(previous => ({ ...previous, [projectId]: summary }))
  }

  const filteredSorted = useMemo(() => {
    const list = Array.isArray(projects) ? projects : []
    const keyword = search.trim().toLowerCase()

    const next = list.filter((p) => {
      if (keyword) {
        const inText =
          p.name.toLowerCase().includes(keyword) ||
          p.description.toLowerCase().includes(keyword)
        if (!inText) return false
      }

      if (filterTab === 'all') return true
      const stage = projectStageMap[p.id]
      return stage !== 'error' && (stage?.key === 'edit_raw' || stage?.key === 'create_first_chapter')
    })

    // 更新时间不一定出现在列表 DTO 中，真实项目按服务端返回的顺序显示。
    if (sortKey === 'updatedAt' && !useMock) return next
    next.sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      if (sortKey === 'name') {
        av = a.name
        bv = b.name
      } else if (sortKey === 'chapters') {
        if (a.stats.chapters === undefined || b.stats.chapters === undefined) {
          return Number(b.stats.chapters !== undefined) - Number(a.stats.chapters !== undefined)
        }
        av = a.stats.chapters
        bv = b.stats.chapters
      } else {
        // 没有更新时间的项目始终排在已知更新时间之后。
        if (!a.updatedAt || !b.updatedAt) return Number(Boolean(b.updatedAt)) - Number(Boolean(a.updatedAt))
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
  }, [projects, search, filterTab, sortKey, sortOrder, projectStageMap, useMock])

  const handleToggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)
    )
  }

  const handleBatchDelete = async () => {
    if (!selectedIds.length || batchDeleting) return
    setBatchDeleting(true)
    try {
      const results = await Promise.allSettled(selectedIds.map(projectId =>
        StudioProjectsService.deleteProjectApiV1StudioProjectsProjectIdDelete({ projectId }),
      ))
      const deleted = new Set(selectedIds.filter((_, index) => results[index].status === 'fulfilled'))
      setProjects(previous => previous.filter(project => !deleted.has(project.id)))
      setSelectedIds(previous => previous.filter(id => !deleted.has(id)))
      if (deleted.size === selectedIds.length) message.success('已批量删除选中项目')
      else message.error(deleted.size ? `已删除 ${deleted.size} 个项目，其余项目删除失败` : '批量删除失败')
    } finally {
      setBatchDeleting(false)
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
          visual_style: values.visual_style as ProjectVisualStyle,
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

  const handleOpenEdit = (p: ProjectView) => {
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
          visual_style: values.visual_style as ProjectVisualStyle,
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
      if (sortKey === 'updatedAt' && !useMock) void load()
    } catch {
      message.error('更新失败')
    }
  }

  const handleDelete = async (projectId: string) => {
    try {
      await StudioProjectsService.deleteProjectApiV1StudioProjectsProjectIdDelete({ projectId })
      message.success('已删除')
      setDetailProjectId(null)
      setProjects((prev) => (Array.isArray(prev) ? prev.filter((p) => p.id !== projectId) : []))
    } catch {
      message.error('删除失败')
    }
  }

  const detailProject = projects.find(project => project.id === detailProjectId)
  const detailStage = detailProject ? projectStageMap[detailProject.id] : undefined
  const filterLoading = filterTab !== 'all' && projects.some(project => !projectStageMap[project.id])
  const filterIncomplete = filterTab !== 'all' && projects.some(project => projectStageMap[project.id] === 'error')
  const optionsMenu: MenuProps = {
    selectable: true,
    multiple: true,
    selectedKeys: [sortKey, sortOrder, viewMode],
    items: [
      { key: 'sorting', type: 'group', label: '排序', children: sortOptions.map(option => ({
        ...option, onClick: () => setSortKey(option.key),
      })) },
      { key: 'direction', type: 'group', label: '排序方向', children: [
        { key: 'asc', label: '升序', onClick: () => setSortOrder('asc') },
        { key: 'desc', label: '降序', onClick: () => setSortOrder('desc') },
      ] },
      { key: 'views', type: 'group', label: '视图', children: viewOptions.map(option => ({
        ...option, onClick: () => setViewMode(option.key),
      })) },
      { type: 'divider' },
      { key: 'batch', label: '批量管理', disabled: multiSelectMode, onClick: () => setMultiSelectMode(true) },
    ],
  }

  const controls = (
    <div key="controls" className="project-lobby-controls">
      <Input
        aria-label="搜索项目"
        placeholder="搜索项目名称或描述"
        prefix={<SearchOutlined />}
        allowClear
        value={search}
        onChange={event => setSearch(event.target.value)}
      />
      <Select
        aria-label="制作阶段筛选"
        popupClassName="project-lobby-options"
        virtual={false}
        value={filterTab}
        options={[{ value: 'all', label: '全部状态' }, { value: 'editRaw', label: '待补原文' }]}
        onChange={setFilterTab}
      />
      <Dropdown menu={optionsMenu} overlayClassName="project-lobby-options" trigger={['click']} autoFocus>
        <Button icon={<MoreOutlined />}>显示与管理</Button>
      </Dropdown>
    </div>
  )
  const createProject = (
    <Button key="create" className="project-lobby-create" type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>新建项目</Button>
  )

  return (
    <WorkspaceLayout className="project-lobby">
      <PageToolbar>
        <div className="project-lobby-heading">
          <h1 className="app-page-title">项目</h1>
          <span className="project-lobby-count" role="status">
            {!loading && !loadError && !filterLoading && !filterIncomplete && `显示 ${filteredSorted.length} 个`}
          </span>
          {useMock && <span className="project-lobby-count">模拟环境</span>}
        </div>
        {wideToolbar ? [controls, createProject] : [createProject, controls]}
      </PageToolbar>
      <WorkspaceScrollPanel className="project-lobby-scroll">
        {multiSelectMode && (
          <div className="project-lobby-batch">
            <span aria-live="polite">已选 {selectedIds.length} 个项目</span>
            <Popconfirm
              title="批量删除项目"
              description="确定删除选中的所有项目？该操作不可恢复。"
              onConfirm={handleBatchDelete}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              disabled={!selectedIds.length || batchDeleting}
            >
              <Button danger disabled={!selectedIds.length} loading={batchDeleting}>删除选中</Button>
            </Popconfirm>
            <Button disabled={batchDeleting} onClick={() => { setMultiSelectMode(false); setSelectedIds([]) }}>退出批量管理</Button>
          </div>
        )}
        {loadError && <Alert showIcon type="error" message="无法读取项目列表" action={<Button onClick={() => void load()}>重试</Button>} />}
        {filterIncomplete && (
          <Alert showIcon type="warning" message="部分项目的章节状态读取失败，未纳入此筛选" action={
            <Button onClick={() => projects.forEach(project => {
              if (projectStageMap[project.id] === 'error') void retryProjectStage(project.id)
            })}>重试</Button>
          } />
        )}
        {filterLoading && <p role="status">正在读取项目章节状态…</p>}
        {loading ? <Spin /> : (
          <>
            {!loadError && !filterLoading && !filterIncomplete && !filteredSorted.length && (
              <Empty description={search || filterTab !== 'all' ? '没有匹配的项目' : '暂无项目，点击「新建项目」开始'} />
            )}
            <div className={`project-lobby-grid project-lobby-grid--${viewMode}`}>
              {filteredSorted.map(project => {
                const summary = projectStageMap[project.id]
                const stage = summary === 'error' ? undefined : summary
                return (
                  <article className="project-lobby-card" key={project.id}>
                    <header className="project-lobby-card-heading">
                      <div>
                        <p>{project.style}</p>
                        <h2>{multiSelectMode ? project.name : <Link to={`/projects/${encodeURIComponent(project.id)}`}>{project.name}</Link>}</h2>
                      </div>
                      {multiSelectMode ? (
                        <Checkbox
                          aria-label={`选择 ${project.name}`}
                          checked={selectedIds.includes(project.id)}
                          disabled={batchDeleting}
                          onChange={event => handleToggleSelect(project.id, event.target.checked)}
                        />
                      ) : <Button type="text" onClick={() => setDetailProjectId(project.id)}>详情</Button>}
                    </header>
                    {viewMode === 'large' && project.description && <p className="project-lobby-description">{project.description}</p>}
                    <div className="project-lobby-stage">
                      {stage?.chapterLabel && <p>{stage.chapterLabel}</p>}
                      <Tag bordered={false} className="project-lobby-status" data-tone={stage?.tone}>
                        {stage?.status ?? (summary === 'error' ? '章节状态读取失败' : '正在读取章节状态')}
                      </Tag>
                    </div>
                    {stage && !multiSelectMode && (
                      <Link className="project-lobby-next" to={stage.href}>{stage.action}<ArrowRightOutlined aria-hidden /></Link>
                    )}
                    <footer className="project-lobby-meta">
                      {project.stats.chapters !== undefined && <span>{project.stats.chapters} 章</span>}
                      {project.updatedAt && <span>更新于 {project.updatedAt}</span>}
                    </footer>
                  </article>
                )
              })}
            </div>
          </>
        )}
      </WorkspaceScrollPanel>
      <Modal
        title={detailProject ? `${detailProject.name} · 详情` : '项目详情'}
        open={Boolean(detailProject)}
        onCancel={() => setDetailProjectId(null)}
        footer={null}
        width={440}
      >
        {detailProject && (
          <div className="project-lobby-detail">
            <section>
              <h2>制作提示</h2>
              {detailStage === 'error' ? (
                <Alert showIcon type="error" message="章节状态读取失败" action={
                  <Button onClick={() => void retryProjectStage(detailProject.id)}>重试</Button>
                } />
              ) : detailStage ? (
                <>
                  {detailStage.chapterLabel && <p>{detailStage.chapterLabel}</p>}
                  <Tag bordered={false} className="project-lobby-status" data-tone={detailStage.tone}>{detailStage.status}</Tag>
                </>
              ) : <Spin />}
              <div className="project-lobby-detail-actions">
                <Link to={chapterLocation(detailProject.id)}>查看章节列表</Link>
              </div>
            </section>
            <section>
              <h2>项目资料</h2>
              {detailProject.description && <p>{detailProject.description}</p>}
              <p>角色 {detailProject.stats.roles ?? '—'} · 场景 {detailProject.stats.scenes ?? '—'} · 道具 {detailProject.stats.props ?? '—'}</p>
            </section>
            <section>
              <h2>项目操作</h2>
              <Space wrap>
                <Button onClick={() => handleOpenEdit(detailProject)}>编辑项目</Button>
                <Popconfirm
                  title="确定删除该项目？"
                  description="删除后无法恢复，相关章节与素材将不再关联。"
                  onConfirm={() => handleDelete(detailProject.id)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button danger>删除项目</Button>
                </Popconfirm>
              </Space>
            </section>
          </div>
        )}
      </Modal>

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
    </WorkspaceLayout>
  )
}

export default ProjectLobby
