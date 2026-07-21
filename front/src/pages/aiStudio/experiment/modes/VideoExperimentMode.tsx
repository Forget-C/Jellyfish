/**
 * 视频实验室模态组件。
 *
 * 页面壳负责会话选择和布局；本组件只保留视频特有的帧输入、异步任务轮询和结果展示。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Dropdown, Empty, Modal, Select, Spin, Tag, Upload, message } from 'antd'
import { CloseOutlined, FolderOpenOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import {
  FilmService,
  LlmService,
  StudioFilesService,
  StudioPromptsService,
  StudioVideoLabService,
  type ExperimentMessageRead,
  type FileRead,
  type ModelRead,
  type PromptTemplateRead,
} from '../../../../services/generated'
import { buildFileDownloadUrl } from '../../assets/utils'
import { ExperimentComposer } from '../components/ExperimentComposer'
import { ExperimentEmptyState } from '../components/ExperimentEmptyState'
import { ExperimentHistoryReferences } from '../components/ExperimentHistoryReferences'
import { ExperimentOptionBar } from '../components/ExperimentOptionBar'
import { ExperimentPromptEditor } from '../components/ExperimentPromptEditor'
import { createPromptTemplateValues, renderPromptTemplate } from '../components/PromptTemplateForm'
import { useExperimentHistory } from '../hooks/useExperimentHistory'
import type { ExperimentLabType } from '../hooks/useExperimentSessions'

type FrameSlot = 'first' | 'last' | 'key'
type VideoRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9'
type VideoMessage = {
  id: string; role: 'user' | 'assistant'; content: string; taskId?: string; status?: string
  progress?: number; videoUrl?: string; error?: string; ratio?: string
  frameFileIds?: Partial<Record<FrameSlot, string>>
}

/**
 * 保存尚未被服务端历史确认的任务气泡，跨草稿首提后的路由重挂载保持可见。
 * 服务端返回相同 task_id 后会立即删除该缓存，避免本地和持久化消息重复展示。
 */
const pendingVideoMessagesBySession = new Map<string, VideoMessage[]>()

const frameLabels: Record<FrameSlot, string> = { first: '首帧', last: '尾帧', key: '关键帧' }
const ratioOptions: VideoRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']

/** 从任务结果中选择可播放的资料库文件或供应商视频地址。 */
function extractVideoUrl(result: Record<string, unknown> | null | undefined): string | undefined {
  if (!result) return undefined
  if (typeof result.file_id === 'string' && result.file_id) return buildFileDownloadUrl(result.file_id)
  return typeof result.url === 'string' && result.url ? result.url : undefined
}

/** 将通用持久化消息转换为视频展示模型。 */
function toVideoMessage(item: ExperimentMessageRead): VideoMessage {
  const payload = item.payload ?? {}
  const frameFileIds: Partial<Record<FrameSlot, string>> = {}
  ;(['first', 'last', 'key'] as FrameSlot[]).forEach((slot) => {
    const value = payload[`${slot}_frame_file_id`]
    if (typeof value === 'string') frameFileIds[slot] = value
  })
  return {
    id: item.id, role: item.role === 'user' ? 'user' : 'assistant', content: item.content ?? '',
    taskId: item.task_id ?? undefined, status: item.status ?? undefined,
    progress: typeof payload.progress === 'number' ? payload.progress : undefined,
    videoUrl: extractVideoUrl(payload.result as Record<string, unknown> | undefined),
    error: typeof payload.error === 'string' ? payload.error : undefined,
    ratio: typeof payload.ratio === 'string' ? payload.ratio : undefined, frameFileIds,
  }
}

type RenderParts = { history: ReactNode; composer: ReactNode; extra: ReactNode; overlays?: ReactNode; disabled?: boolean }
type VideoExperimentModeProps = {
  sessionId?: string
  ensureSession: (labType: ExperimentLabType) => Promise<{ id: string }>
  clearSessionMessages?: (sessionId: string) => Promise<void>
  render: (parts: RenderParts) => ReactNode
}

