/**
 * 图片实验室模态。
 *
 * 该组件只处理图片生成特有的输入、异步任务和结果呈现；会话选择及页面布局由
 * ExperimentLabPage 统一维护，从而避免图片实验室继续作为独立页面存在。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Dropdown, Empty, Modal, Upload, message } from 'antd'
import { CloseOutlined, FolderOpenOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import {
  LlmService,
  StudioFilesService,
  StudioGenerationTasksService,
  StudioPromptsService,
  type ExperimentMessageRead,
  type ExperimentSessionRead,
  type FileRead,
  type ModelRead,
  type PromptTemplateRead,
  type TaskOutputRead,
} from '../../../../services/generated'
import { buildFileDownloadUrl } from '../../assets/utils'
import { ExperimentComposer } from '../components/ExperimentComposer'
import { ExperimentHistory } from '../components/ExperimentHistory'
import { ExperimentHistoryRestoreButton } from '../components/ExperimentHistoryRestoreButton'
import { ExperimentHistoryReferences } from '../components/ExperimentHistoryReferences'
import { ExperimentMessageBubble } from '../components/ExperimentMessageBubble'
import { ExperimentResultMedia } from '../components/ExperimentResultMedia'
import { ExperimentTaskStatus } from '../components/ExperimentTaskStatus'
import { useExperimentTaskResults } from '../hooks/useExperimentTaskResults'
import { ExperimentOptionBar } from '../components/ExperimentOptionBar'
import { ExperimentPromptEditor } from '../components/ExperimentPromptEditor'
import { createPromptTemplateValues, renderPromptTemplate } from '../components/PromptTemplateForm'
import { useExperimentHistory } from '../hooks/useExperimentHistory'
import { focusExperimentPromptEditor } from '../experimentInputSnapshot'
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
  progress?: number | null
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
  render: (slots: { history: ReactNode; composer: ReactNode; clearContent?: () => Promise<void>; overlays: ReactNode; disabled: boolean }) => ReactNode
}

/** 将图片任务结果转换为浏览器可直接预览的 URL。 */
function extractImageUrls(result: unknown, outputs?: TaskOutputRead[]): string[] {
  const data = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  const outputFiles = (outputs ?? []).filter((item) => item.media_type === 'image' && item.file_id)
    .sort((left, right) => left.ordinal - right.ordinal)
    .flatMap((item) => buildFileDownloadUrl(item.file_id) ?? [])
  if (outputFiles.length) return outputFiles
  const artifacts = Array.isArray(data.artifacts) ? data.artifacts : []
  const artifactFiles = artifacts.filter((item) => item?.modality === 'image' && typeof item.file_id === 'string')
    .sort((left, right) => (left.ordinal ?? 0) - (right.ordinal ?? 0))
    .flatMap((item) => buildFileDownloadUrl(item.file_id) ?? [])
  if (artifactFiles.length) return artifactFiles
  const fileId = data.primary_file_id ?? data.file_id
  if (typeof fileId === 'string') {
    const url = buildFileDownloadUrl(fileId)
    if (url) return [url]
  }
  const images = Array.isArray(data.images) ? data.images : []
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
    progress: typeof payload.progress === 'number' ? payload.progress : undefined,
    resultUrls: extractImageUrls(payload.result, Array.isArray(payload.outputs) ? payload.outputs : undefined),
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
  const history = useExperimentHistory(activeSessionId)
  const persistedMessages = history.messages.map(toImageLabMessage)
  const { reads, runningTaskId, retryStatus } = useExperimentTaskResults(persistedMessages, history.refresh)
  const messages = persistedMessages.map((item) => {
    const result = item.taskId ? reads[item.taskId]?.result : undefined
    if (!result) return item
    const resultUrls = result.status === 'succeeded' ? extractImageUrls(result.generation_delivery ?? result.result, result.outputs) : []
    return {
      ...item, status: result.status, progress: result.progress, error: result.error,
      resultUrls: resultUrls.length ? resultUrls : item.resultUrls,
    }
  })
  const selectedTemplate = useMemo(() => templates.find((item) => item.id === templateId) ?? null, [templateId, templates])
  const selectedReferences = useMemo(() => referenceFileIds.map((id) => files.find((file) => file.id === id)).filter((file): file is FileRead => Boolean(file)), [files, referenceFileIds])
  const currentPrompt = selectedTemplate ? renderPromptTemplate(selectedTemplate.content, templateValues).trim() : draft.trim()

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

  /** 在首条有效输入前创建会话，再经固定统一入口提交图片异步任务。 */
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
      const response = await StudioGenerationTasksService.submitImageLabGenerationTaskApiV1StudioGenerationTasksLabsImageSessionsSessionIdTasksPost({
        sessionId: targetSessionId,
        requestBody: {
          model_id: modelId,
          execution_prompt: currentPrompt,
          media: {
            references: referenceFileIds.map((fileId, ordinal) => ({ file_id: fileId, media_kind: 'image', ordinal })),
          },
          operation_input: { kind: 'image_generation' },
        },
      })
      const created = response.data
      if (!created?.task_id || !created.messages?.length) throw new Error('创建图片任务未返回正式消息')
      // 创建接口已在同一事务中返回正式 user/task 消息，直接接管，避免本地伪消息重复。
      history.adoptCanonicalMessages(targetSessionId, created.messages)
      message.success('图片生成任务已创建')
    } catch { message.error('创建图片生成任务失败，请检查模型、参考图和服务配置') } finally { setSubmitting(false) }
  }

  /** 清空当前会话历史，并同步清除图片任务展示。 */
  const handleClear = async () => {
    if (!activeSessionId || !clearSessionMessages) return
    await clearSessionMessages(activeSessionId)
    history.clearLocalHistory()
    await history.refresh()
  }

  /** 仅回填历史提示词；完整异步参数只保存在关联任务快照中。 */
  const restoreUserMessage = (item: ImageLabMessage) => {
    if (disabled) return
    setTemplateId(undefined)
    setTemplateValues({})
    setDraft(item.content)
    setReferenceFileIds([])
    focusExperimentPromptEditor()
    message.info('已回填提示词；请重新选择模型和参考图后生成')
  }

  const disabled = submitting || Boolean(runningTaskId)
  const clearContent = messages.length && !disabled && clearSessionMessages ? handleClear : undefined
  const historyContent = <ExperimentHistory key={activeSessionId ?? 'draft'} history={history} messageCount={messages.length} emptyDescription="选择图片模型并输入提示词，开始一轮图片实验">
    <div className="space-y-4">
      {messages.map((item) => {
        const isUser = item.role === 'user'
        return <ExperimentMessageBubble
          key={item.id}
          footer={isUser ? <ExperimentHistoryRestoreButton disabled={disabled} onRestore={() => restoreUserMessage(item)} /> : undefined}
          identity={isUser ? '你' : '图片生成'}
          status={item.taskId ? <ExperimentTaskStatus status={item.status} progress={item.progress} unavailable={reads[item.taskId]?.unavailable} onRetry={item.taskId === runningTaskId ? retryStatus : undefined} /> : null}
          tone={isUser ? 'user' : 'assistant'}
        >
            {isUser || item.content !== '图片生成任务已提交，正在等待生成结果。' ? item.content : null}
            {isUser ? <ExperimentHistoryReferences files={files} references={(item.referenceFileIds ?? []).map((id) => ({ id, label: '参考图' }))} /> : null}
            {item.error ? <div className="mt-2 text-sm text-red-600">{item.error}</div> : null}
            {item.resultUrls?.length ? <ExperimentResultMedia kind="image" urls={item.resultUrls} /> : null}
        </ExperimentMessageBubble>
      })}
    </div>
  </ExperimentHistory>
  const composer = <ExperimentComposer
      submitting={disabled} submitDisabled={disabled} submitLabel="生成图片" onSubmit={() => void handleSubmit()}
      options={<ExperimentOptionBar models={models.map((model) => ({ id: model.id, name: model.name }))} templates={templates.map((template) => ({ id: template.id, name: template.name, version: template.version, preview: template.preview, category: imagePromptCategoryLabels[template.category] }))} modelId={modelId} templateId={templateId} modelsLoading={modelsLoading} templatesLoading={templatesLoading} disabled={disabled} modelLabel="图片模型" modelPlaceholder="选择已登记的图片模型" onModelChange={setModelId} onTemplateChange={handleSelectTemplate} onModelOpenChange={(open) => { if (open) void loadModels() }} onTemplateOpenChange={(open) => { if (open) void loadTemplates() }} />}
      contextActions={<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2"><Dropdown trigger={['click']} disabled={uploading || disabled} dropdownRender={() => <div className="min-w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"><Upload className="block w-full" accept="image/*" showUploadList={false} beforeUpload={handleUploadReference} disabled={uploading || disabled}><Button type="text" block icon={<UploadOutlined />} loading={uploading} className="!justify-start">上传图片</Button></Upload><Button type="text" block icon={<FolderOpenOutlined />} className="!justify-start" onClick={() => setLibraryOpen(true)}>从资料库选择</Button></div>}><Button size="small" icon={<PictureOutlined />} loading={uploading}>参考图</Button></Dropdown>{selectedReferences.map((file) => <div key={file.id} className="group relative h-9 w-9 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm" title={file.name}><img src={buildFileDownloadUrl(file.id)} alt={file.name} className="h-full w-full object-cover" /><button type="button" aria-label={`移除参考图：${file.name}`} className="absolute inset-0 hidden items-center justify-center bg-slate-900/50 text-white group-hover:flex focus:flex" onClick={() => setReferenceFileIds((current) => current.filter((id) => id !== file.id))}><CloseOutlined /></button></div>)}{referenceFileIds.length ? <Button size="small" type="text" onClick={() => setReferenceFileIds([])} disabled={disabled}>清空</Button> : null}</div>}
    ><ExperimentPromptEditor template={selectedTemplate} templateValues={templateValues} draft={draft} placeholder="描述你想生成的图片…" label="图片提示词" disabled={disabled} onDraftChange={setDraft} onTemplateValuesChange={setTemplateValues} onUseFreeInput={(renderedPrompt) => { setTemplateId(undefined); setTemplateValues({}); setDraft(renderedPrompt) }} /></ExperimentComposer>
  const overlays = <Modal title="从资料库选择参考图" open={libraryOpen} onCancel={() => setLibraryOpen(false)} footer={<Button type="primary" onClick={() => setLibraryOpen(false)}>完成</Button>} width={820}><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{files.map((file) => { const selected = referenceFileIds.includes(file.id); return <button key={file.id} type="button" onClick={() => setReferenceFileIds((current) => selected ? current.filter((id) => id !== file.id) : [...current, file.id])} className={`overflow-hidden rounded border text-left ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}><img src={buildFileDownloadUrl(file.id)} alt={file.name} className="h-28 w-full object-cover" /><div className="truncate p-2 text-xs">{file.name}</div></button> })}</div>{!files.length ? <Empty description="资料库中暂无图片" /> : null}</Modal>
  return render({ history: historyContent, composer, clearContent, overlays, disabled })
}
