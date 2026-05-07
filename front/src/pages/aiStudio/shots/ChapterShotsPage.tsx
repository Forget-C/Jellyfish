import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Divider,
  Empty,
  Form,
  Input,
  Layout,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import {
  ArrowLeftOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  FileSearchOutlined,
  PlusOutlined,
  ReloadOutlined,
  ScissorOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import type { ShotRead, ShotRuntimeSummaryRead, ShotStatus } from '../../../services/generated'
import { ScriptProcessingService, StudioChaptersService, StudioShotsService } from '../../../services/generated'
import { executeAsyncTaskCreate, executeTaskCancel } from '../components/taskActionHelpers'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  getChapterShotEditPath,
  getChapterShotsPath,
  getChapterStudioPath,
  getChapterTimelinePath,
} from '../project/ProjectWorkbench/routes'
import { useCancelableRelationTask } from '../project/ProjectWorkbench/chapterDivisionTasks'
import { useRelationTaskNotification } from '../components/taskNotificationHelpers'
import { useTaskPageContext } from '../components/taskPageContext'
import { createTaskSettledReloader } from '../components/taskResultHelpers'
import { TASK_COPY } from '../components/taskCopy'

const { Header, Content } = Layout
type ShotListFilter = 'all' | 'pending' | 'generating' | 'ready'