/** 以帧槽位为单位提供上传或从资料库选择图片的入口。 */
function FrameControl({ slot, file, disabled, uploading, onUpload, onOpenLibrary, onRemove }: {
  slot: FrameSlot; file?: FileRead; disabled: boolean; uploading: boolean
  onUpload: (slot: FrameSlot, file: UploadFile) => Promise<boolean>
  onOpenLibrary: (slot: FrameSlot) => void; onRemove: (slot: FrameSlot) => void
}) {
  const label = frameLabels[slot]
  return <div className="flex items-center gap-1">
    <Dropdown trigger={['click']} disabled={disabled} dropdownRender={() => <div className="min-w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
      <Upload className="block w-full" accept="image/*" showUploadList={false} disabled={disabled} beforeUpload={(nextFile) => onUpload(slot, nextFile)}>
        <Button type="text" block icon={<UploadOutlined />} loading={uploading} className="!justify-start">上传图片</Button>
      </Upload>
      <Button type="text" block icon={<FolderOpenOutlined />} className="!justify-start" onClick={() => onOpenLibrary(slot)}>从资料库选择</Button>
    </div>}>
      <Button size="small" icon={<PictureOutlined />} loading={uploading}>{label}</Button>
    </Dropdown>
    {file ? <div className="group relative h-9 w-9 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm" title={`${label}：${file.name}`}>
      <img src={buildFileDownloadUrl(file.id)} alt={`${label}：${file.name}`} className="h-full w-full object-cover" />
      <button type="button" aria-label={`移除${label}：${file.name}`} className="absolute inset-0 hidden items-center justify-center bg-slate-900/50 text-white group-hover:flex focus:flex" onClick={() => onRemove(slot)}><CloseOutlined /></button>
    </div> : null}
  </div>
}

