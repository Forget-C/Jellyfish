import { useState, useEffect, useMemo, useRef } from 'react'
import { Card, Button, Tag, Space, Table, Empty, Modal, Input, Dropdown, message } from 'antd'
import type { MenuProps, TableColumnsType } from 'antd'
import {
  EditOutlined,
  FileSearchOutlined,
  LoadingOutlined,
  MoreOutlined,
  PlusOutlined,
  ScissorOutlined,
  StopOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ScriptProcessingService, StudioChaptersService } from '../../../../../services/generated'
import { chapterStatusMap } from '../constants'
import { getChapterShotsPath, getChapterStudioPath, getChapterTimelinePath } from '../routes'
import { useChapters, newId, type Chapter } from '../hooks/useProjectData'
import { ChapterRawTextEditorModal } from '../../../chapter/components/ChapterRawTextEditorModal'
import { ensureHasShotsBeforeShooting } from '../ensureHasShotsBeforeShooting'
import { getChapterPreparationState } from '../chapterPreparation'
import { loadChapterFlowStats, type ChapterFlowStats } from '../projectFlowStats'
import { executeAsyncTaskCreate, executeTaskCancel } from '../../../components/taskActionHelpers'
import { TASK_COPY } from '../../../components/taskCopy'
import { useTaskPageContext } from '../../../components/taskPageContext'
import { useTaskUiStore } from '../../../components/taskUiStore'
import {
  createRelationTaskState,
  upsertRelationTaskStateInMap,
  useChapterDivisionTaskMapPolling,
} from '../chapterDivisionTasks'
import { ScrollablePage } from '../../../components/ScrollablePage'

const { TextArea } = Input
const CREATE_PARAM = 'create'
const EDIT_PARAM = 'edit'

