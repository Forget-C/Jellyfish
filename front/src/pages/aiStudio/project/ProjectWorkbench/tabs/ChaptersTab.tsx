import { useState, useEffect, useMemo, useRef } from 'react'
import { Card, Button, Tag, Space, Table, Empty, Modal, Input, Dropdown, Tooltip, Upload, message } from 'antd'
import type { MenuProps, TableColumnsType } from 'antd'
import {
  EditOutlined,
  FileSearchOutlined,
  FormOutlined,
  LoadingOutlined,
  MoreOutlined,
  PlusOutlined,
  ScissorOutlined,
  StopOutlined,
  SyncOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ScriptProcessingService, StudioChaptersService } from '../../../../../services/generated'
import { chapterStatusMap } from '../constants'
import { getChapterShotsPath, getChapterStudioPath } from '../routes'
import { useChapters, newId, type Chapter } from '../hooks/useProjectData'
import { ChapterRawTextEditorModal } from '../../../chapter/components/ChapterRawTextEditorModal'
import { getChapterPreparationState } from '../chapterPreparation'
import { loadChapterFlowStats, type ChapterFlowStats } from '../projectFlowStats'
import { executeTaskCancel } from '../../../components/taskActionHelpers'
import { TASK_COPY } from '../../../components/taskCopy'
import { chapterDisplayName, nextChapterIndex } from '../../../chapter/chapterIndexing'
import { parseScriptDocument } from '../../../../../services/llmPipelineApi'
import { classifyGenerationFailure, failureText } from '../../../components/generationGate'
import { useTaskPageContext } from '../../../components/taskPageContext'
import { useTaskUiStore } from '../../../components/taskUiStore'
import { formatUserFacingTime } from '../../../components/userFacingTime'
import { showUserError, showUserWarning } from '../../../components/userFacingMessage'
import {
  createRelationTaskState,
  upsertRelationTaskStateInMap,
  useChapterDivisionTaskMapPolling,
} from '../chapterDivisionTasks'

const { TextArea } = Input
const CREATE_PARAM = 'create'
const EDIT_PARAM = 'edit'

/**
 * 分镜提取改为同步调用：本环境没有配置后台任务 worker
 * （Celery broker 不可达、也没有 worker 进程），异步接口只会写一条任务记录后
 * 无人执行。这里改用 `/api/v1/script-processing/divide`，AI 在本次 HTTP 请求内
 * 跑完并直接返回结果，代价是请求会阻塞数十秒。
 */
const SYNC_DIVIDE_HINT =
  '本环境未配置后台任务 worker，AI 会在本次请求内同步执行分镜提取，通常需要数十秒，请不要重复点击或关闭页面'
const SYNC_DIVIDE_LOADING = 'AI 正在同步拆解本集分镜，通常需要数十秒，请不要重复点击…'
const SYNC_DIVIDE_MESSAGE_KEY = 'chapter-sync-divide'

/**
 * 把后端统一错误信封 `{code, message, data, meta}` 解析成可读提示。
 * 结构化细节优先取 `meta.error.message`，缺失时回退到信封 `message` / `detail`
 * 与客户端 ApiError 自带的 message（与 PromptFlowPage 的处理约定一致）。
 */
function describeEnvelopeError(error: unknown, fallback: string): string {
  if (!error) return fallback
  if (typeof error === 'string') return error.trim() || fallback
  const err = error as { body?: unknown; message?: unknown }
  const body = err.body
  if (body && typeof body === 'object') {
    const envelope = body as Record<string, unknown>
    const meta = (envelope.meta ?? {}) as Record<string, unknown>
    const metaError = (meta.error ?? {}) as Record<string, unknown>
    const metaMessage = metaError.message
    if (typeof metaMessage === 'string' && metaMessage.trim()) return metaMessage
    const envelopeMessage = envelope.message
    if (typeof envelopeMessage === 'string' && envelopeMessage.trim()) return envelopeMessage
    const detail = envelope.detail
    if (typeof detail === 'string' && detail.trim()) return detail
  }
  if (typeof err.message === 'string' && err.message.trim()) return err.message
  return fallback
}

