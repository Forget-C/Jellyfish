import { buildFileDownloadUrl } from '../assets/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Button, Checkbox, Dropdown, Empty, Form, Input, InputNumber,
  Modal, Popconfirm, Select, Space, Spin, Switch, Tag, message,
} from 'antd'
import type { MenuProps } from 'antd'
import {
  ArrowRightOutlined, BookOutlined, DeleteOutlined, FileTextOutlined, MoreOutlined,
  PlusOutlined, SearchOutlined, VideoCameraOutlined,
} from '@ant-design/icons'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components/layout/PageLayout'
import { StudioChaptersService, StudioProjectsService } from '../../../services/generated'
import type { ProjectRead, ProjectStyle, ProjectVisualStyle } from '../../../services/generated'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { ProjectCover } from './ProjectCover'
import { summarizeProjectChapters, type ProjectStageSummary } from './projectStageSummary'
import {
  ProjectVisualStyleAndStyleFields,
  type ProjectVisualStyleChoice,
} from './ProjectVisualStyleAndStyleFields'
import { useCardPageSize } from '../../../components/layout/useCardPageSize'
import { CardListPagination } from '../../../components/layout/CardListPagination'
import { useProjectStyleOptions } from './useProjectStyleOptions'

import './project-lobby.css'

type FilterTab = 'all' | 'editRaw'
type SortKey = 'updatedAt' | 'name' | 'chapters'
const projectOrder = { updatedAt: 'updated_at', name: 'name', chapters: 'chapter_count' } as const
const desktopToolbar = '(min-width: 1024px)'
type ProjectView = Pick<ProjectRead, 'id' | 'name' | 'cover_file_id'> & {
  style?: string
  updatedAt: string
}
type ProjectCardStage = ProjectStageSummary & { chapterCount?: number }
type ProjectStageState = ProjectCardStage | 'error' | 'retrying'

