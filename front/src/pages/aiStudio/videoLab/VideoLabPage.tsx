/**
 * 视频生成实验室。
 *
 * 页面复用实验室通用布局与输入组件，允许用户为首帧、尾帧和关键帧分别选择图片，
 * 并以对话任务气泡展示独立视频生成的过程和结果。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Dropdown, Empty, Modal, Select, Spin, Tag, Upload, message } from 'antd'
import { ClearOutlined, CloseOutlined, FolderOpenOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import {
  FilmService,
  LlmService,
  StudioFilesService,
  StudioPromptsService,
  StudioVideoLabService,
  StudioExperimentSessionsService,
  type FileRead,
  type ModelRead,
  type PromptTemplateRead,
  type ExperimentMessageRead,
  type ExperimentSessionRead,
} from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { ExperimentComposer } from '../experiment/components/ExperimentComposer'
import { ExperimentEmptyState } from '../experiment/components/ExperimentEmptyState'
import { ExperimentLabLayout } from '../experiment/components/ExperimentLabLayout'
import { ExperimentOptionBar } from '../experiment/components/ExperimentOptionBar'
import { ExperimentPromptEditor } from '../experiment/components/ExperimentPromptEditor'
import { ExperimentSessionSidebar } from '../experiment/components/ExperimentSessionSidebar'
import { ExperimentHistoryReferences } from '../experiment/components/ExperimentHistoryReferences'
import { createPromptTemplateValues, renderPromptTemplate } from '../experiment/components/PromptTemplateForm'

type FrameSlot = 'first' | 'last' | 'key'
type VideoRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9'

type VideoLabMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  taskId?: string
  status?: string
  progress?: number
  videoUrl?: string
  error?: string
  ratio?: string
  frameFileIds?: Partial<Record<FrameSlot, string>>
}

const frameLabels: Record<FrameSlot, string> = { first: '首帧', last: '尾帧', key: '关键帧' }
const ratioOptions: VideoRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']

/** 从视频任务结果中优先读取资料库文件地址，再回退到供应商返回地址。 */
function extractVideoUrl(result: Record<string, unknown> | null | undefined): string | undefined {
  if (!result) return undefined
  if (typeof result.file_id === 'string' && result.file_id) return buildFileDownloadUrl(result.file_id)
  return typeof result.url === 'string' && result.url ? result.url : undefined
}

/** 将服务端持久化消息转换为视频实验室所需的展示快照。 */
function toVideoLabMessage(item: ExperimentMessageRead): VideoLabMessage {
  const payload = item.payload ?? {}
  const frameFileIds: Partial<Record<FrameSlot, string>> = {}
  const frameReferences = payload.frame_references
  if (frameReferences && typeof frameReferences === 'object') {
    const references = frameReferences as Record<string, unknown>
    if (typeof references.first_frame_file_id === 'string') frameFileIds.first = references.first_frame_file_id
    if (typeof references.last_frame_file_id === 'string') frameFileIds.last = references.last_frame_file_id
    if (Array.isArray(references.key_frame_file_ids) && typeof references.key_frame_file_ids[0] === 'string') frameFileIds.key = references.key_frame_file_ids[0]
  } else {
    ;(['first', 'last', 'key'] as FrameSlot[]).forEach((slot) => {
      const value = payload[`${slot}_frame_file_id`]
      if (typeof value === 'string') frameFileIds[slot] = value
    })
  }
  return {
    id: item.id,
    role: item.role === 'user' ? 'user' : 'assistant',
    content: item.content ?? '',
    taskId: item.task_id ?? undefined,
    status: item.status ?? undefined,
    progress: typeof payload.progress === 'number' ? payload.progress : undefined,
    videoUrl: extractVideoUrl(payload.result as Record<string, unknown> | undefined),
    error: typeof payload.error === 'string' ? payload.error : undefined,
    ratio: typeof payload.ratio === 'string' ? payload.ratio : undefined,
    frameFileIds,
  }
}