export function ChaptersTab() {
  const taskCopy = TASK_COPY.chapterDivision
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { chapters, loading, refresh, patchChapterLocal } = useChapters(projectId)

  const [editOpen, setEditOpen] = useState(false)
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createContent, setCreateContent] = useState('')
  const [chapterFlowMap, setChapterFlowMap] = useState<Record<string, ChapterFlowStats>>({})
  const [chapterDivisionActionId, setChapterDivisionActionId] = useState<string | null>(null)
  const taskUiUpsert = useTaskUiStore((state) => state.upsertTask)
  const taskUiRemove = useTaskUiStore((state) => state.removeTask)
  const syncedTaskIdsRef = useRef<string[]>([])
  const chapterIds = useMemo(() => chapters.map((chapter) => chapter.id), [chapters])
  useTaskPageContext(
    chapterIds.map((id) => ({
      relationType: 'chapter_division',
      relationEntityId: id,
    })),
  )
  const { taskMap: chapterDivisionTaskMap, setTrackedTaskMap: setChapterDivisionTaskMap } = useChapterDivisionTaskMapPolling({
    chapterIds,
    onTasksSettled: async () => {
      await refresh()
    },
  })

  const createParam = searchParams.get(CREATE_PARAM)
  const editParam = searchParams.get(EDIT_PARAM)
  useEffect(() => {
    if (createParam === '1') {
      setCreateOpen(true)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete(CREATE_PARAM)
          return next
        },
        { replace: true }
      )
    }
  }, [createParam, setSearchParams])

  useEffect(() => {
    if (!editParam) return
    const target = chapters.find((chapter) => chapter.id === editParam)
    if (!target) return
    openEditModal(target)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete(EDIT_PARAM)
        return next
      },
      { replace: true }
    )
  }, [chapters, editParam, setSearchParams])

  useEffect(() => {
    let cancelled = false
    if (!chapters.length) {
      setChapterFlowMap({})
      return () => {
        cancelled = true
      }
    }

    const run = async () => {
      try {
        const rows = await loadChapterFlowStats(chapters)
        if (!cancelled) {
          setChapterFlowMap(Object.fromEntries(rows.map((row) => [row.chapterId, row])))
        }
      } catch {
        if (!cancelled) setChapterFlowMap({})
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [chapters])

  const openEditModal = (chapter: Chapter) => {
    setEditingChapter(chapter)
    setEditOpen(true)
  }

  const openCreateNextStep = (chapter: Chapter, hasRawText: boolean) => {
    if (!projectId) return
    Modal.confirm({
      title: '章节创建成功',
      content: hasRawText
        ? '这一章已经有原文内容，接下来更适合直接提取分镜。'
        : '这一章还没有原文内容，建议先补章节原文。',
      okText: hasRawText ? '立即提取分镜' : '继续编辑原文',
      cancelText: '稍后处理',
      onOk: () => {
        if (hasRawText) {
          navigate(getChapterShotsPath(projectId, chapter.id))
          return
        }
        openEditModal(chapter)
      },
    })
  }

  const handleCreateChapter = async () => {
    if (!createTitle.trim()) {
      message.warning('请输入章节标题')
      return
    }
    if (!projectId) return
    try {
      const nextIndex = Math.max(0, ...chapters.map((c) => c.index)) + 1
      const createdId = newId('c')
      const title = createTitle.trim()
      const rawText = createContent
      const draftChapter: Chapter = {
        id: createdId,
        projectId,
        index: nextIndex,
        title,
        summary: '',
        rawText,
        storyboardCount: 0,
        status: 'draft',
        updatedAt: new Date().toISOString(),
      }
      await StudioChaptersService.createChapterApiV1StudioChaptersPost({
        requestBody: {
          id: createdId,
          project_id: projectId,
          index: nextIndex,
          title,
          summary: '',
          raw_text: rawText || undefined,
          storyboard_count: 0,
          status: 'draft',
        },
      })
      message.success('章节创建成功')
      setCreateOpen(false)
      setCreateTitle('')
      setCreateContent('')
      await refresh()
      openCreateNextStep(draftChapter, !!rawText.trim())
    } catch {
      message.error('创建章节失败')
    }
  }

  const useMock = import.meta.env.VITE_USE_MOCK === 'true'
  const handleCreateChapterMock = () => {
    if (!createTitle.trim()) {
      message.warning('请输入章节标题')
      return
    }
    if (!projectId) return
    const nextIndex = Math.max(0, ...chapters.map((c) => c.index)) + 1
    const createdId = newId('c')
    const title = createTitle.trim()
    const rawText = createContent
    const draftChapter: Chapter = {
      id: createdId,
      projectId,
      index: nextIndex,
      title,
      summary: '',
      rawText,
      storyboardCount: 0,
      status: 'draft',
      updatedAt: new Date().toISOString(),
    }
    message.success('创建成功（Mock）')
    setCreateOpen(false)
    setCreateTitle('')
    setCreateContent('')
    window.setTimeout(() => openCreateNextStep(draftChapter, !!rawText.trim()), 0)
    void refresh()
  }

  const handlePrimaryAction = (record: Chapter) => {
    if (!projectId) return
    const activeTask = chapterDivisionTaskMap[record.id]
    if (activeTask) {
      navigate(getChapterShotsPath(projectId, record.id))
      return
    }
    const state = getChapterPreparationState(record)
    if (state.key === 'edit_raw') {
      openEditModal(record)
      return
    }
    if (state.key === 'extract_shots') {
      navigate(getChapterShotsPath(projectId, record.id))
      return
    }
    if (state.key === 'prepare_shots') {
      navigate(getChapterStudioPath(projectId, record.id))
      return
    }
    void ensureHasShotsBeforeShooting({
      projectId,
      chapterId: record.id,
      storyboardCount: record.storyboardCount,
      navigate,
    })
  }

  const handleDivideAsync = async (record: Chapter) => {
    const scriptText = record.rawText?.trim()
    if (!scriptText) {
      message.warning('请先补章节原文')
      return
    }
    setChapterDivisionActionId(record.id)
    try {
      await executeAsyncTaskCreate({
        request: () =>
          ScriptProcessingService.divideScriptAsyncApiV1ScriptProcessingDivideAsyncPost({
            requestBody: {
              chapter_id: record.id,
              script_text: scriptText,
              write_to_db: true,
            },
          }),
        trackTaskData: (data) => {
          const tracked = createRelationTaskState(data)
          setChapterDivisionTaskMap(upsertRelationTaskStateInMap(chapterDivisionTaskMap, record.id, tracked))
          return tracked
        },
        startedMessage: taskCopy.startedMessage,
        reusedMessage: taskCopy.reusedMessage,
        fallbackErrorMessage: '启动分镜提取失败',
      })
    } catch {
      // executeAsyncTaskCreate 已统一处理错误提示
    } finally {
      setChapterDivisionActionId(null)
    }
  }

  const handleCancelDivideTask = async (record: Chapter) => {
    const activeTask = chapterDivisionTaskMap[record.id]
    if (!activeTask) return
    setChapterDivisionActionId(record.id)
    try {
      await executeTaskCancel({
        taskId: activeTask.taskId,
        reason: '用户在章节页取消分镜提取',
        applyCancelData: (data) => {
          if (!data?.task_id || !data?.status) return null
          const tracked = createRelationTaskState(
            {
              task_id: data.task_id,
              status: data.status,
            },
            { cancelRequested: data.cancel_requested ?? false },
          )
          setChapterDivisionTaskMap(upsertRelationTaskStateInMap(chapterDivisionTaskMap, record.id, tracked))
          return tracked
        },
        cancelledImmediatelyMessage: taskCopy.cancelledImmediatelyMessage,
        cancelRequestedMessage: taskCopy.cancelRequestedMessage,
        fallbackErrorMessage: '取消任务失败',
      })
    } catch {
      // executeTaskCancel 已统一处理错误提示
    } finally {
      setChapterDivisionActionId(null)
    }
  }

  useEffect(() => {
    const nextTaskIds: string[] = []

    chapters.forEach((chapter) => {
      const task = chapterDivisionTaskMap[chapter.id]
      if (!task) return
      nextTaskIds.push(task.taskId)
      taskUiUpsert({
        taskId: task.taskId,
        title: taskCopy.title,
        sourceLabel: chapter.title ? `章节：${chapter.title}` : '项目工作台章节列表',
        status: task.status,
        progress: task.progress,
        cancelRequested: task.cancelRequested,
        startedAtTs: task.startedAtTs,
        finishedAtTs: task.finishedAtTs,
        elapsedMs: task.elapsedMs,
        onCancel: () => void handleCancelDivideTask(chapter),
        onNavigate: projectId ? () => navigate(getChapterShotsPath(projectId, chapter.id)) : null,
      })
    })

    syncedTaskIdsRef.current
      .filter((taskId) => !nextTaskIds.includes(taskId))
      .forEach((taskId) => taskUiRemove(taskId))

    syncedTaskIdsRef.current = nextTaskIds
  }, [chapterDivisionTaskMap, chapters, handleCancelDivideTask, navigate, projectId, taskCopy.title, taskUiRemove, taskUiUpsert])

  useEffect(() => {
    return () => {
      syncedTaskIdsRef.current.forEach((taskId) => taskUiRemove(taskId))
      syncedTaskIdsRef.current = []
    }
  }, [taskUiRemove])

  const buildActionMenuItems = (record: Chapter): MenuProps['items'] => {
    if (!projectId) return []
    const state = getChapterPreparationState(record)
    const activeTask = chapterDivisionTaskMap[record.id]
    return [
      {
        key: 'timeline',
        label: '章节剪辑',
        icon: <ScissorOutlined />,
        onClick: () => navigate(getChapterTimelinePath(projectId, record.id)),
      },
      {
        key: 'shots',
        label: '查看分镜',
        icon: <FileSearchOutlined />,
        onClick: () => navigate(getChapterShotsPath(projectId, record.id)),
      },
      state.key !== 'prepare_shots' && (record.storyboardCount ?? 0) > 0
        ? {
            key: 'studio',
            label: '进入工作室',
            icon: <FileSearchOutlined />,
            onClick: () => navigate(getChapterStudioPath(projectId, record.id)),
          }
        : null,
      {
        key: 'raw',
        label: '编辑原文',
        icon: <EditOutlined />,
        onClick: () => openEditModal(record),
      },
      activeTask
        ? {
            key: 'cancel_divide',
            label: activeTask.cancelRequested ? '取消请求已发出' : '取消分镜提取',
            icon: <StopOutlined />,
            disabled: activeTask.cancelRequested || chapterDivisionActionId === record.id,
            onClick: () => void handleCancelDivideTask(record),
          }
        : null,
    ].filter(Boolean)
  }

  const columns: TableColumnsType<Chapter> = [
    { title: '章节', dataIndex: 'index', key: 'index', width: 80, render: (v: number) => `第${v}集` },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, record) => (
        <Button
          type="link"
          size="small"
          style={{ paddingInline: 0 }}
          onClick={() => openEditModal(record)}
        >
          {title || '未命名章节'}
        </Button>
      ),
    },
    { title: '分镜数', dataIndex: 'storyboardCount', key: 'storyboardCount', width: 90 },
    {
      title: '准备状态',
      key: 'preparation',
      width: 180,
      render: (_, record) => {
        const activeTask = chapterDivisionTaskMap[record.id]
        if (activeTask) {
          return (
            <div className="space-y-1">
              <Tag color={activeTask.cancelRequested ? 'orange' : 'processing'}>
                {activeTask.cancelRequested ? '正在取消提取' : '分镜提取中'}
              </Tag>
              <div className="text-[11px] text-gray-500 leading-5">
                {activeTask.cancelRequested ? '已请求取消，将在当前步骤结束后停止' : '系统正在异步提取当前章节分镜'}
              </div>
            </div>
          )
        }
        const state = getChapterPreparationState(record)
        return (
          <div className="space-y-1">
            <Tag color={state.color}>{state.text}</Tag>
            <div className="text-[11px] text-gray-500 leading-5">{state.hint}</div>
          </div>
        )
      },
    },
    {
      title: '分镜流转',
      key: 'shotFlow',
      width: 220,
      render: (_, record) => {
        const stats = chapterFlowMap[record.id]
        return (
          <div className="flex flex-wrap gap-1">
            <Tag bordered={false} color="gold" className="mr-0">
              待确认 {stats?.pendingConfirmShots ?? 0}
            </Tag>
            <Tag bordered={false} color="green" className="mr-0">
              已就绪 {stats?.readyShots ?? 0}
            </Tag>
            <Tag bordered={false} color="processing" className="mr-0">
              生成中 {stats?.generatingShots ?? 0}
            </Tag>
          </div>
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: Chapter['status']) => (
        <Tag color={chapterStatusMap[status].color}>{chapterStatusMap[status].text}</Tag>
      ),
    },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 160 },
    {
      title: '操作',
      key: 'action',
      width: 230,
      render: (_, record) => {
        const state = getChapterPreparationState(record)
        const activeTask = chapterDivisionTaskMap[record.id]
        const primaryIcon = activeTask
          ? activeTask.cancelRequested
            ? <SyncOutlined spin />
            : <LoadingOutlined />
          : state.primaryIcon
        const primaryText = activeTask
          ? activeTask.cancelRequested
            ? '查看取消进度'
            : '查看提取进度'
          : state.primaryAction
        const primaryLoading = chapterDivisionActionId === record.id && state.key === 'extract_shots' && !activeTask

        return (
          <Space size={8}>
            <Button
              type="primary"
              size="small"
              onClick={() => {
                if (state.key === 'extract_shots' && !activeTask) {
                  void handleDivideAsync(record)
                  return
                }
                handlePrimaryAction(record)
              }}
              style={{ minWidth: 132, justifyContent: 'center' }}
              icon={primaryIcon}
              loading={primaryLoading}
            >
              {primaryText}
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{ items: buildActionMenuItems(record) }}
            >
              <Button
                size="small"
                icon={<MoreOutlined />}
                aria-label="更多操作"
                loading={chapterDivisionActionId === record.id && !!activeTask}
              />
            </Dropdown>
          </Space>
        )
      },
    },
  ]

  if (chapters.length === 0 && !loading) {
    return (
      <ScrollablePage className="pr-1">
        <Card>
          <Empty description="还没有任何章节，立即创建第一章吧" image={Empty.PRESENTED_IMAGE_SIMPLE}>
            <Space>
              <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                创建第一章
              </Button>
            </Space>
          </Empty>
        </Card>
        <Modal
          title="新建章节"
          open={createOpen}
          onCancel={() => setCreateOpen(false)}
          onOk={useMock ? handleCreateChapterMock : handleCreateChapter}
          okText="创建"
          width={560}
        >
          <div className="space-y-3">
            <div>
              <span className="text-gray-600 text-sm">章节标题</span>
              <Input
                placeholder="例如：第1集 出租屋里的争吵"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <span className="text-gray-600 text-sm">章节内容（可粘贴剧本）</span>
              <TextArea
                rows={6}
                placeholder="粘贴文学剧本..."
                value={createContent}
                onChange={(e) => setCreateContent(e.target.value)}
                className="mt-1 font-mono text-sm"
              />
            </div>
          </div>
        </Modal>
      </ScrollablePage>
    )
  }

  return (
    <ScrollablePage className="pr-1">
      <Card
        title="章节列表"
        extra={
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              新建章节
            </Button>
          </Space>
        }
      >
        <Table<Chapter>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={chapters}
          pagination={{ pageSize: 10 }}
          size="small"
        />

        <ChapterRawTextEditorModal
          open={editOpen}
          onClose={() => {
            setEditOpen(false)
            setEditingChapter(null)
          }}
          chapterId={editingChapter?.id}
          onSaved={(next) => {
            if (editingChapter?.id && typeof next.rawText === 'string') {
              patchChapterLocal(editingChapter.id, { rawText: next.rawText })
            }
            void refresh()
          }}
        />

        <Modal
          title="新建章节"
          open={createOpen}
          onCancel={() => setCreateOpen(false)}
          onOk={useMock ? handleCreateChapterMock : handleCreateChapter}
          okText="创建"
          width={560}
        >
          <div className="space-y-3">
            <div>
              <span className="text-gray-600 text-sm">章节标题</span>
              <Input
                placeholder="例如：第1集 出租屋里的争吵"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <span className="text-gray-600 text-sm">章节内容（可粘贴剧本）</span>
              <TextArea
                rows={6}
                placeholder="粘贴文学剧本..."
                value={createContent}
                onChange={(e) => setCreateContent(e.target.value)}
                className="mt-1 font-mono text-sm"
              />
            </div>
          </div>
        </Modal>
      </Card>
    </ScrollablePage>
  )
}