const sortOptions: { key: SortKey; label: string }[] = [
  { key: 'updatedAt', label: '最近更新' },
  { key: 'name', label: '名称' },
  { key: 'chapters', label: '章节数量' },
]
const toUIProject = (p: ProjectRead): ProjectView => {
  const stats = (p.stats ?? {}) as Record<string, unknown>
  const updatedAt =
    (typeof stats.updated_at === 'string' && stats.updated_at) ||
    (typeof stats.updatedAt === 'string' && stats.updatedAt) ||
    ''

  return {
    id: p.id,
    name: p.name,
    cover_file_id: p.cover_file_id,
    style: p.style?.trim() || undefined,
    updatedAt,
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
  const [query, setQuery] = useSearchParams()
  const queryRef = useRef(query)
  queryRef.current = query
  const { pathname } = useLocation()
  const [total, setTotal] = useState(0)
  const [reload, setReload] = useState(0)
  const { panel, measureGrid, measureCard, pageSize } = useCardPageSize()
  const search = query.get('q') ?? ''
  const keyword = search.trim()
  const filterTab: FilterTab = query.get('stage') === 'edit_raw' ? 'editRaw' : 'all'
  const order = query.get('sort')
  const sortKey: SortKey = order === 'name' || order === 'chapters' ? order : 'updatedAt'
  const sortOrder = query.get('direction') === 'asc' ? 'asc' : 'desc'
  const offset = Number(query.get('offset'))
  const page = pageSize && Number.isSafeInteger(offset) && offset > 0
    ? Math.floor(offset / pageSize) + 1 : 1
  const [deleteTarget, setDeleteTarget] = useState<Pick<ProjectView, 'id' | 'name'> | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deletePending = useRef(false)
  const deleteTrigger = useRef<HTMLElement | null>(null)
  const createButton = useRef<HTMLButtonElement>(null)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [projectStageMap, setProjectStageMap] = useState<Partial<Record<string, ProjectStageState>>>({})
  const {
    options: projectStyleOptions,
    videoRatioOptions,
    defaultVideoRatio,
  } = useProjectStyleOptions()
  const [form] = Form.useForm()

  const useMock = import.meta.env.VITE_USE_MOCK === 'true'

  const newProjectId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }

  const changeQuery = (key: string, value: string) => {
    setSelectedIds([])
    setQuery(previous => {
      const next = new URLSearchParams(previous)
      if (value) next.set(key, value)
      else next.delete(key)
      next.delete('offset')
      return next
    }, { replace: true })
  }

  const setPage = useCallback((nextPage: number) => {
    const next = new URLSearchParams(queryRef.current)
    if (nextPage > 1) next.set('offset', String((nextPage - 1) * pageSize))
    else next.delete('offset')
    navigate({ pathname, search: next.toString() }, { replace: true })
  }, [navigate, pageSize, pathname])

  const load = useCallback(async () => {
    if (!pageSize) return
    const revision = ++loadRevision.current
    setLoading(true)
    setLoadError(false)
    try {
      const res = await StudioProjectsService.listProjectsApiV1StudioProjectsGet({
        q: keyword || undefined,
        stage: filterTab === 'editRaw' ? 'edit_raw' : undefined,
        page,
        pageSize,
        order: projectOrder[sortKey],
        isDesc: sortOrder === 'desc',
      })
      if (revision !== loadRevision.current) return
      if (!res.data?.items) throw new Error('项目列表不可用')
      const count = res.data.pagination.total
      const lastPage = Math.max(1, Math.ceil(count / pageSize))
      if (page > lastPage) {
        setPage(lastPage)
        return
      }
      const visible = new Set(res.data.items.map(project => project.id))
      setProjects(res.data.items.map(toUIProject))
      setSelectedIds(previous => previous.filter(id => visible.has(id)))
      setTotal(count)
      setLoading(false)
    } catch {
      if (revision === loadRevision.current) {
        setLoadError(true)
        setLoading(false)
      }
    }
  }, [filterTab, keyword, page, pageSize, setPage, sortKey, sortOrder])

  useEffect(() => {
    void load()
    return () => { loadRevision.current += 1 }
  }, [load, reload])

  // Store the new page's first position so a later resize starts from this page.
  useEffect(() => {
    if (!pageSize || !Number.isSafeInteger(offset) || offset < 0) return
    const first = (page - 1) * pageSize
    if (first !== offset) setPage(page)
  }, [offset, page, pageSize, setPage])

  const readProjectStage = useCallback(async (
    projectId: string, isCurrent: () => boolean = () => true,
  ): Promise<ProjectCardStage | 'error'> => {
    try {
      const response = await StudioChaptersService.listChaptersApiV1StudioChaptersGet({
        projectId, page: 1, pageSize: 100,
      })
      const data = response.data
      if (!data?.items || data.items.some(chapter => chapter.project_id !== projectId)) return 'error'
      const total = data.pagination?.total
      if (!data.items.length && total > 0) return 'error'
      const chapterCount = !data.items.length ? 0
        : Number.isSafeInteger(total) && total >= data.items.length ? total : undefined
      let summary = summarizeProjectChapters(projectId, data.items)
      let loaded = data.items.length
      let chapterPage = 1
      while (chapterCount !== undefined && loaded >= chapterPage * 100 && loaded < chapterCount && summary.key !== 'edit_raw') {
        if (!isCurrent()) return 'error'
        chapterPage += 1
        const next = await StudioChaptersService.listChaptersApiV1StudioChaptersGet({
          projectId, page: chapterPage, pageSize: 100,
        })
        const items = next.data?.items
        if (!items?.length || items.some(chapter => chapter.project_id !== projectId)) return 'error'
        const nextSummary = summarizeProjectChapters(projectId, items)
        if (nextSummary.key === 'edit_raw') summary = nextSummary
        loaded += items.length
      }
      return { ...summary, chapterCount }
    } catch {
      return 'error'
    }
  }, [])

  useEffect(() => {
    if (loading || loadError) return
    let active = true
    projects.forEach(project => {
      void readProjectStage(project.id, () => active).then(summary => {
        if (active) setProjectStageMap(previous => ({ ...previous, [project.id]: summary }))
      })
    })
    return () => { active = false }
  }, [loadError, loading, projects, readProjectStage])

  const retryProjectStage = async (projectId: string, trigger?: HTMLButtonElement) => {
    if (projectStageMap[projectId] !== 'error') return
    setProjectStageMap(previous => ({ ...previous, [projectId]: 'retrying' }))
    const summary = await readProjectStage(projectId)
    if (summary !== 'error' && trigger && trigger === document.activeElement) {
      trigger.closest('article')?.querySelector<HTMLAnchorElement>('.project-lobby-identity')?.focus()
    }
    setProjectStageMap(previous => ({ ...previous, [projectId]: summary }))
  }

  const changePage = (nextPage: number) => {
    setSelectedIds([])
    panel.current?.scrollTo(0, 0)
    setPage(nextPage)
  }

  const handleToggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)
    )
  }

  const handleBatchDelete = async () => {
    if (!selectedIds.length || batchDeleting || loading || loadError) return
    setBatchDeleting(true)
    try {
      const results = await Promise.allSettled(selectedIds.map(projectId =>
        StudioProjectsService.deleteProjectApiV1StudioProjectsProjectIdDelete({ projectId }),
      ))
      const deleted = new Set(selectedIds.filter((_, index) => results[index].status === 'fulfilled'))
      if (deleted.size) setReload(previous => previous + 1)
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
      navigate(`/projects/${ui.id}`)
    } catch {
      message.error('创建失败')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || deletePending.current) return
    deletePending.current = true
    setDeleting(true)
    setDeleteError('')
    try {
      await StudioProjectsService.deleteProjectApiV1StudioProjectsProjectIdDelete({ projectId: deleteTarget.id })
      setReload(previous => previous + 1)
      setDeleteTarget(null)
      message.success('已删除')
    } catch (cause) {
      setDeleteError(apiErrorMessage(cause))
    } finally {
      deletePending.current = false
      setDeleting(false)
    }
  }

  const optionsMenu: MenuProps = {
    selectable: true,
    multiple: true,
    selectedKeys: [sortKey, sortOrder],
    items: [
      { key: 'sorting', type: 'group', label: '排序', children: sortOptions.map(option => ({
        ...option, onClick: () => changeQuery('sort', option.key),
      })) },
      { key: 'direction', type: 'group', label: '排序方向', children: [
        { key: 'asc', label: '升序', onClick: () => changeQuery('direction', 'asc') },
        { key: 'desc', label: '降序', onClick: () => changeQuery('direction', 'desc') },
      ] },
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
        onChange={event => changeQuery('q', event.target.value)}
      />
      <Select
        aria-label="制作阶段筛选"
        popupClassName="project-lobby-options"
        virtual={false}
        value={filterTab}
        options={[{ value: 'all', label: '全部状态' }, { value: 'editRaw', label: '待补原文' }]}
        onChange={value => changeQuery('stage', value === 'editRaw' ? 'edit_raw' : '')}
      />
      <Dropdown menu={optionsMenu} overlayClassName="project-lobby-options" trigger={['click']} autoFocus>
        <Button icon={<MoreOutlined />}>排序与批量</Button>
      </Dropdown>
    </div>
  )
  const createProject = (
    <Button key="create" ref={createButton} className="project-lobby-create" type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>新建项目</Button>
  )

  return (
    <WorkspaceLayout className="project-lobby">
      <PageToolbar>
        <div className="project-lobby-heading">
          <h1 className="app-page-title">项目</h1>
          <span className="project-lobby-count" role="status">
            {!loading && !loadError && (keyword || filterTab !== 'all' ? `匹配 ${total} 个项目` : `共 ${total} 个项目`)}
          </span>
          {useMock && <span className="project-lobby-count">模拟环境</span>}
        </div>
        {wideToolbar ? [controls, createProject] : [createProject, controls]}
      </PageToolbar>
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
            disabled={loading || loadError || !selectedIds.length || batchDeleting}
          >
            <Button danger disabled={loading || loadError || !selectedIds.length} loading={batchDeleting}>删除选中</Button>
          </Popconfirm>
          <Button disabled={batchDeleting} onClick={() => { setMultiSelectMode(false); setSelectedIds([]) }}>退出批量管理</Button>
        </div>
      )}
      <div className="app-card-list-content">
        <div ref={measureGrid} className="app-card-list-grid app-card-list-measure" aria-hidden="true">
          <div ref={measureCard}>
            <div className="project-lobby-cover" />
            <div className="project-lobby-card-body" />
          </div>
        </div>
        <WorkspaceScrollPanel ref={panel} className="project-lobby-scroll">
          {loadError && <Alert showIcon type="error" message="无法读取项目列表" action={<Button onClick={() => void load()}>重试</Button>} />}
          {loading ? <Spin /> : !loadError && (
            <>
              {!projects.length && (
                <Empty description={keyword || filterTab !== 'all' ? '没有匹配的项目' : '暂无项目，点击「新建项目」开始'} />
              )}
              <div className="app-card-list-grid project-lobby-grid">
                {projects.map(project => {
                  const summary = projectStageMap[project.id]
                  const stage = typeof summary === 'object' ? summary : undefined
                  const noChapter = stage?.key === 'create_first_chapter'
                  const statusText = summary === 'error' ? '读取失败' : '读取中'
                  const chapterText = stage ? stage.chapterLabel ?? '未创建章节' : statusText
                  const sequenceText = !stage ? statusText
                    : noChapter || stage.sequenceCount === 0 ? '未创建场次'
                      : stage.sequenceCount === undefined ? '场次数未知' : `本章 ${stage.sequenceCount} 场`
                  const countText = stage?.chapterCount === undefined ? '章节数未知' : `共 ${stage.chapterCount} 章`
                  return (
                    <article className="project-lobby-card" key={project.id}>
                      <ProjectCover projectId={project.id} demo={useMock} source={buildFileDownloadUrl(project.cover_file_id)} />
                      <div className="project-lobby-card-body">
                        <h2 className="project-lobby-card-title" title={project.name}>
                          {multiSelectMode ? <span className="project-lobby-truncate">{project.name}</span> : (
                            <Link className="project-lobby-identity" to={`/projects/${encodeURIComponent(project.id)}`}>
                              <span>{project.name}</span><ArrowRightOutlined aria-hidden />
                            </Link>
                          )}
                        </h2>
                        <div className="project-lobby-card-row">
                          <span className="project-lobby-style" title={project.style}>{project.style ?? '未设置类型'}</span>
                          {project.updatedAt && (
                            <span className="project-lobby-meta project-lobby-truncate" title={`更新于 ${project.updatedAt}`}>
                              更新于 {project.updatedAt}
                            </span>
                          )}
                        </div>
                        <div className="project-lobby-card-row">
                          <FileTextOutlined aria-hidden />
                          <span className="project-lobby-truncate" title={chapterText}>{chapterText}</span>
                          {!multiSelectMode && (summary === 'error' || summary === 'retrying') && (
                            <button type="button" className="project-lobby-retry" aria-label="重试读取章节"
                              aria-disabled={summary === 'retrying'} onClick={event => void retryProjectStage(project.id, event.currentTarget)}>
                              重试
                            </button>
                          )}
                        </div>
                        <div className="project-lobby-card-row project-lobby-counts">
                          <span className="project-lobby-count-item">
                            <VideoCameraOutlined aria-hidden />
                            <span className="project-lobby-truncate">{sequenceText}</span>
                          </span>
                          {stage && (
                            <span className="project-lobby-count-item">
                              <BookOutlined aria-hidden />
                              <span className="project-lobby-truncate">{countText}</span>
                            </span>
                          )}
                          {stage?.key === 'edit_raw' && <Tag bordered={false} className="project-lobby-status">待补原文</Tag>}
                        </div>
                      </div>
                      <div className="project-lobby-card-control">
                        {multiSelectMode ? (
                          <Checkbox
                            aria-label={`选择 ${project.name}`}
                            checked={selectedIds.includes(project.id)}
                            disabled={batchDeleting}
                            onChange={event => handleToggleSelect(project.id, event.target.checked)}
                          />
                        ) : (
                          <Button
                            type="text"
                            aria-label={`删除 ${project.name}`}
                            icon={<DeleteOutlined />}
                            onClick={event => {
                              deleteTrigger.current = event.currentTarget
                              setDeleteError('')
                              setDeleteTarget(project)
                            }}
                          />
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </WorkspaceScrollPanel>
      </div>
      <CardListPagination label="项目列表分页" page={page} pageSize={pageSize} total={loadError ? 0 : total}
        compact={!wideToolbar} disabled={loading || batchDeleting || deleting} onChange={changePage} />
      <Modal
        title="删除项目"
        open={Boolean(deleteTarget)}
        onOk={() => void handleDelete()}
        onCancel={() => { if (!deletePending.current) setDeleteTarget(null) }}
        afterClose={() => {
          const target = deleteTrigger.current
          const focusTarget = target?.isConnected ? target : createButton.current
          focusTarget?.focus()
        }}
        focusTriggerAfterClose={false}
        confirmLoading={deleting}
        cancelButtonProps={{ disabled: deleting, autoFocus: true }}
        okButtonProps={{ danger: true }}
        okText="删除"
        cancelText="取消"
        keyboard={!deleting}
        maskClosable={false}
        closable={!deleting}
        destroyOnClose
      >
        <p>确定删除「{deleteTarget?.name}」？此操作不可恢复。</p>
        {deleteError && <Alert type="error" showIcon message={deleteError} />}
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

    </WorkspaceLayout>
  )
}

export default ProjectLobby