export function ChaptersTab() {
  const taskCopy = TASK_COPY.chapterDivision
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { chapters, loading, refresh, patchChapterLocal } = useChapters(projectId)

  const [editOpen, setEditOpen] = useState(false)
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null)
  /**
   * 剧集名称（后端 `chapters.title`）的**改名**状态。
   *
   * 为什么单独一套状态、而不是复用原文编辑器：原文编辑器只发 `raw_text` /
   * `condensed_text`，**从不发 `title`** —— 这也是"剧集名改不了"的直接原因
   * （需求清单第 1 条）。改名走的就是既有的
   * `PATCH /api/v1/studio/chapters/{id}`（`ChapterUpdate.title` 早就在契约里），
   * 不需要新字段、不需要改库。
   */
  const [renameOpen, setRenameOpen] = useState(false)
  const [renamingChapter, setRenamingChapter] = useState<Chapter | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [importingDoc, setImportingDoc] = useState(false)
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

  /**
   * 打开「修改剧集名称」。
   *
   * 预填的是**当前显示的剧集名**（`title` 为空时就是「第N集」这个默认名），
   * 这样用户看到什么就能改什么，不用先猜"系统内部把它存成什么"。
   */
  const openRenameModal = (chapter: Chapter) => {
    setRenamingChapter(chapter)
    setRenameValue(chapterDisplayName(chapter, chapter.title))
    setRenameOpen(true)
  }

  /**
   * 保存剧集名称。
   *
   * 走既有的章节更新端点（`ChapterUpdate.title`），只发 `title` 一个字段 ——
   * 不发 `raw_text` / `condensed_text`，避免"改个名字顺手把原文一起回写"。
   */
  const handleRename = async () => {
    const target = renamingChapter
    if (!target) return
    const next = renameValue.trim()
    if (!next) {
      showUserWarning(null, '剧集名称不能为空：请填写一个名字，或点「取消」保持原样。')
      return
    }
    setRenaming(true)
    try {
      await StudioChaptersService.updateChapterApiV1StudioChaptersChapterIdPatch({
        chapterId: target.id,
        requestBody: { title: next },
      })
      patchChapterLocal(target.id, { title: next })
      message.success('剧集名称已更新')
      setRenameOpen(false)
      setRenamingChapter(null)
      void refresh()
    } catch (error) {
      showUserError(error, '剧集名称没保存成功：请稍后重试。')
    } finally {
      setRenaming(false)
    }
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

  /**
   * 导入剧本文档（TXT / MD / DOCX）→ 填入章节内容。
   *
   * 走后端纯解析端点（不落盘、不上传对象存储）；旧版 `.doc` 会被后端明确拒绝并提示
   * 「请另存为 DOCX」，这里把原文照实显示给用户，不静默失败。
   */
  const handleImportDocument = async (file: File) => {
    setImportingDoc(true)
    try {
      const parsed = await parseScriptDocument(file)
      setCreateContent(parsed.text)
      if (createTitle.trim() === '') {
        setCreateTitle(parsed.filename.replace(/\.[^.]+$/, ''))
      }
      message.success(
        `已导入 ${parsed.filename}（${parsed.format.toUpperCase()}，${parsed.char_count} 字），确认无误后点「创建」`,
      )
      /**
       * 审计 §4.2 模式 6：`parsed.warnings` / `failureText(failure)` 都是**后端原文**，
       * 原先直插 `message.*` 等于把第三层内容摆到主区。统一走
       * `showUserWarning` / `showUserError`（内部固定顺序：掩码 → 去术语 → 业务化 → 中文兜底），
       * 原文只进默认收起的「技术详情」。
       */
      for (const warning of parsed.warnings ?? []) {
        void showUserWarning(warning, '导入时有一条提示被跳过，不影响本次创建')
      }
    } catch (error) {
      const failure = classifyGenerationFailure(error, 'llm')
      void showUserError(failureText(failure), '剧本导入失败：请稍后重试')
    } finally {
      setImportingDoc(false)
    }
    return false
  }

  const handleCreateChapter = async () => {
    if (!createTitle.trim()) {
      message.warning('请输入章节标题')
      return
    }
    if (!projectId) return
    try {
      // 序号口径统一走 nextChapterIndex：现有最大 index + 1（不是数量 + 1）
      const nextIndex = nextChapterIndex(chapters.map((c) => c.index))
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
    if (state.key === 'prepare_shots' || state.key === 'shoot') {
      // 有分镜之后不再从章节行直接跳进分镜工作室：按六步顺序先做资产提取。
      // （工作室仍可从步骤条第 5/6 步或分镜页的次按钮进入，用于单镜查看与补漏。）
      navigate(`/projects/${projectId}?step=extract_assets`)
      return
    }
    navigate(`/projects/${projectId}?step=extract_assets`)
  }

  const handleDivideAsync = async (record: Chapter) => {
    const scriptText = record.rawText?.trim()
    if (!scriptText) {
      message.warning('请先补章节原文')
      return
    }
    // 同步请求会阻塞数十秒，这里显式挡住重复点击（按钮本身也在 loading）。
    if (chapterDivisionActionId) return
    setChapterDivisionActionId(record.id)
    message.loading({ content: SYNC_DIVIDE_LOADING, key: SYNC_DIVIDE_MESSAGE_KEY, duration: 0 })
    try {
      const res = await ScriptProcessingService.divideScriptApiV1ScriptProcessingDividePost({
        requestBody: {
          chapter_id: record.id,
          script_text: scriptText,
          write_to_db: true,
        },
      })
      const totalShots = res.data?.total_shots ?? res.data?.shots?.length ?? 0
      message.destroy(SYNC_DIVIDE_MESSAGE_KEY)
      message.success(`分镜提取完成，共 ${totalShots} 个分镜`)
      await refresh()
    } catch (error) {
      message.destroy(SYNC_DIVIDE_MESSAGE_KEY)
      /* 审计 §4.2 模式 6：`describeEnvelopeError` 会依次返回信封里的
         `meta.error.message` / `message` / `detail` 原文，属于第三层内容，
         出口处必须过统一管道（主区只出中文结论，原文进「技术详情」）。 */
      void showUserError(describeEnvelopeError(error, '分镜提取失败'), '分镜提取失败：请稍后重试')
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
        key: 'shots',
        label: '查看分镜',
        icon: <ScissorOutlined />,
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
        key: 'rename',
        label: '修改剧集名称',
        icon: <FormOutlined />,
        onClick: () => openRenameModal(record),
      },
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
    // 集数是**编号**（由 `index` 推出来的序号），不是剧集名称；名称单独一列且可改
    { title: '集数', dataIndex: 'index', key: 'index', width: 80, render: (v: number) => `第${v}集` },
    {
      title: '剧集名称',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, record) => (
        /*
         需求清单第 1 条：**剧集名称可编辑**。
         此前这一列点开的是「原文编辑器」（它只发 raw_text / condensed_text，改不了名字），
         所以界面上根本没有改剧集名的入口。现在这一列开的是**改名**；
         原文编辑仍然在右侧「更多操作」里的「编辑原文」，两个入口不再互相顶替。
        */
        <Space size={4}>
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 0 }}
            onClick={() => openRenameModal(record)}
            data-testid={`rename-chapter-${record.id}`}
          >
            {chapterDisplayName(record, title)}
          </Button>
          <Tooltip title="修改剧集名称">
            <Button
              type="text"
              size="small"
              icon={<FormOutlined />}
              aria-label="修改剧集名称"
              onClick={() => openRenameModal(record)}
            />
          </Tooltip>
        </Space>
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
        if (chapterDivisionActionId === record.id) {
          return (
            <div className="space-y-1">
              <Tag color="processing">同步提取中</Tag>
              <div className="text-[11px] text-gray-500 leading-5">
                本环境无后台 worker，AI 在本次请求内同步执行，通常数十秒
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
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 160,
      /**
       * 审计 §4.2 模式 3：这一列原先**没有 `render`**，后端给的 ISO 串
       * （`2026-09-26T04:02:58.135Z`）于是原样上了屏。时间口径统一走
       * `formatUserFacingTime`（全仓唯一实现），不在渲染点直渲后端值。
       */
      render: (value: string) => formatUserFacingTime(value),
    },
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
          : chapterDivisionActionId === record.id && state.key === 'extract_shots'
            ? '同步提取中…'
            : state.primaryAction
        const primaryLoading = chapterDivisionActionId === record.id && state.key === 'extract_shots' && !activeTask
        const showSyncHint = state.key === 'extract_shots' && !activeTask

        return (
          <Space size={8}>
            <Tooltip title={showSyncHint ? SYNC_DIVIDE_HINT : undefined}>
              <span>
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
                  disabled={primaryLoading}
                >
                  {primaryText}
                </Button>
              </span>
            </Tooltip>
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
      <>
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-gray-600 text-sm">章节内容（粘贴或导入文档）</span>
                <Upload
                  accept=".txt,.md,.markdown,.docx,.doc"
                  showUploadList={false}
                  beforeUpload={(file) => handleImportDocument(file as unknown as File)}
                >
                  <Button size="small" icon={<UploadOutlined />} loading={importingDoc} data-testid="chapter-import-doc">
                    导入 TXT / MD / DOCX
                  </Button>
                </Upload>
              </div>
              <TextArea
                rows={6}
                placeholder="粘贴文学剧本，或点右上角导入 TXT / MD / DOCX 文档（老版 .doc 请先另存为 DOCX）"
                value={createContent}
                onChange={(e) => setCreateContent(e.target.value)}
                className="mt-1 font-mono text-sm"
              />
            </div>
          </div>
        </Modal>
      </>
    )
  }

  return (
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
        title="修改剧集名称"
        open={renameOpen}
        onCancel={() => {
          setRenameOpen(false)
          setRenamingChapter(null)
        }}
        onOk={() => void handleRename()}
        okText="保存名称"
        confirmLoading={renaming}
        width={480}
        destroyOnClose
      >
        <div className="space-y-3">
          <div>
            <span className="text-gray-600 text-sm">剧集名称</span>
            <Input
              placeholder="例如：出租屋里的争吵"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onPressEnter={() => void handleRename()}
              maxLength={80}
              showCount
              className="mt-1"
              data-testid="chapter-rename-input"
            />
          </div>
          <div className="text-[11px] text-gray-500 leading-5">
            这个名字就是剧集列表里显示的名字。集数（第几集）由章节顺序决定，不随名称改变。
          </div>
        </div>
      </Modal>

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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-gray-600 text-sm">章节内容（粘贴或导入文档）</span>
              <Upload
                accept=".txt,.md,.markdown,.docx,.doc"
                showUploadList={false}
                beforeUpload={(file) => handleImportDocument(file as unknown as File)}
              >
                <Button size="small" icon={<UploadOutlined />} loading={importingDoc} data-testid="chapter-import-doc">
                  导入 TXT / MD / DOCX
                </Button>
              </Upload>
            </div>
            <TextArea
              rows={6}
              placeholder="粘贴文学剧本，或点右上角导入 TXT / MD / DOCX 文档（老版 .doc 请先另存为 DOCX）"
              value={createContent}
              onChange={(e) => setCreateContent(e.target.value)}
              className="mt-1 font-mono text-sm"
            />
          </div>
        </div>
      </Modal>
    </Card>
  )
}
