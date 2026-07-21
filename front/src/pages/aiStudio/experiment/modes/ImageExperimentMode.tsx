/**
 * 图片实验室模态。
 *
 * 该组件只处理图片生成特有的输入、异步任务和结果呈现；会话选择及页面布局由
 * ExperimentLabPage 统一维护，从而避免图片实验室继续作为独立页面存在。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Dropdown, Empty, Modal, Spin, Tag, Upload, message } from 'antd'
import { ClearOutlined, CloseOutlined, FolderOpenOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import {
  FilmService,
  LlmService,
  StudioFilesService,
  StudioImageLabService,
  StudioPromptsService,
  type ExperimentMessageRead,
  type ExperimentSessionRead,
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

const imagePromptCategories = ['frame_head_image', 'frame_tail_image', 'frame_key_image', 'character_image', 'actor_image', 'prop_image', 'scene_image_front', 'scene_image_other', 'costume_image'] as const

const imagePromptCategoryLabels: Record<string, string> = {
  frame_head_image: '首帧图片', frame_tail_image: '尾帧图片', frame_key_image: '关键帧图片',
  character_image: '角色设定图', actor_image: '演员设定图', prop_image: '道具展示图',
  scene_image_front: '场景正面图片', scene_image_other: '场景侧面/背面图片', costume_image: '服装展示图',
}

type ImageLabMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  taskId?: string
  status?: string
  resultUrls?: string[]
  error?: string
  referenceFileIds?: string[]
}

export type ImageExperimentModeProps = {
  /** 当前已持久化会话；为空时表示图片草稿。 */
  sessionId?: string
  /** 在首条有效提交前创建图片会话。 */
  ensureSession: (labType: ExperimentLabType) => Promise<ExperimentSessionRead>
  /** 清空服务端消息，仍由统一页面的共享会话层执行。 */
  clearSessionMessages?: (sessionId: string) => Promise<void>
  /** 由统一页面壳将模态内容装配进布局。 */
  render: (slots: { history: ReactNode; composer: ReactNode; extra: ReactNode; overlays: ReactNode; disabled: boolean }) => ReactNode
}

/** 将图片任务结果转换为浏览器可直接预览的 URL。 */
function extractImageUrls(result: Record<string, unknown> | null | undefined): string[] {
  const fileId = result?.file_id
  if (typeof fileId === 'string') {
    const url = buildFileDownloadUrl(fileId)
    if (url) return [url]
  }
  const images = result && Array.isArray(result.images) ? result.images : []
  return images.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const image = item as { url?: unknown; b64_json?: unknown }
    if (typeof image.url === 'string' && image.url) return [image.url]
    return typeof image.b64_json === 'string' && image.b64_json ? [`data:image/png;base64,${image.b64_json}`] : []
  })
}

/** 将原始持久化消息解析为图片任务气泡需要的视图数据。 */
function toImageLabMessage(item: ExperimentMessageRead): ImageLabMessage {
  const payload = item.payload ?? {}
  return {
    id: item.id, role: item.role === 'user' ? 'user' : 'assistant', content: item.content ?? '',
    taskId: item.task_id ?? undefined, status: item.status ?? undefined,
    resultUrls: extractImageUrls(payload.result as Record<string, unknown> | undefined),
    error: typeof payload.error === 'string' ? payload.error : undefined,
    referenceFileIds: Array.isArray(payload.reference_file_ids)
      ? payload.reference_file_ids.filter((id): id is string => typeof id === 'string') : [],
  }
}

/**
 * 呈现图片生成实验的历史、参考图输入和异步任务结果。
 *
 * 会话 ID 在首次提交成功后由页面壳回写；本组件保留返回的 ID，确保创建任务后
 * 能立即刷新历史，避免等待路由状态更新造成空白。
 */