function getErrorMessage(e: unknown) {
  if (!e) return '请求失败'
  if (typeof e === 'string') return e
  if (typeof e === 'object') {
    const maybeAny = e as any
    const detail = maybeAny?.body?.detail ?? maybeAny?.detail
    if (typeof detail === 'string' && detail.trim()) return detail
    const msg = maybeAny?.message
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  return '请求失败'
}

function statusTag(status?: ShotStatus) {
  if (!status) return <span className="text-gray-400">—</span>
  const color = status === 'ready' ? 'success' : 'default'
  return <Tag color={color}>{status}</Tag>
}

type ShotPreparationState = {
  text: string
  color: string
  hint: string
}

type ShotRuntimeState = {
  has_active_tasks: boolean
  has_active_video_tasks: boolean
  has_active_prompt_tasks: boolean
  has_active_frame_tasks: boolean
  active_task_count: number
}

function getShotPreparationState(shot: ShotRead, runtime?: ShotRuntimeState): ShotPreparationState {
  if (runtime?.has_active_tasks) {
    return {
      text: '生成中',
      color: 'processing',
      hint: `当前镜头有 ${runtime.active_task_count} 个运行中任务`,
    }
  }
  if (shot.status === 'ready') {
    return {
      text: '已就绪',
      color: 'green',
      hint: shot.skip_extraction
        ? '当前镜头已标记为无需提取，可继续进入视频生成流程'
        : '信息提取已确认完成，可继续进入视频生成流程',
    }
  }
  return {
    text: '待确认',
    color: 'gold',
    hint: shot.skip_extraction
      ? '当前镜头已标记为无需提取，等待系统同步最新流程状态'
      : '请先完成信息提取确认，再进入视频生成流程',
  }
}

export function ChapterShotsPage() {
  const taskCopy = TASK_COPY.chapterDivision
  const navigate = useNavigate()
  const { projectId, chapterId } = useParams<{ projectId: string; chapterId: string }>()
  const [loading, setLoading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [shots, setShots] = useState<ShotRead[]>([])
  const [shotRuntimeMap, setShotRuntimeMap] = useState<Record<string, ShotRuntimeState>>({})
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [listFilter, setListFilter] = useState<ShotListFilter>('all')
  const [searchText, setSearchText] = useState('')
  const [chapterTitle, setChapterTitle] = useState<string>('')
  const [chapterIndex, setChapterIndex] = useState<number | null>(null)
  const [chapterRawText, setChapterRawText] = useState<string>('')
  const [chapterCondensedText, setChapterCondensedText] = useState<string>('')
  const [loadingChapter, setLoadingChapter] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [createForm] = Form.useForm<{ title: string; script_excerpt?: string }>()
  const [chapterDivisionTaskLoading, setChapterDivisionTaskLoading] = useState(false)

  const refresh = async () => {
    if (!chapterId) return
    setLoading(true)
    try {
      const [res, runtimeRes] = await Promise.all([
        StudioShotsService.listShotsApiV1StudioShotsGet({
          chapterId,
          page: 1,
          pageSize: 100,
          order: 'index',
          isDesc: false,
        }),
        StudioShotsService.listShotRuntimeSummaryApiV1StudioShotsRuntimeSummaryGet({
          chapterId,
        }),
      ])
      setShots(res.data?.items ?? [])
      const runtimeItems: ShotRuntimeSummaryRead[] = runtimeRes.data ?? []
      setShotRuntimeMap(
        Object.fromEntries(
          runtimeItems.map((item) => [
            item.shot_id,
            {
              has_active_tasks: item.has_active_tasks,
              has_active_video_tasks: item.has_active_video_tasks,
              has_active_prompt_tasks: item.has_active_prompt_tasks,
              has_active_frame_tasks: item.has_active_frame_tasks,
              active_task_count: item.active_task_count,
            },
          ]),
        ),
      )
      setSelectedRowKeys([])
    } catch {
      message.error('加载分镜失败')
    } finally {
      setLoading(false)
    }
  }

  const reloadShotsAfterTaskSettled = useCallback(createTaskSettledReloader(refresh), [refresh])
  const { task: chapterDivisionTask, settledTask: chapterDivisionSettledTask, trackTaskData, applyCancelData } = useCancelableRelationTask({
    enabled: !!chapterId,
    relationType: 'chapter_division',
    relationEntityId: chapterId,
    onTaskSettled: reloadShotsAfterTaskSettled,
  })
  useTaskPageContext(
    chapterId
      ? [
          {
            relationType: 'chapter_division',
            relationEntityId: chapterId,
          },
        ]
      : [],
  )

  useEffect(() => {
    setSelectedRowKeys([])
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId])

  useEffect(() => {
    if (!chapterId) return
    setLoadingChapter(true)
    StudioChaptersService.getChapterApiV1StudioChaptersChapterIdGet({ chapterId })
      .then((res) => {
        const c = res.data
        setChapterTitle(c?.title ?? '')
        setChapterIndex(typeof c?.index === 'number' ? c.index : null)
        setChapterRawText(c?.raw_text?.trim?.() ? c.raw_text.trim() : '')
        setChapterCondensedText(c?.condensed_text?.trim?.() ? c.condensed_text.trim() : '')
      })
      .catch(() => {
        message.error('章节加载失败')
      })
      .finally(() => {
        setLoadingChapter(false)
      })
  }, [chapterId])

  const filteredShots = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    const byWorkflow = shots.filter((s) => {
      const runtime = shotRuntimeMap[s.id]
      if (listFilter === 'generating') return Boolean(runtime?.has_active_tasks)
      if (listFilter === 'ready') return s.status === 'ready' && !runtime?.has_active_tasks
      if (listFilter === 'pending') return s.status !== 'ready' && !runtime?.has_active_tasks
      return true
    })
    if (!q) return byWorkflow
    return byWorkflow.filter((s) => {
      const title = String(s.title ?? '').toLowerCase()
      const ex = String(s.script_excerpt ?? '').toLowerCase()
      const idx = String(s.index)
      return title.includes(q) || ex.includes(q) || idx.includes(q)
    })
  }, [listFilter, searchText, shotRuntimeMap, shots])

  const shotFilterCounts = useMemo(
    () => ({
      all: shots.length,
      pending: shots.filter((s) => s.status !== 'ready' && !shotRuntimeMap[s.id]?.has_active_tasks).length,
      generating: shots.filter((s) => Boolean(shotRuntimeMap[s.id]?.has_active_tasks)).length,
      ready: shots.filter((s) => s.status === 'ready' && !shotRuntimeMap[s.id]?.has_active_tasks).length,
    }),
    [shotRuntimeMap, shots],
  )

  const selectedShotIds = useMemo(() => selectedRowKeys.map((k) => String(k)), [selectedRowKeys])

  const openCreate = useCallback(() => {
    createForm.resetFields()
    setCreateOpen(true)
  }, [createForm])

  const closeCreate = useCallback(() => {
    setCreateOpen(false)
    createForm.resetFields()
  }, [createForm])

  const submitCreate = useCallback(async () => {
    if (!chapterId) return
    try {
      const v = await createForm.validateFields()
      setCreateSubmitting(true)
      const nextIndex = shots.reduce((m, s) => Math.max(m, s.index), 0) + 1
      const res = await StudioShotsService.createShotApiV1StudioShotsPost({
        requestBody: {
          id: crypto.randomUUID(),
          chapter_id: chapterId,
          index: nextIndex,
          title: v.title.trim(),
          script_excerpt: v.script_excerpt?.trim() ? v.script_excerpt.trim() : '',
          status: 'pending',
        },
      })
      const created = res.data
      if (created) {
        setShots((prev) => [...prev, created].sort((a, b) => a.index - b.index))
        message.success('已创建分镜')
        closeCreate()
      }
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      message.error('创建失败')
    } finally {
      setCreateSubmitting(false)
    }
  }, [chapterId, closeCreate, createForm, shots])

  const handleOneClickExtract = useCallback(async () => {
    if (!chapterId) return
    const scriptText = (chapterCondensedText || chapterRawText).trim()
    if (!scriptText) {
      message.error('章节没有可用文本（condensed/raw 为空）')
      return
    }
    setExtracting(true)
    try {
      await executeAsyncTaskCreate({
        request: () =>
          ScriptProcessingService.divideScriptAsyncApiV1ScriptProcessingDivideAsyncPost({
            requestBody: {
              script_text: scriptText,
              write_to_db: true,
              chapter_id: chapterId,
            },
          }),
        trackTaskData,
        startedMessage: taskCopy.startedMessage,
        reusedMessage: taskCopy.reusedMessage,
        fallbackErrorMessage: '启动分镜提取失败',
        getErrorMessage: (error) => getErrorMessage(error),
      })
    } catch {
      // executeAsyncTaskCreate 已统一处理错误提示
    } finally {
      setExtracting(false)
    }
  }, [chapterCondensedText, chapterId, chapterRawText])

  const handleCancelChapterDivisionTask = useCallback(async () => {
    if (!chapterDivisionTask) return
    setChapterDivisionTaskLoading(true)
    try {
      await executeTaskCancel({
        taskId: chapterDivisionTask.taskId,
        reason: '用户在分镜列表页取消分镜提取',
        applyCancelData,
        cancelledImmediatelyMessage: taskCopy.cancelledImmediatelyMessage,
        cancelRequestedMessage: taskCopy.cancelRequestedMessage,
        fallbackErrorMessage: '取消任务失败',
      })
    } catch {
      // executeTaskCancel 已统一处理错误提示
    } finally {
      setChapterDivisionTaskLoading(false)
    }
  }, [chapterDivisionTask])

  useRelationTaskNotification({
    task: chapterDivisionTask,
    settledTask: chapterDivisionSettledTask,
    title: taskCopy.title,
    sourceLabel: chapterTitle ? `章节：${chapterTitle}` : '分镜管理页',
    runningDescription: taskCopy.runningDescription,
    cancellingDescription: taskCopy.cancellingDescription,
    successDescription: taskCopy.successDescription,
    cancelledDescription: taskCopy.cancelledDescription,
    failedDescription: taskCopy.failedDescription,
    onCancel: chapterDivisionTask ? () => void handleCancelChapterDivisionTask() : null,
    onNavigate:
      projectId && chapterId
        ? () => navigate(getChapterShotsPath(projectId, chapterId))
        : null,
  })

  const handleDelete = useCallback(
    async (shotId: string) => {
      setDeletingId(shotId)
      try {
        await StudioShotsService.deleteShotApiV1StudioShotsShotIdDelete({ shotId })
        setShots((prev) => prev.filter((s) => s.id !== shotId))
        setSelectedRowKeys((prev) => prev.filter((k) => String(k) !== shotId))
        message.success('已删除')
      } catch {
        message.error('删除失败')
      } finally {
        setDeletingId(null)
      }
    },
    [],
  )

  const handleBatchDelete = useCallback(async () => {
    if (selectedShotIds.length === 0) return
    const ids = [...selectedShotIds]

    setBatchDeleting(true)
    let ok = 0
    let fail = 0
    try {
      for (const id of ids) {
        try {
          await StudioShotsService.deleteShotApiV1StudioShotsShotIdDelete({ shotId: id })
          ok += 1
          setShots((prev) => prev.filter((s) => s.id !== id))
          setSelectedRowKeys((prev) => prev.filter((k) => String(k) !== id))
        } catch {
          fail += 1
        }
      }
    } finally {
      setBatchDeleting(false)
    }

    if (ok > 0 && fail === 0) {
      message.success(`已删除 ${ok} 条`)
    } else if (ok > 0 && fail > 0) {
      message.warning(`已删除 ${ok} 条，失败 ${fail} 条`)
    } else if (ok === 0 && fail > 0) {
      message.error(`删除失败（共 ${fail} 条）`)
    }
  }, [selectedShotIds])

  const handleOpenSelectedInStudio = useCallback(() => {
    if (!projectId || !chapterId || selectedShotIds.length === 0) return
    navigate(getChapterStudioPath(projectId, chapterId), {
      state: {
        focusShotId: selectedShotIds[0],
        selectedShotIds,
      },
    })
  }, [chapterId, navigate, projectId, selectedShotIds])

  const columns: TableColumnsType<ShotRead> = useMemo(
    () => [
      {
        title: '序号',
        dataIndex: 'index',
        key: 'index',
        width: 72,
        align: 'center',
      },
      {
        title: '标题',
        dataIndex: 'title',
        key: 'title',
        width: 200,
        ellipsis: { showTitle: false },
        render: (t: string) => {
          const text = t?.trim() ? t : '—'
          return (
            <Tooltip title={text}>
              <span>{text}</span>
            </Tooltip>
          )
        },
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 120,
        render: (_: unknown, r) => statusTag(r.status),
      },
      {
        title: '准备度',
        key: 'preparation',
        width: 168,
        render: (_: unknown, r) => {
          const state = getShotPreparationState(r, shotRuntimeMap[r.id])
          return (
            <div className="space-y-1">
              <Tag color={state.color}>{state.text}</Tag>
              <div className="text-[11px] text-gray-500 leading-5">{state.hint}</div>
            </div>
          )
        },
      },
      {
        title: '剧本摘录',
        dataIndex: 'script_excerpt',
        key: 'script_excerpt',
        width: 280,
        ellipsis: { showTitle: false },
        render: (v: string | undefined) => {
          const raw = v?.trim() ?? ''
          const display = raw || '—'
          return (
            <Tooltip title={raw ? raw : undefined} placement="topLeft">
              <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{display}</span>
            </Tooltip>
          )
        },
      },
      {
        title: '操作',
        key: 'actions',
        width: 170,
        render: (_: unknown, r) => (
          <Space size={0} wrap>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              disabled={extracting}
              loading={extracting}
              onClick={() =>
                projectId &&
                chapterId &&
                navigate(getChapterShotEditPath(projectId, chapterId, r.id))
              }
            >
              编辑
            </Button>
            <Popconfirm
              title="确定删除该分镜？"
              okText="删除"
              cancelText="取消"
              onConfirm={() => void handleDelete(r.id)}
              okButtonProps={{ loading: extracting || deletingId === r.id, disabled: extracting }}
              cancelButtonProps={{ disabled: extracting }}
            >
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={extracting || deletingId === r.id}
                disabled={extracting}
              >
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [chapterId, deletingId, extracting, handleDelete, navigate, projectId, shotRuntimeMap],
  )

  const tableEmpty =
    !loading && shots.length === 0 ? (
      <Empty description="暂无分镜" />
    ) : !loading && filteredShots.length === 0 ? (
      <Empty description="没有匹配的分镜" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    ) : undefined

  const tableScrollY = 'calc(100vh - 320px)'

  if (!projectId || !chapterId) {
    return <Navigate to="/projects" replace />
  }

  return (
    <Layout style={{ height: '100%', minHeight: 0, background: '#eef2f7' }}>
      <Header
        style={{
          padding: '0 16px',
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Link
          to={`/projects/${projectId}?tab=chapters`}
          className="text-gray-600 hover:text-blue-600 flex items-center gap-1"
        >
          <ArrowLeftOutlined /> 返回章节列表
        </Link>
        <Divider type="vertical" />

        <div className="min-w-0 flex-1 overflow-hidden">
          <Typography.Text
            strong
            className="truncate block"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {chapterIndex !== null ? `第${chapterIndex}章 · ${chapterTitle || '未命名'}` : chapterTitle || '章节'}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            className="text-xs truncate block"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {loadingChapter ? '加载中…' : '分镜列表'}
          </Typography.Text>
        </div>

        <Space>
          <Button
            icon={<ScissorOutlined />}
            onClick={() => navigate(getChapterTimelinePath(projectId, chapterId))}
          >
            章节剪辑
          </Button>
          {shots.length > 0 ? (
            <>
              <Button
                type="primary"
                icon={<FileSearchOutlined />}
                onClick={() => navigate(getChapterStudioPath(projectId, chapterId))}
              >
                进入分镜工作室
              </Button>
              <Button
                icon={<VideoCameraOutlined />}
                onClick={() => navigate(getChapterStudioPath(projectId, chapterId))}
              >
                继续当前镜头
              </Button>
            </>
          ) : null}
        </Space>
      </Header>

      <Content
        style={{
          padding: 16,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Card
          title={
            <div className="flex flex-wrap items-center gap-3">
              <span>分镜</span>
              {shots.length > 0 ? (
                <Tag color="warning" className="!mr-0">
                  当前章节已存在分镜，若要重新提取，请先删除现有分镜
                </Tag>
              ) : null}
            </div>
          }
          style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          bodyStyle={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            padding: 16,
          }}
          extra={
            <Space wrap>
              {selectedRowKeys.length > 0 ? (
                <>
                  <span className="text-gray-500 text-sm">已选 {selectedRowKeys.length} 项</span>
                  <Popconfirm
                    title={`确定删除选中的 ${selectedRowKeys.length} 条分镜？`}
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => void handleBatchDelete()}
                    okButtonProps={{ danger: true, loading: batchDeleting, disabled: extracting || batchDeleting }}
                    cancelButtonProps={{ disabled: extracting || batchDeleting }}
                  >
                    <Button danger icon={<DeleteOutlined />} loading={batchDeleting} disabled={extracting || batchDeleting}>
                      批量删除
                    </Button>
                  </Popconfirm>
                </>
              ) : null}
              <Tooltip
                title={
                  chapterDivisionTask
                    ? '当前章节已有分镜提取任务在运行'
                    : shots.length > 0
                      ? '已存在分镜时不允许同步分镜，需先清空分镜'
                      : undefined
                }
              >
                <span>
                  <Button
                    type={shots.length === 0 ? 'primary' : 'default'}
                    icon={<ScissorOutlined />}
                    loading={extracting}
                    disabled={extracting || shots.length > 0 || !!chapterDivisionTask}
                    onClick={() => void handleOneClickExtract()}
                  >
                    {chapterDivisionTask ? '分镜提取中' : shots.length === 0 ? '一键提取分镜' : '重新提取需先清空分镜'}
                  </Button>
                </span>
              </Tooltip>
              <Button icon={<PlusOutlined />} onClick={openCreate} loading={extracting} disabled={extracting}>
                创建分镜
              </Button>
              <Button
                icon={<ReloadOutlined />}
                loading={extracting || loading}
                disabled={extracting || batchDeleting}
                onClick={() => void refresh()}
              >
                刷新
              </Button>
              {chapterDivisionTask ? (
                <Button
                  danger
                  icon={<CloseCircleOutlined />}
                  loading={chapterDivisionTaskLoading}
                  disabled={chapterDivisionTask.cancelRequested || chapterDivisionTaskLoading}
                  onClick={() => void handleCancelChapterDivisionTask()}
                >
                  {chapterDivisionTask.cancelRequested ? '正在取消' : '取消提取'}
                </Button>
              ) : null}
            </Space>
          }
        >
          <div className="flex flex-col gap-3 flex-1 min-h-0">
            <Input.Search
              allowClear
              placeholder="搜索序号、标题或剧本摘录…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Segmented
                size="small"
                value={listFilter}
                onChange={(value) => setListFilter(value as ShotListFilter)}
                options={[
                  { label: `全部 ${shotFilterCounts.all}`, value: 'all' },
                  { label: `待确认 ${shotFilterCounts.pending}`, value: 'pending' },
                  { label: `生成中 ${shotFilterCounts.generating}`, value: 'generating' },
                  { label: `已就绪 ${shotFilterCounts.ready}`, value: 'ready' },
                ]}
              />
              {selectedRowKeys.length > 0 ? (
                <Space size="small" wrap>
                  <Button
                    icon={<FileSearchOutlined />}
                    disabled={extracting || batchDeleting}
                    onClick={handleOpenSelectedInStudio}
                  >
                    处理首个已选
                  </Button>
                  <Button
                    type="text"
                    disabled={extracting || batchDeleting}
                    onClick={() => setSelectedRowKeys([])}
                  >
                    清空选择
                  </Button>
                </Space>
              ) : null}
            </div>
            <div className="flex-1 min-h-0">
              <Table<ShotRead>
                rowKey="id"
                size="small"
                loading={loading}
                rowSelection={{
                  selectedRowKeys,
                  onChange: (keys) => setSelectedRowKeys(keys),
                  getCheckboxProps: () => ({
                    disabled: extracting || batchDeleting,
                  }),
                }}
                columns={columns}
                dataSource={filteredShots}
                pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }}
                scroll={{ x: 1180, y: tableScrollY }}
                locale={{
                  emptyText: tableEmpty ?? <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
                }}
              />
            </div>
          </div>
        </Card>
      </Content>

      <Modal
        title="创建分镜"
        open={createOpen}
        onCancel={extracting ? undefined : closeCreate}
        onOk={() => void submitCreate()}
        confirmLoading={extracting || createSubmitting}
        okButtonProps={{ loading: extracting || createSubmitting, disabled: extracting }}
        cancelButtonProps={{ disabled: extracting }}
        closable={!extracting}
        maskClosable={!extracting}
        keyboard={!extracting}
        destroyOnClose
        width={520}
      >
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请填写标题' }]}>
            <Input placeholder="分镜标题" />
          </Form.Item>
          <Form.Item name="script_excerpt" label="剧本摘录">
            <Input.TextArea rows={8} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

    </Layout>
  )
}