/** 组合视频模态的输入、历史和任务轮询，并交给统一实验室页面壳渲染。 */
export function VideoExperimentMode({ sessionId, ensureSession, clearSessionMessages, render }: VideoExperimentModeProps) {
  const history = useExperimentHistory(sessionId)
  const [models, setModels] = useState<ModelRead[]>([])
  const [templates, setTemplates] = useState<PromptTemplateRead[]>([])
  const [files, setFiles] = useState<FileRead[]>([])
  const [modelId, setModelId] = useState<string>()
  const [templateId, setTemplateId] = useState<string>()
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [ratio, setRatio] = useState<VideoRatio>('16:9')
  const [frameFileIds, setFrameFileIds] = useState<Partial<Record<FrameSlot, string>>>({})
  const [modelsLoading, setModelsLoading] = useState(false)
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [uploadingSlot, setUploadingSlot] = useState<FrameSlot | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [libraryTarget, setLibraryTarget] = useState<FrameSlot | null>(null)
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null)
  const [updates, setUpdates] = useState<Record<string, Partial<VideoMessage>>>({})
  const [optimisticMessages, setOptimisticMessages] = useState<VideoMessage[]>(() => sessionId ? pendingVideoMessagesBySession.get(sessionId) ?? [] : [])

  useEffect(() => {
    /** 资料库图片支撑帧槽位；模型和模板保持按需加载。 */
    void StudioFilesService.listFilesApiApiV1StudioFilesGet({ page: 1, pageSize: 100, order: 'updated_at', isDesc: true })
      .then((response) => setFiles((response.data?.items ?? []).filter((file) => file.type === 'image')))
      .catch(() => message.error('加载视频资料库失败'))
  }, [])

  useEffect(() => {
    setOptimisticMessages(sessionId ? pendingVideoMessagesBySession.get(sessionId) ?? [] : [])
  }, [sessionId])
  useEffect(() => {
    if (!sessionId) return
    const persistedTaskIds = new Set(history.messages.flatMap((item) => item.task_id ? [item.task_id] : []))
    if (!persistedTaskIds.size) return
    setOptimisticMessages((current) => {
      const next = current.filter((item) => !item.taskId || !persistedTaskIds.has(item.taskId))
      pendingVideoMessagesBySession.set(sessionId, next)
      return next
    })
  }, [history.messages, sessionId])

  const selectedTemplate = useMemo(() => templates.find((item) => item.id === templateId) ?? null, [templateId, templates])
  const currentPrompt = selectedTemplate ? renderPromptTemplate(selectedTemplate.content, templateValues).trim() : draft.trim()
  const messages = useMemo(() => {
    const persisted = history.messages.map(toVideoMessage).map((item) => ({ ...item, ...updates[item.id] }))
    const persistedTaskIds = new Set(persisted.flatMap((item) => item.taskId ? [item.taskId] : []))
    return [...persisted, ...optimisticMessages.filter((item) => !item.taskId || !persistedTaskIds.has(item.taskId))]
  }, [history.messages, optimisticMessages, updates])
  const selectedFrames = useMemo(() => Object.fromEntries(Object.entries(frameFileIds).map(([slot, id]) => [slot, files.find((file) => file.id === id)])) as Partial<Record<FrameSlot, FileRead>>, [files, frameFileIds])
  const runningTask = messages.find((item) => item.taskId && !['succeeded', 'failed', 'cancelled'].includes(item.status ?? 'pending'))
  const disabled = submitting || Boolean(runningTask)

  /** 首次展开时加载视频模型，并在唯一候选时自动选中。 */
  const loadModels = async () => {
    if (models.length || modelsLoading) return
    setModelsLoading(true)
    try {
      const response = await LlmService.listModelsApiV1LlmModelsGet({ category: 'video', page: 1, pageSize: 100, order: 'updated_at', isDesc: true })
      const items = response.data?.items ?? []; setModels(items)
      if (items.length === 1) setModelId(items[0].id)
    } catch { message.error('加载视频模型失败') } finally { setModelsLoading(false) }
  }

  /** 首次展开时加载视频提示词模板。 */
  const loadTemplates = async () => {
    if (templates.length || templatesLoading) return
    setTemplatesLoading(true)
    try { const response = await StudioPromptsService.listPromptTemplatesApiV1StudioPromptsGet({ category: 'video_prompt', page: 1, pageSize: 100, order: 'updated_at', isDesc: true }); setTemplates(response.data?.items ?? []) } catch { message.error('加载视频提示词失败') } finally { setTemplatesLoading(false) }
  }

  useEffect(() => {
    if (!runningTask?.taskId) return
    let cancelled = false; const taskId = runningTask.taskId
    /** 轮询异步视频任务，并只覆盖该任务的瞬时显示字段。 */
    const poll = async () => {
      try {
        const response = await FilmService.getTaskResultApiV1FilmTasksTaskIdResultGet({ taskId })
        if (cancelled) return
        const task = response.data; const status = task?.status ?? 'pending'
        setUpdates((current) => ({ ...current, [runningTask.id]: { status, error: task?.error ?? undefined, progress: task?.progress, videoUrl: status === 'succeeded' ? extractVideoUrl(task?.result) : current[runningTask.id]?.videoUrl } }))
        if (status === 'failed') message.error(task?.error || '视频生成失败，请检查模型与供应商配置')
      } catch { if (!cancelled) message.error('获取视频生成任务状态失败') }
    }
    void poll(); const timer = window.setInterval(() => void poll(), 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [runningTask?.id, runningTask?.taskId])

  /** 上传图片并把返回的资料库文件绑定到选定帧槽位。 */
  const uploadFrame = async (slot: FrameSlot, file: UploadFile): Promise<boolean> => {
    if (!file.type?.startsWith('image/')) { message.warning('只能上传图片作为视频关键帧'); return false }
    setUploadingSlot(slot)
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: file as unknown as string } })
      const uploaded = response.data; if (!uploaded) throw new Error('上传未返回文件信息')
      setFiles((current) => [uploaded, ...current.filter((item) => item.id !== uploaded.id)])
      setFrameFileIds((current) => ({ ...current, [slot]: uploaded.id })); message.success(`${frameLabels[slot]}已上传`)
    } catch { message.error(`${frameLabels[slot]}上传失败`) } finally { setUploadingSlot(null) }
    return false
  }

  /** 先保证会话落库，再创建视频任务，避免草稿态产生空会话。 */
  const submit = async () => {
    if (!modelId) return message.warning('请选择视频模型')
    if (!currentPrompt) return message.warning(selectedTemplate ? '请填写模板变量，生成有效提示词' : '请输入视频提示词')
    if (!selectedTemplate) setDraft('')
    setSubmitting(true)
    try {
      const session = await ensureSession('video')
      const response = await StudioVideoLabService.createVideoLabTaskApiV1StudioVideoLabTasksPost({ requestBody: { session_id: session.id, model_id: modelId, prompt: currentPrompt, ratio, first_frame_file_id: frameFileIds.first, last_frame_file_id: frameFileIds.last, key_frame_file_id: frameFileIds.key } })
      if (!response.data?.task_id) throw new Error('创建视频任务失败')
      const optimistic = [
        { id: `local-user-${response.data.task_id}`, role: 'user' as const, content: currentPrompt, ratio, frameFileIds: { ...frameFileIds } },
        { id: `local-task-${response.data.task_id}`, role: 'assistant' as const, content: '视频生成任务已创建', taskId: response.data.task_id, status: 'pending' },
      ]
      // 先立即显示提交内容和生成占位；随后历史读取以 task_id 去重并接管展示。
      pendingVideoMessagesBySession.set(session.id, optimistic)
      setOptimisticMessages(optimistic)
      // 草稿首次提交会由页面壳更新 sessionId，随后 Hook 自动读取新会话历史；
      // 已持久化会话则立即刷新，保证新任务气泡无需等待下一次导航。
      if (sessionId) await history.refresh()
      message.success('视频生成任务已创建')
    } catch { message.error('创建视频生成任务失败，请检查模型、关键帧和服务配置') } finally { setSubmitting(false) }
  }

  /** 模板变更时初始化变量，并避免和自由输入混用。 */
  const selectTemplate = (nextId?: string) => {
    setTemplateId(nextId); const template = templates.find((item) => item.id === nextId)
    setTemplateValues(template ? createPromptTemplateValues(template) : {}); if (template) setDraft('')
  }

  const historyNode = <>
    {history.loading ? <div className="flex h-72 items-center justify-center"><Spin /></div> : null}
    {history.hasMoreHistory ? <Button size="small" loading={history.loadingMore} onClick={() => void history.loadMore()}>加载更早消息</Button> : null}
    {!history.loading && messages.length === 0 ? <ExperimentEmptyState description="选择视频模型并输入提示词，可按需添加首帧、尾帧或关键帧" /> : null}
    {messages.map((item) => {
      const isUser = item.role === 'user'; const isRunning = Boolean(item.taskId && !['succeeded', 'failed', 'cancelled'].includes(item.status ?? 'pending'))
      const statusText = item.status === 'succeeded' ? '已完成' : item.status === 'failed' ? '失败' : item.status === 'cancelled' ? '已取消' : '生成中'
      return <div key={item.id} className={isUser ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}>
        <Tag color={isUser ? 'blue' : item.status === 'failed' ? 'red' : 'green'}>{isUser ? '你' : '视频生成'}</Tag>
        <div className={`mt-1 rounded-lg px-3 py-2 ${isUser ? 'whitespace-pre-wrap bg-blue-50' : 'bg-gray-50'}`}>
          <div className="whitespace-pre-wrap">{item.content}</div>
          {isUser ? <><ExperimentHistoryReferences files={files} references={(['first', 'last', 'key'] as FrameSlot[]).flatMap((slot) => item.frameFileIds?.[slot] ? [{ id: item.frameFileIds[slot]!, label: frameLabels[slot] }] : [])} />{item.ratio ? <div className="mt-2 text-xs text-slate-500">画幅：{item.ratio}</div> : null}</> : null}
          {item.taskId ? <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">{isRunning ? <Spin size="small" /> : null}<span>任务状态：{statusText}{typeof item.progress === 'number' ? `（${item.progress}%）` : ''}</span></div> : null}
          {item.error ? <div className="mt-2 text-sm text-red-600">{item.error}</div> : null}
          {item.videoUrl ? <button type="button" className="group relative mt-3 block h-36 w-64 max-w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-900 text-left" onClick={() => setPreviewVideoUrl(item.videoUrl ?? null)} aria-label="打开视频预览"><video muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" className="pointer-events-none h-full w-full object-cover" src={item.videoUrl} onLoadedMetadata={(event) => { event.currentTarget.currentTime = 0.1 }}>视频缩略图</video><span className="absolute inset-0 flex items-center justify-center bg-slate-950/25 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">点击预览</span></button> : null}
        </div>
      </div>
    })}
  </>
  const composer = <ExperimentComposer submitting={disabled} submitDisabled={disabled} submitLabel="生成视频" onSubmit={() => void submit()} options={<ExperimentOptionBar models={models.map((item) => ({ id: item.id, name: item.name }))} templates={templates.map((item) => ({ id: item.id, name: item.name, version: item.version, preview: item.preview, category: '视频提示词' }))} modelId={modelId} templateId={templateId} modelsLoading={modelsLoading} templatesLoading={templatesLoading} disabled={disabled} modelLabel="视频模型" modelPlaceholder="选择已登记的视频模型" onModelChange={setModelId} onTemplateChange={selectTemplate} onModelOpenChange={(open) => { if (open) void loadModels() }} onTemplateOpenChange={(open) => { if (open) void loadTemplates() }} />} contextActions={<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 border-l border-slate-200 pl-2">{(['first', 'last', 'key'] as FrameSlot[]).map((slot) => <FrameControl key={slot} slot={slot} file={selectedFrames[slot]} disabled={disabled} uploading={uploadingSlot === slot} onUpload={uploadFrame} onOpenLibrary={setLibraryTarget} onRemove={(target) => setFrameFileIds((current) => ({ ...current, [target]: undefined }))} />)}<Select size="small" value={ratio} onChange={setRatio} disabled={disabled} options={ratioOptions.map((value) => ({ value, label: value }))} aria-label="视频比例" /></div>}><ExperimentPromptEditor template={selectedTemplate} templateValues={templateValues} draft={draft} placeholder="描述你想生成的视频…" minRows={5} disabled={disabled} onDraftChange={setDraft} onTemplateValuesChange={setTemplateValues} onUseFreeInput={(prompt) => { setTemplateId(undefined); setTemplateValues({}); setDraft(prompt) }} /></ExperimentComposer>
  const overlays = <><Modal title={libraryTarget ? `从资料库选择${frameLabels[libraryTarget]}` : '从资料库选择关键帧'} open={Boolean(libraryTarget)} onCancel={() => setLibraryTarget(null)} footer={<Button type="primary" onClick={() => setLibraryTarget(null)}>完成</Button>} width={820}><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{files.map((file) => <button key={file.id} type="button" onClick={() => { if (libraryTarget) setFrameFileIds((current) => ({ ...current, [libraryTarget]: file.id })) }} className={`overflow-hidden rounded border text-left ${libraryTarget && frameFileIds[libraryTarget] === file.id ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}><img src={buildFileDownloadUrl(file.id)} alt={file.name} className="h-28 w-full object-cover" /><div className="truncate p-2 text-xs">{file.name}</div></button>)}</div>{!files.length ? <Empty description="资料库中暂无图片" /> : null}</Modal><Modal title="视频预览" open={Boolean(previewVideoUrl)} onCancel={() => setPreviewVideoUrl(null)} footer={null} destroyOnClose width={900}>{previewVideoUrl ? <video controls autoPlay preload="metadata" className="w-full rounded-lg bg-black" src={previewVideoUrl}>你的浏览器不支持视频预览。</video> : null}</Modal></>
  const clearHistory = async () => {
    if (!sessionId || !clearSessionMessages) return
    try { await clearSessionMessages(sessionId); await history.refresh() } catch { message.error('清空历史失败；含生成任务的会话不可清空') }
  }
  const extra = <Button disabled={!messages.length || disabled || !clearSessionMessages} onClick={() => void clearHistory()}>清空历史</Button>
  return <>{render({ history: historyNode, composer, extra, overlays, disabled })}</>
}