export function ImageExperimentMode({ sessionId, ensureSession, clearSessionMessages, render }: ImageExperimentModeProps) {
  const [activeSessionId, setActiveSessionId] = useState(sessionId)
  const [models, setModels] = useState<ModelRead[]>([])
  const [templates, setTemplates] = useState<PromptTemplateRead[]>([])
  const [files, setFiles] = useState<FileRead[]>([])
  const [modelId, setModelId] = useState<string>()
  const [templateId, setTemplateId] = useState<string>()
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [referenceFileIds, setReferenceFileIds] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [taskUpdates, setTaskUpdates] = useState<Record<string, Pick<ImageLabMessage, 'status' | 'error' | 'resultUrls'>>>({})
  const history = useExperimentHistory(activeSessionId)
  const { refresh: refreshHistory } = history
  const messages = history.messages.map((item) => {
    const messageItem = toImageLabMessage(item)
    return messageItem.taskId && taskUpdates[messageItem.taskId]
      ? { ...messageItem, ...taskUpdates[messageItem.taskId] }
      : messageItem
  })
  const selectedTemplate = useMemo(() => templates.find((item) => item.id === templateId) ?? null, [templateId, templates])
  const selectedReferences = useMemo(() => referenceFileIds.map((id) => files.find((file) => file.id === id)).filter((file): file is FileRead => Boolean(file)), [files, referenceFileIds])
  const currentPrompt = selectedTemplate ? renderPromptTemplate(selectedTemplate.content, templateValues).trim() : draft.trim()
  const runningTask = messages.find((item) => item.taskId && !['succeeded', 'failed', 'cancelled'].includes(item.status ?? 'pending'))

  useEffect(() => { setActiveSessionId(sessionId) }, [sessionId])
  useEffect(() => {
    void StudioFilesService.listFilesApiApiV1StudioFilesGet({ page: 1, pageSize: 100, order: 'updated_at', isDesc: true })
      .then((response) => setFiles((response.data?.items ?? []).filter((file) => file.type === 'image')))
      .catch(() => message.error('加载图片资料库失败'))
  }, [])

  /** 首次打开图片模型选择器时按需读取可用模型。 */
  const loadModels = async () => {
    if (models.length || modelsLoading) return
    setModelsLoading(true)
    try {
      const response = await LlmService.listModelsApiV1LlmModelsGet({ category: 'image', page: 1, pageSize: 100, order: 'updated_at', isDesc: true })
      const items = response.data?.items ?? []
      setModels(items)
      if (items.length === 1) setModelId(items[0].id)
    } catch { message.error('加载图片模型失败') } finally { setModelsLoading(false) }
  }

  /** 首次打开提示词选择器时并行读取图片提示词分类。 */
  const loadTemplates = async () => {
    if (templates.length || templatesLoading) return
    setTemplatesLoading(true)
    try {
      const responses = await Promise.all(imagePromptCategories.map((category) => StudioPromptsService.listPromptTemplatesApiV1StudioPromptsGet({ category, page: 1, pageSize: 100, order: 'updated_at', isDesc: true })))
      setTemplates(responses.flatMap((response) => response.data?.items ?? []))
    } catch { message.error('加载图片提示词失败') } finally { setTemplatesLoading(false) }
  }

  useEffect(() => {
    if (!runningTask?.taskId) return
    let cancelled = false
    const poll = async () => {
      try {
        const response = await FilmService.getTaskResultApiV1FilmTasksTaskIdResultGet({ taskId: runningTask.taskId! })
        const status = response.data?.status ?? 'pending'
        if (!cancelled) {
          setTaskUpdates((current) => ({
            ...current,
            [runningTask.taskId!]: {
              status,
              error: response.data?.error ?? undefined,
              resultUrls: status === 'succeeded' ? extractImageUrls(response.data?.result) : undefined,
            },
          }))
        }
        if (!cancelled && ['succeeded', 'failed', 'cancelled'].includes(status)) {
          if (status === 'failed') message.error(response.data?.error || '图片生成失败，请检查模型与供应商配置')
          await refreshHistory()
        }
      } catch { if (!cancelled) message.error('获取图片生成任务状态失败') }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [refreshHistory, runningTask?.taskId])

  /** 选择模板时初始化变量，保证模板输入与自由输入不会混用。 */
  const handleSelectTemplate = (nextTemplateId?: string) => {
    setTemplateId(nextTemplateId)
    const template = templates.find((item) => item.id === nextTemplateId)
    setTemplateValues(template ? createPromptTemplateValues(template) : {})
    if (template) setDraft('')
  }

  /** 上传图片并立即加入本轮参考图及资料库缓存。 */
  const handleUploadReference = async (file: UploadFile) => {
    if (!file.type?.startsWith('image/')) { message.warning('只能上传图片作为参考图'); return false }
    setUploading(true)
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: file as unknown as string } })
      const uploaded = response.data
      if (!uploaded) throw new Error('上传未返回文件信息')
      setFiles((current) => [uploaded, ...current.filter((item) => item.id !== uploaded.id)])
      setReferenceFileIds((current) => current.includes(uploaded.id) ? current : [...current, uploaded.id])
      message.success('参考图已上传')
    } catch { message.error('参考图上传失败') } finally { setUploading(false) }
    return false
  }

  /** 在首条有效输入前创建会话，再提交图片异步任务。 */
  const handleSubmit = async () => {
    if (!modelId) return message.warning('请选择图片模型')
    if (!currentPrompt) return message.warning(selectedTemplate ? '请填写模板变量，生成有效提示词' : '请输入图片提示词')
    setSubmitting(true)
    if (!selectedTemplate) setDraft('')
    try {
      const session = activeSessionId ? undefined : await ensureSession('image')
      const targetSessionId = session?.id ?? activeSessionId
      if (!targetSessionId) throw new Error('创建图片会话失败')
      setActiveSessionId(targetSessionId)
      const response = await StudioImageLabService.createImageLabTaskApiV1StudioImageLabTasksPost({ requestBody: { session_id: targetSessionId, model_id: modelId, prompt: currentPrompt, images: referenceFileIds } })
      if (!response.data?.task_id) throw new Error('创建图片任务失败')
      // 草稿首次提交时，activeSessionId 的更新会驱动 Hook 为新会话读取历史；
      // 已有会话才可直接使用当前 Hook 实例刷新，避免闭包仍指向旧草稿 ID。
      if (!session) await history.refresh()
      message.success('图片生成任务已创建')
    } catch { message.error('创建图片生成任务失败，请检查模型、参考图和服务配置') } finally { setSubmitting(false) }
  }

  /** 清空当前会话历史，并同步清除图片任务展示。 */
  const handleClear = async () => {
    if (!activeSessionId || !clearSessionMessages) return
    try { await clearSessionMessages(activeSessionId); await history.refresh() } catch { message.error('清空历史失败；含生成任务的会话不可清空') }
  }

  const disabled = submitting || Boolean(runningTask)
  const extra = <Button icon={<ClearOutlined />} disabled={!messages.length || disabled || !clearSessionMessages} onClick={() => void handleClear}>清空历史</Button>
  const historyContent = <>
    {history.loading ? <div className="h-72 flex items-center justify-center"><Spin /></div> : null}
    {history.hasMoreHistory ? <Button size="small" loading={history.loadingMore} onClick={() => void history.loadMore()}>加载更早消息</Button> : null}
    {!history.loading && !messages.length ? <ExperimentEmptyState description="选择图片模型并输入提示词，开始一轮图片实验" /> : null}
    <div className="space-y-4">
      {messages.map((item) => {
        const isUser = item.role === 'user'
        const isRunning = Boolean(item.taskId && !['succeeded', 'failed', 'cancelled'].includes(item.status ?? 'pending'))
        const statusText = item.status === 'succeeded' ? '已完成' : item.status === 'failed' ? '失败' : item.status === 'cancelled' ? '已取消' : '生成中'
        return <div key={item.id} className={isUser ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}>
          <Tag color={isUser ? 'blue' : item.status === 'failed' ? 'red' : 'green'}>{isUser ? '你' : '图片生成'}</Tag>
          <div className={`mt-1 rounded-lg px-3 py-2 ${isUser ? 'whitespace-pre-wrap bg-blue-50' : 'bg-gray-50'}`}>
            <div className="whitespace-pre-wrap">{item.content}</div>
            {isUser ? <ExperimentHistoryReferences files={files} references={(item.referenceFileIds ?? []).map((id) => ({ id, label: '参考图' }))} /> : null}
            {item.taskId ? <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">{isRunning ? <Spin size="small" /> : null}<span>任务状态：{statusText}</span></div> : null}
            {item.error ? <div className="mt-2 text-sm text-red-600">{item.error}</div> : null}
            {item.resultUrls?.length ? <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{item.resultUrls.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`生成结果 ${index + 1}`} className="w-full rounded-lg border border-gray-200 object-contain" />)}</div> : null}
          </div>
        </div>
      })}
    </div>
  </>
  const composer = <ExperimentComposer
      submitting={disabled} submitDisabled={disabled} submitLabel="生成图片" onSubmit={() => void handleSubmit()}
      options={<ExperimentOptionBar models={models.map((model) => ({ id: model.id, name: model.name }))} templates={templates.map((template) => ({ id: template.id, name: template.name, version: template.version, preview: template.preview, category: imagePromptCategoryLabels[template.category] }))} modelId={modelId} templateId={templateId} modelsLoading={modelsLoading} templatesLoading={templatesLoading} disabled={disabled} modelLabel="图片模型" modelPlaceholder="选择已登记的图片模型" onModelChange={setModelId} onTemplateChange={handleSelectTemplate} onModelOpenChange={(open) => { if (open) void loadModels() }} onTemplateOpenChange={(open) => { if (open) void loadTemplates() }} />}
      contextActions={<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 border-l border-slate-200 pl-2"><Dropdown trigger={['click']} disabled={uploading || disabled} dropdownRender={() => <div className="min-w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"><Upload className="block w-full" accept="image/*" showUploadList={false} beforeUpload={handleUploadReference} disabled={uploading || disabled}><Button type="text" block icon={<UploadOutlined />} loading={uploading} className="!justify-start">上传图片</Button></Upload><Button type="text" block icon={<FolderOpenOutlined />} className="!justify-start" onClick={() => setLibraryOpen(true)}>从资料库选择</Button></div>}><Button size="small" icon={<PictureOutlined />} loading={uploading}>参考图</Button></Dropdown>{selectedReferences.map((file) => <div key={file.id} className="group relative h-9 w-9 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm" title={file.name}><img src={buildFileDownloadUrl(file.id)} alt={file.name} className="h-full w-full object-cover" /><button type="button" aria-label={`移除参考图：${file.name}`} className="absolute inset-0 hidden items-center justify-center bg-slate-900/50 text-white group-hover:flex focus:flex" onClick={() => setReferenceFileIds((current) => current.filter((id) => id !== file.id))}><CloseOutlined /></button></div>)}{referenceFileIds.length ? <Button size="small" type="text" onClick={() => setReferenceFileIds([])} disabled={disabled}>清空</Button> : null}</div>}
    ><ExperimentPromptEditor template={selectedTemplate} templateValues={templateValues} draft={draft} placeholder="描述你想生成的图片…" minRows={5} disabled={disabled} onDraftChange={setDraft} onTemplateValuesChange={setTemplateValues} onUseFreeInput={(renderedPrompt) => { setTemplateId(undefined); setTemplateValues({}); setDraft(renderedPrompt) }} /></ExperimentComposer>
  const overlays = <Modal title="从资料库选择参考图" open={libraryOpen} onCancel={() => setLibraryOpen(false)} footer={<Button type="primary" onClick={() => setLibraryOpen(false)}>完成</Button>} width={820}><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{files.map((file) => { const selected = referenceFileIds.includes(file.id); return <button key={file.id} type="button" onClick={() => setReferenceFileIds((current) => selected ? current.filter((id) => id !== file.id) : [...current, file.id])} className={`overflow-hidden rounded border text-left ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}><img src={buildFileDownloadUrl(file.id)} alt={file.name} className="h-28 w-full object-cover" /><div className="truncate p-2 text-xs">{file.name}</div></button> })}</div>{!files.length ? <Empty description="资料库中暂无图片" /> : null}</Modal>
  return render({ history: historyContent, composer, extra, overlays, disabled })
}