type FrameReferenceControlProps = {
  slot: FrameSlot
  file?: FileRead
  disabled: boolean
  uploading: boolean
  onUpload: (slot: FrameSlot, file: UploadFile) => Promise<boolean>
  onOpenLibrary: (slot: FrameSlot) => void
  onRemove: (slot: FrameSlot) => void
}

/** 呈现一个具名帧槽位，让上传和资料库选择保持在同一个下拉入口。 */
function FrameReferenceControl({ slot, file, disabled, uploading, onUpload, onOpenLibrary, onRemove }: FrameReferenceControlProps) {
  const label = frameLabels[slot]
  return (
    <div className="flex items-center gap-1">
      <Dropdown
        trigger={['click']}
        disabled={disabled}
        dropdownRender={() => (
          <div className="min-w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            <Upload className="block w-full" accept="image/*" showUploadList={false} beforeUpload={(nextFile) => onUpload(slot, nextFile)} disabled={disabled}>
              <Button type="text" block icon={<UploadOutlined />} loading={uploading} className="!justify-start">上传图片</Button>
            </Upload>
            <Button type="text" block icon={<FolderOpenOutlined />} className="!justify-start" onClick={() => onOpenLibrary(slot)}>从资料库选择</Button>
          </div>
        )}
      >
        <Button size="small" icon={<PictureOutlined />} loading={uploading}>{label}</Button>
      </Dropdown>
      {file ? <div className="group relative h-9 w-9 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm" title={`${label}：${file.name}`}>
        <img src={buildFileDownloadUrl(file.id)} alt={`${label}：${file.name}`} className="h-full w-full object-cover" />
        <button type="button" aria-label={`移除${label}：${file.name}`} className="absolute inset-0 hidden items-center justify-center bg-slate-900/50 text-white group-hover:flex focus:flex" onClick={() => onRemove(slot)}>
          <CloseOutlined />
        </button>
      </div> : null}
    </div>
  )
}

export default function VideoLabPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [models, setModels] = useState<ModelRead[]>([])
  const [templates, setTemplates] = useState<PromptTemplateRead[]>([])
  const [files, setFiles] = useState<FileRead[]>([])
  const [modelId, setModelId] = useState<string | undefined>()
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [ratio, setRatio] = useState<VideoRatio>('16:9')
  const [frameFileIds, setFrameFileIds] = useState<Partial<Record<FrameSlot, string>>>({})
  const [messages, setMessages] = useState<VideoLabMessage[]>([])
  const [sessions, setSessions] = useState<ExperimentSessionRead[]>([])
  const [sessionId, setSessionId] = useState<string>()
  const [historyPage, setHistoryPage] = useState(1)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [uploadingSlot, setUploadingSlot] = useState<FrameSlot | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [libraryTarget, setLibraryTarget] = useState<FrameSlot | null>(null)
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null)

  const selectedTemplate = useMemo(() => templates.find((template) => template.id === templateId) ?? null, [templateId, templates])
  const currentPrompt = selectedTemplate ? renderPromptTemplate(selectedTemplate.content, templateValues).trim() : draft.trim()
  const selectedFrames = useMemo(() => Object.fromEntries(
    (Object.entries(frameFileIds) as [FrameSlot, string][]).map(([slot, id]) => [slot, files.find((file) => file.id === id)]),
  ) as Partial<Record<FrameSlot, FileRead>>, [files, frameFileIds])
  const runningTask = messages.find((item) => item.taskId && !['succeeded', 'failed', 'cancelled'].includes(item.status ?? 'pending'))
  const controlsDisabled = submitting || Boolean(runningTask)

  useEffect(() => {
    /** 加载资料库图片；模型和提示词由各自的选择器按需读取。 */
    void StudioFilesService.listFilesApiApiV1StudioFilesGet({ page: 1, pageSize: 100, order: 'updated_at', isDesc: true })
      .then((response) => setFiles((response.data?.items ?? []).filter((file) => file.type === 'image')))
      .catch(() => message.error('加载视频资料库失败'))
  }, [])

  /** 首次展开模型选择器时读取视频模型。 */
  const loadModels = async () => {
    if (models.length || modelsLoading) return
    setModelsLoading(true)
    try { const response = await LlmService.listModelsApiV1LlmModelsGet({ category: 'video', page: 1, pageSize: 100, order: 'updated_at', isDesc: true }); const items = response.data?.items ?? []; setModels(items); if (items.length === 1) setModelId(items[0].id) } catch { message.error('加载视频模型失败') } finally { setModelsLoading(false) }
  }

  /** 首次展开提示词选择器时读取视频模板。 */
  const loadTemplates = async () => {
    if (templates.length || templatesLoading) return
    setTemplatesLoading(true)
    try { const response = await StudioPromptsService.listPromptTemplatesApiV1StudioPromptsGet({ category: 'video_prompt', page: 1, pageSize: 100, order: 'updated_at', isDesc: true }); setTemplates(response.data?.items ?? []) } catch { message.error('加载视频提示词失败') } finally { setTemplatesLoading(false) }
  }

  useEffect(() => {
    /** 加载最近视频实验会话；首次进入时创建独立空会话。 */
    const loadSessions = async () => {
      try {
        const responses = await Promise.all((['text', 'image', 'video'] as ExperimentSessionRead['lab_type'][]).map((labType) => StudioExperimentSessionsService.listExperimentSessionsApiV1StudioExperimentSessionsGet({ labType })))
        const items = responses.flatMap((response) => response.data ?? []).sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
        const current = items.find((item) => item.id === searchParams.get('session')) ?? items[0]
        setSessions(items)
        if (!current) { setSessionId(undefined); return }
        if (current.lab_type !== 'video') { navigate(`/${current.lab_type}-lab?session=${current.id}`, { replace: true }); return }
        setSessionId(current.id)
      } catch { message.error('加载视频会话失败') } finally { setSessionsLoading(false) }
    }
    void loadSessions()
    // 仅在页面挂载时恢复 URL 指定会话，避免 URL 回写覆盖草稿态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!sessionId || searchParams.get('session') === sessionId) return
    setSearchParams({ session: sessionId }, { replace: true })
  }, [searchParams, sessionId, setSearchParams])

  useEffect(() => {
    if (!sessionId) return
    const loadMessages = async () => {
      try {
        const response = await StudioExperimentSessionsService.listExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesGet({ sessionId, page: 1, pageSize: 50 })
        setMessages((response.data ?? []).map(toVideoLabMessage))
        setHistoryPage(1)
        setHasMoreHistory((response.data?.length ?? 0) === 50)
      } catch { message.error('加载视频历史失败') }
    }
    void loadMessages()
  }, [sessionId])

  /** 读取当前视频会话更早的一页历史。 */
  const loadMoreHistory = async () => {
    if (!sessionId || !hasMoreHistory) return
    const nextPage = historyPage + 1
    try {
      const response = await StudioExperimentSessionsService.listExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesGet({ sessionId, page: nextPage, pageSize: 50 })
      const older = (response.data ?? []).map(toVideoLabMessage)
      setMessages((current) => [...older, ...current])
      setHistoryPage(nextPage)
      setHasMoreHistory((response.data?.length ?? 0) === 50)
    } catch { message.error('加载更早历史失败') }
  }

  useEffect(() => {
    if (!runningTask?.taskId) return
    let cancelled = false
    const taskId = runningTask.taskId

    /** 轮询独立视频任务，并将状态、进度和成片回写到其任务气泡。 */
    const poll = async () => {
      try {
        const response = await FilmService.getTaskResultApiV1FilmTasksTaskIdResultGet({ taskId })
        if (cancelled) return
        const task = response.data
        const status = task?.status ?? 'pending'
        const error = task?.error ?? undefined
        setMessages((current) => current.map((item) => item.taskId === taskId
          ? { ...item, status, error, progress: task?.progress, videoUrl: status === 'succeeded' ? extractVideoUrl(task?.result) : item.videoUrl }
          : item))
        if (status === 'failed') message.error(error || '视频生成失败，请检查模型与供应商配置')
      } catch {
        if (!cancelled) message.error('获取视频生成任务状态失败')
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [runningTask?.taskId])

  /** 选择模板时重置变量，并清空自由输入避免两种来源混用。 */
  const handleSelectTemplate = (nextTemplateId?: string) => {
    setTemplateId(nextTemplateId)
    const template = templates.find((item) => item.id === nextTemplateId)
    setTemplateValues(template ? createPromptTemplateValues(template) : {})
    if (template) setDraft('')
  }

  /** 上传图片后将其绑定到指定帧槽位，同时刷新资料库可选项。 */
  const handleUploadFrame = async (slot: FrameSlot, file: UploadFile): Promise<boolean> => {
    if (!file.type?.startsWith('image/')) {
      message.warning('只能上传图片作为视频关键帧')
      return false
    }
    setUploadingSlot(slot)
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: file as unknown as string } })
      const uploaded = response.data
      if (!uploaded) throw new Error('上传未返回文件信息')
      setFiles((current) => [uploaded, ...current.filter((item) => item.id !== uploaded.id)])
      setFrameFileIds((current) => ({ ...current, [slot]: uploaded.id }))
      message.success(`${frameLabels[slot]}已上传`)
    } catch {
      message.error(`${frameLabels[slot]}上传失败`)
    } finally {
      setUploadingSlot(null)
    }
    return false
  }

  /** 为资料库中选定的图片指定帧语义。 */
  const selectLibraryFrame = (fileId: string) => {
    if (!libraryTarget) return
    setFrameFileIds((current) => ({ ...current, [libraryTarget]: fileId }))
  }

  /** 创建视频任务，并将用户输入和任务状态同步到历史消息流。 */
  const handleSubmit = async () => {
    if (!modelId) return message.warning('请选择视频模型')
    if (!currentPrompt) return message.warning(selectedTemplate ? '请填写模板变量，生成有效提示词' : '请输入视频提示词')
    if (!selectedTemplate) setDraft('')
    setSubmitting(true)
    try {
      const session = sessionId ? undefined : (await StudioExperimentSessionsService.createExperimentSessionApiV1StudioExperimentSessionsPost({ requestBody: { lab_type: 'video', title: '新视频会话' } })).data
      const activeSessionId = session?.id ?? sessionId
      if (!activeSessionId) throw new Error('创建视频会话失败')
      if (session) { setSessions((current) => [session, ...current]); setSessionId(session.id) }
      const response = await StudioVideoLabService.createVideoLabTaskApiV1StudioVideoLabTasksPost({
        requestBody: {
          session_id: activeSessionId, model_id: modelId,
          prompt: currentPrompt,
          ratio,
          frame_references: {
            first_frame_file_id: frameFileIds.first,
            last_frame_file_id: frameFileIds.last,
            key_frame_file_ids: frameFileIds.key ? [frameFileIds.key] : [],
          },
        },
      })
      const taskId = response.data?.task_id
      if (!taskId) throw new Error('创建视频任务失败')
      const history = await StudioExperimentSessionsService.listExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesGet({ sessionId: activeSessionId, page: 1, pageSize: 50 })
      setMessages((history.data ?? []).map(toVideoLabMessage))
      setHistoryPage(1)
      setHasMoreHistory((history.data?.length ?? 0) === 50)
      message.success('视频生成任务已创建')
    } catch {
      message.error('创建视频生成任务失败，请检查模型、关键帧和服务配置')
    } finally {
      setSubmitting(false)
    }
  }

  /** 进入指定模态的未持久化草稿态，首条有效提交时才创建会话。 */
  const handleCreateSession = (labType: ExperimentSessionRead['lab_type'] = 'video') => {
    if (labType !== 'video') { navigate(`/${labType}-lab`); return }
    setSessionId(undefined); setMessages([]); setFrameFileIds({}); setDraft(''); setTemplateId(undefined); setTemplateValues({}); setSearchParams({}, { replace: true })
  }

  /** 更新指定会话标题并同步统一最近会话列表。 */
  const handleRenameSession = async (targetSessionId: string, title: string) => {
    const response = await StudioExperimentSessionsService.updateExperimentSessionApiV1StudioExperimentSessionsSessionIdPatch({ sessionId: targetSessionId, requestBody: { title } })
    const updated = response.data
    if (updated) setSessions((current) => current.map((item) => item.id === updated.id ? updated : item))
  }

  /** 删除指定会话后恢复全局最近历史；没有历史时回到文本草稿态。 */
  const handleDeleteSession = async (targetSessionId: string) => {
    await StudioExperimentSessionsService.deleteExperimentSessionApiV1StudioExperimentSessionsSessionIdDelete({ sessionId: targetSessionId })
    const remaining = sessions.filter((item) => item.id !== targetSessionId)
    setSessions(remaining)
    if (targetSessionId !== sessionId) return
    const next = remaining[0]
    if (next?.lab_type === 'video') setSessionId(next.id)
    else if (next) navigate(`/${next.lab_type}-lab?session=${next.id}`)
    else navigate('/text-lab')
  }

  /** 从统一最近会话列表切换；跨模态会话跳转到对应实验页面。 */
  const handleSelectSession = (session: ExperimentSessionRead) => {
    if (session.lab_type !== 'video') { navigate(`/${session.lab_type}-lab?session=${session.id}`); return }
    setSessionId(session.id)
  }

  return (
    <ExperimentLabLayout
      title="视频实验室"
      extra={<Button icon={<ClearOutlined />} disabled={!messages.length || controlsDisabled} onClick={() => { if (sessionId) void StudioExperimentSessionsService.clearExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesDelete({ sessionId }).then(() => setMessages([])).catch(() => message.error('清空历史失败；含生成任务的会话不可清空')) }}>清空历史</Button>}
      sidebar={<ExperimentSessionSidebar value={sessionId} sessions={sessions} disabled={controlsDisabled} onChange={handleSelectSession} onStartDraft={handleCreateSession} onRename={handleRenameSession} onDelete={handleDeleteSession} />}
      history={<>
        {sessionsLoading ? <div className="h-72 flex items-center justify-center"><Spin /></div> : null}
        {hasMoreHistory ? <Button size="small" onClick={() => void loadMoreHistory()}>加载更早消息</Button> : null}
        {!sessionsLoading && messages.length === 0 ? <ExperimentEmptyState description="选择视频模型并输入提示词，可按需添加首帧、尾帧或关键帧" /> : null}
        {messages.map((item) => {
          const isUser = item.role === 'user'
          const isRunning = Boolean(item.taskId && !['succeeded', 'failed', 'cancelled'].includes(item.status ?? 'pending'))
          const statusText = item.status === 'succeeded' ? '已完成' : item.status === 'failed' ? '失败' : item.status === 'cancelled' ? '已取消' : '生成中'
          return <div key={item.id} className={isUser ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}>
            <Tag color={isUser ? 'blue' : item.status === 'failed' ? 'red' : 'green'}>{isUser ? '你' : '视频生成'}</Tag>
            <div className={`mt-1 rounded-lg px-3 py-2 ${isUser ? 'whitespace-pre-wrap bg-blue-50' : 'bg-gray-50'}`}>
              <div className="whitespace-pre-wrap">{item.content}</div>
              {isUser ? <>
                <ExperimentHistoryReferences files={files} references={(['first', 'last', 'key'] as FrameSlot[]).flatMap((slot) => item.frameFileIds?.[slot] ? [{ id: item.frameFileIds[slot]!, label: frameLabels[slot] }] : [])} />
                {item.ratio ? <div className="mt-2 text-xs text-slate-500">画幅：{item.ratio}</div> : null}
              </> : null}
              {item.taskId ? <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">{isRunning ? <Spin size="small" /> : null}<span>任务状态：{statusText}{typeof item.progress === 'number' ? `（${item.progress}%）` : ''}</span></div> : null}
              {item.error ? <div className="mt-2 text-sm text-red-600">{item.error}</div> : null}
              {item.videoUrl ? <button type="button" className="group relative mt-3 block h-36 w-64 max-w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-900 text-left" onClick={() => { if (item.videoUrl) setPreviewVideoUrl(item.videoUrl) }} aria-label="打开视频预览">
                <video muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" className="pointer-events-none h-full w-full object-cover" src={item.videoUrl} onLoadedMetadata={(event) => { event.currentTarget.currentTime = 0.1 }}>视频缩略图</video>
                <span className="absolute inset-0 flex items-center justify-center bg-slate-950/25 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">点击预览</span>
              </button> : null}
            </div>
          </div>
        })}
      </>}
      composer={<ExperimentComposer
        submitting={submitting || Boolean(runningTask)}
        submitDisabled={controlsDisabled}
        submitLabel="生成视频"
        onSubmit={() => void handleSubmit()}
        options={<ExperimentOptionBar
          models={models.map((model) => ({ id: model.id, name: model.name }))}
          templates={templates.map((template) => ({ id: template.id, name: template.name, version: template.version, preview: template.preview, category: '视频提示词' }))}
          modelId={modelId}
          templateId={templateId}
          modelsLoading={modelsLoading}
          templatesLoading={templatesLoading}
          disabled={controlsDisabled}
          modelLabel="视频模型"
          modelPlaceholder="选择已登记的视频模型"
          onModelChange={setModelId}
          onTemplateChange={handleSelectTemplate}
          onModelOpenChange={(open) => { if (open) void loadModels() }}
          onTemplateOpenChange={(open) => { if (open) void loadTemplates() }}
        />}
        contextActions={<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 border-l border-slate-200 pl-2">
          {(['first', 'last', 'key'] as FrameSlot[]).map((slot) => <FrameReferenceControl key={slot} slot={slot} file={selectedFrames[slot]} disabled={controlsDisabled} uploading={uploadingSlot === slot} onUpload={handleUploadFrame} onOpenLibrary={setLibraryTarget} onRemove={(target) => setFrameFileIds((current) => ({ ...current, [target]: undefined }))} />)}
          <Select size="small" value={ratio} onChange={setRatio} disabled={controlsDisabled} options={ratioOptions.map((value) => ({ value, label: value }))} aria-label="视频比例" />
        </div>}
      >
        <ExperimentPromptEditor
          template={selectedTemplate}
          templateValues={templateValues}
          draft={draft}
          placeholder="描述你想生成的视频…"
          minRows={5}
          disabled={controlsDisabled}
          onDraftChange={setDraft}
          onTemplateValuesChange={setTemplateValues}
          onUseFreeInput={(renderedPrompt) => { setTemplateId(undefined); setTemplateValues({}); setDraft(renderedPrompt) }}
        />
      </ExperimentComposer>}
      overlays={<>
        <Modal title={libraryTarget ? `从资料库选择${frameLabels[libraryTarget]}` : '从资料库选择关键帧'} open={Boolean(libraryTarget)} onCancel={() => setLibraryTarget(null)} footer={<Button type="primary" onClick={() => setLibraryTarget(null)}>完成</Button>} width={820}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {files.map((file) => {
              const selected = libraryTarget ? frameFileIds[libraryTarget] === file.id : false
              return <button key={file.id} type="button" onClick={() => selectLibraryFrame(file.id)} className={`overflow-hidden rounded border text-left ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}>
                <img src={buildFileDownloadUrl(file.id)} alt={file.name} className="h-28 w-full object-cover" />
                <div className="truncate p-2 text-xs">{file.name}</div>
              </button>
            })}
          </div>
          {!files.length ? <Empty description="资料库中暂无图片" /> : null}
        </Modal>
        <Modal title="视频预览" open={Boolean(previewVideoUrl)} onCancel={() => setPreviewVideoUrl(null)} footer={null} destroyOnClose width={900}>
          {previewVideoUrl ? <video controls autoPlay preload="metadata" className="w-full rounded-lg bg-black" src={previewVideoUrl}>你的浏览器不支持视频预览。</video> : null}
        </Modal>
      </>}
    />
  )
}
