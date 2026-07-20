/**
 * 图片生成实验室。
 *
 * 页面用于在不绑定项目资产的情况下验证图片模型、图片提示词模板与参考图效果；
 * 上传和资料库图片都会先转换为 FileItem，再以 file_id 提交给后端任务。
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Dropdown, Empty, Modal, Spin, Tag, Upload, message } from 'antd'
import { ClearOutlined, CloseOutlined, FolderOpenOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import {
  FilmService,
  LlmService,
  StudioFilesService,
  StudioImageLabService,
  StudioExperimentSessionsService,
  StudioPromptsService,
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
import { ExperimentSessionControls } from '../experiment/components/ExperimentSessionControls'
import { ExperimentHistoryReferences } from '../experiment/components/ExperimentHistoryReferences'
import { createPromptTemplateValues, renderPromptTemplate } from '../experiment/components/PromptTemplateForm'

const imagePromptCategories = [
  'frame_head_image',
  'frame_tail_image',
  'frame_key_image',
  'character_image',
  'actor_image',
  'prop_image',
  'scene_image_front',
  'scene_image_other',
  'costume_image',
] as const

const imagePromptCategoryLabels: Record<string, string> = {
  frame_head_image: '首帧图片',
  frame_tail_image: '尾帧图片',
  frame_key_image: '关键帧图片',
  character_image: '角色设定图',
  actor_image: '演员设定图',
  prop_image: '道具展示图',
  scene_image_front: '场景正面图片',
  scene_image_other: '场景侧面/背面图片',
  costume_image: '服装展示图',
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

/** 将图片任务结果转换为浏览器可直接预览的 URL。 */
function extractImageUrls(result: Record<string, unknown> | null | undefined): string[] {
  const generatedFileId = result?.file_id
  const localUrl = typeof generatedFileId === 'string' ? buildFileDownloadUrl(generatedFileId) : undefined
  if (localUrl) return [localUrl]
  const images = result && Array.isArray(result.images) ? result.images : []
  return images.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const image = item as { url?: unknown; b64_json?: unknown }
    if (typeof image.url === 'string' && image.url) return [image.url]
    if (typeof image.b64_json === 'string' && image.b64_json) return [`data:image/png;base64,${image.b64_json}`]
    return []
  })
}

/** 将服务端持久化消息转换为图片实验室所需的展示快照。 */
function toImageLabMessage(item: ExperimentMessageRead): ImageLabMessage {
  const payload = item.payload ?? {}
  const referenceFileIds = Array.isArray(payload.reference_file_ids)
    ? payload.reference_file_ids.filter((value): value is string => typeof value === 'string')
    : []
  return {
    id: item.id,
    role: item.role === 'user' ? 'user' : 'assistant',
    content: item.content ?? '',
    taskId: item.task_id ?? undefined,
    status: item.status ?? undefined,
    resultUrls: extractImageUrls(payload.result as Record<string, unknown> | undefined),
    error: typeof payload.error === 'string' ? payload.error : undefined,
    referenceFileIds,
  }
}

export default function ImageLabPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [models, setModels] = useState<ModelRead[]>([])
  const [templates, setTemplates] = useState<PromptTemplateRead[]>([])
  const [files, setFiles] = useState<FileRead[]>([])
  const [modelId, setModelId] = useState<string | undefined>()
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [referenceFileIds, setReferenceFileIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [messages, setMessages] = useState<ImageLabMessage[]>([])
  const [sessions, setSessions] = useState<ExperimentSessionRead[]>([])
  const [sessionId, setSessionId] = useState<string>()
  const [historyPage, setHistoryPage] = useState(1)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templateId, templates],
  )
  const selectedReferences = useMemo(
    () => referenceFileIds.map((id) => files.find((file) => file.id === id)).filter((file): file is FileRead => Boolean(file)),
    [files, referenceFileIds],
  )
  const currentPrompt = selectedTemplate
    ? renderPromptTemplate(selectedTemplate.content, templateValues).trim()
    : draft.trim()
  const runningTask = messages.find((item) => item.taskId && !['succeeded', 'failed', 'cancelled'].includes(item.status ?? 'pending'))

  useEffect(() => {
    /** 加载图片实验可选择的模型、模板和资料库图片。 */
    const loadOptions = async () => {
      setLoading(true)
      try {
        const [modelsResponse, filesResponse, ...templateResponses] = await Promise.all([
          LlmService.listModelsApiV1LlmModelsGet({ category: 'image', page: 1, pageSize: 100, order: 'updated_at', isDesc: true }),
          StudioFilesService.listFilesApiApiV1StudioFilesGet({ page: 1, pageSize: 100, order: 'updated_at', isDesc: true }),
          ...imagePromptCategories.map((category) => StudioPromptsService.listPromptTemplatesApiV1StudioPromptsGet({
            category,
            page: 1,
            pageSize: 100,
            order: 'updated_at',
            isDesc: true,
          })),
        ])
        const imageModels = modelsResponse.data?.items ?? []
        setModels(imageModels)
        setFiles((filesResponse.data?.items ?? []).filter((file) => file.type === 'image'))
        setTemplates(templateResponses.flatMap((response) => response.data?.items ?? []))
        if (imageModels.length === 1) setModelId(imageModels[0].id)
      } catch {
        message.error('加载图片实验室配置失败')
      } finally {
        setLoading(false)
      }
    }
    void loadOptions()
  }, [])

  useEffect(() => {
    /** 加载最近图片实验会话；首次进入时创建独立空会话。 */
    const loadSessions = async () => {
      try {
        const response = await StudioExperimentSessionsService.listExperimentSessionsApiV1StudioExperimentSessionsGet({ labType: 'image' })
        const items = response.data ?? []
        const current = items.find((item) => item.id === searchParams.get('session')) ?? items[0] ?? (await StudioExperimentSessionsService.createExperimentSessionApiV1StudioExperimentSessionsPost({ requestBody: { lab_type: 'image', title: '新图片会话' } })).data
        if (!current) throw new Error('创建图片会话失败')
        setSessions(current.id === items[0]?.id ? items : [current, ...items])
        setSessionId(current.id)
      } catch { message.error('加载图片会话失败') }
    }
    void loadSessions()
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
        setMessages((response.data ?? []).map(toImageLabMessage))
        setHistoryPage(1)
        setHasMoreHistory((response.data?.length ?? 0) === 50)
      } catch { message.error('加载图片历史失败') }
    }
    void loadMessages()
  }, [sessionId])

  /** 读取当前图片会话更早的一页历史。 */
  const loadMoreHistory = async () => {
    if (!sessionId || !hasMoreHistory) return
    const nextPage = historyPage + 1
    try {
      const response = await StudioExperimentSessionsService.listExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesGet({ sessionId, page: nextPage, pageSize: 50 })
      const older = (response.data ?? []).map(toImageLabMessage)
      setMessages((current) => [...older, ...current])
      setHistoryPage(nextPage)
      setHasMoreHistory((response.data?.length ?? 0) === 50)
    } catch { message.error('加载更早历史失败') }
  }

  useEffect(() => {
    if (!runningTask?.taskId) return
    let cancelled = false
    const taskId = runningTask.taskId

    /** 将轮询到的任务结果回写到对应的历史任务气泡。 */
    const poll = async () => {
      try {
        const response = await FilmService.getTaskResultApiV1FilmTasksTaskIdResultGet({ taskId })
        if (cancelled) return
        const task = response.data
        const status = task?.status ?? 'pending'
        const error = task?.error ?? undefined
        setMessages((current) => current.map((item) => item.taskId === taskId
          ? { ...item, status, error, resultUrls: status === 'succeeded' ? extractImageUrls(task?.result) : item.resultUrls }
          : item))
        if (status === 'failed') message.error(error || '图片生成失败，请检查模型与供应商配置')
      } catch {
        if (!cancelled) message.error('获取图片生成任务状态失败')
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

  /** 上传图片后立即作为本轮参考图，同时加入本地资料库列表。 */
  const handleUploadReference = async (file: UploadFile) => {
    if (!file.type?.startsWith('image/')) {
      message.warning('只能上传图片作为参考图')
      return false
    }
    setUploading(true)
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({
        formData: { file: file as unknown as string },
      })
      const uploaded = response.data
      if (!uploaded) throw new Error('上传未返回文件信息')
      setFiles((current) => [uploaded, ...current.filter((item) => item.id !== uploaded.id)])
      setReferenceFileIds((current) => current.includes(uploaded.id) ? current : [...current, uploaded.id])
      message.success('参考图已上传')
    } catch {
      message.error('参考图上传失败')
    } finally {
      setUploading(false)
    }
    return false
  }

  /** 从资料库添加或移除参考图，维持提交顺序与界面顺序一致。 */
  const toggleReference = (fileId: string) => {
    setReferenceFileIds((current) => current.includes(fileId)
      ? current.filter((id) => id !== fileId)
      : [...current, fileId])
  }

  /** 创建图片任务，并由轮询逻辑持续显示运行状态与生成结果。 */
  const handleSubmit = async () => {
    if (!modelId) return message.warning('请选择图片模型')
    if (!currentPrompt) return message.warning(selectedTemplate ? '请填写模板变量，生成有效提示词' : '请输入图片提示词')
    if (!sessionId) return message.warning('会话尚未准备完成')
    setSubmitting(true)
    if (!selectedTemplate) setDraft('')
    try {
      const response = await StudioImageLabService.createImageLabTaskApiV1StudioImageLabTasksPost({
        requestBody: { session_id: sessionId, model_id: modelId, prompt: currentPrompt, images: referenceFileIds },
      })
      const nextTaskId = response.data?.task_id
      if (!nextTaskId) throw new Error('创建图片任务失败')
      const history = await StudioExperimentSessionsService.listExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesGet({ sessionId, page: 1, pageSize: 50 })
      setMessages((history.data ?? []).map(toImageLabMessage))
      setHistoryPage(1)
      setHasMoreHistory((history.data?.length ?? 0) === 50)
      message.success('图片生成任务已创建')
    } catch {
      message.error('创建图片生成任务失败，请检查模型、参考图和服务配置')
    } finally {
      setSubmitting(false)
    }
  }

  /** 清除图片生成对话与任务历史，使图片实验室与文本会话拥有相同的重置入口。 */
  const handleClearResults = () => {
    if (!sessionId) return
    void StudioExperimentSessionsService.clearExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesDelete({ sessionId })
      .then(() => setMessages([]))
      .catch(() => message.error('清空历史失败；含生成任务的会话不可清空'))
  }

  /** 创建并切换到空图片会话，不影响既有任务的后台执行。 */
  const handleCreateSession = async () => {
    try {
      const response = await StudioExperimentSessionsService.createExperimentSessionApiV1StudioExperimentSessionsPost({ requestBody: { lab_type: 'image', title: '新图片会话' } })
      const session = response.data
      if (!session) throw new Error('未返回会话')
      setSessions((current) => [session, ...current])
      setSessionId(session.id)
      setMessages([])
      setReferenceFileIds([])
    } catch { message.error('新建会话失败') }
  }

  /** 更新当前图片会话标题并同步列表。 */
  const handleRenameSession = async (title: string) => {
    if (!sessionId) return
    const response = await StudioExperimentSessionsService.updateExperimentSessionApiV1StudioExperimentSessionsSessionIdPatch({ sessionId, requestBody: { title } })
    const updated = response.data
    if (updated) setSessions((current) => current.map((item) => item.id === updated.id ? updated : item))
  }

  /** 删除当前图片会话后切换到最近剩余会话或创建空会话。 */
  const handleDeleteSession = async () => {
    if (!sessionId) return
    await StudioExperimentSessionsService.deleteExperimentSessionApiV1StudioExperimentSessionsSessionIdDelete({ sessionId })
    const remaining = sessions.filter((item) => item.id !== sessionId)
    setSessions(remaining)
    if (remaining[0]) setSessionId(remaining[0].id)
    else await handleCreateSession()
  }

  return (
    <ExperimentLabLayout
      title="图片实验室"
      extra={<div className="flex items-center gap-2"><ExperimentSessionControls value={sessionId} sessions={sessions} disabled={submitting || Boolean(runningTask)} onChange={setSessionId} onCreate={() => void handleCreateSession()} onRename={handleRenameSession} onDelete={handleDeleteSession} /><Button icon={<ClearOutlined />} disabled={!messages.length || submitting || Boolean(runningTask)} onClick={handleClearResults}>清空历史</Button></div>}
      history={<>
        {loading ? <div className="h-72 flex items-center justify-center"><Spin /></div> : null}
        {hasMoreHistory ? <Button size="small" onClick={() => void loadMoreHistory()}>加载更早消息</Button> : null}
        {!loading && messages.length === 0 ? <ExperimentEmptyState description="选择图片模型并输入提示词，开始一轮图片实验" /> : null}
        {messages.map((item) => {
          const isUser = item.role === 'user'
          const isRunning = Boolean(item.taskId && !['succeeded', 'failed', 'cancelled'].includes(item.status ?? 'pending'))
          const statusText = item.status === 'succeeded' ? '已完成' : item.status === 'failed' ? '失败' : item.status === 'cancelled' ? '已取消' : '生成中'
          return (
            <div key={item.id} className={isUser ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}>
              <Tag color={isUser ? 'blue' : item.status === 'failed' ? 'red' : 'green'}>{isUser ? '你' : '图片生成'}</Tag>
              <div className={`mt-1 rounded-lg px-3 py-2 ${isUser ? 'whitespace-pre-wrap bg-blue-50' : 'bg-gray-50'}`}>
                <div className="whitespace-pre-wrap">{item.content}</div>
                {isUser ? <ExperimentHistoryReferences files={files} references={(item.referenceFileIds ?? []).map((id) => ({ id, label: '参考图' }))} /> : null}
                {item.taskId ? <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                  {isRunning ? <Spin size="small" /> : null}
                  <span>任务状态：{statusText}</span>
                </div> : null}
                {item.error ? <div className="mt-2 text-sm text-red-600">{item.error}</div> : null}
                {item.resultUrls?.length ? <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {item.resultUrls.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`生成结果 ${index + 1}`} className="w-full rounded-lg border border-gray-200 object-contain" />)}
                </div> : null}
              </div>
            </div>
          )
        })}
      </>}
      composer={<ExperimentComposer
          submitting={submitting || Boolean(runningTask)}
          submitDisabled={loading || Boolean(runningTask)}
          submitLabel="生成图片"
          onSubmit={() => void handleSubmit()}
          contextActions={
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 border-l border-slate-200 pl-2">
              <Dropdown
                trigger={['click']}
                disabled={uploading || submitting || Boolean(runningTask)}
                dropdownRender={() => (
                  <div className="min-w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                    <Upload className="block w-full" accept="image/*" showUploadList={false} beforeUpload={handleUploadReference} disabled={uploading || submitting || Boolean(runningTask)}>
                      <Button type="text" block icon={<UploadOutlined />} loading={uploading} className="!justify-start">上传图片</Button>
                    </Upload>
                    <Button type="text" block icon={<FolderOpenOutlined />} className="!justify-start" onClick={() => setLibraryOpen(true)}>从资料库选择</Button>
                  </div>
                )}
              >
                <Button size="small" icon={<PictureOutlined />} loading={uploading}>参考图</Button>
              </Dropdown>
              {selectedReferences.map((file) => (
                <div key={file.id} className="group relative h-9 w-9 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm" title={file.name}>
                  <img src={buildFileDownloadUrl(file.id)} alt={file.name} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label={`移除参考图：${file.name}`}
                    className="absolute inset-0 hidden items-center justify-center bg-slate-900/50 text-white group-hover:flex focus:flex"
                    onClick={() => toggleReference(file.id)}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              ))}
              {referenceFileIds.length ? <Button size="small" type="text" onClick={() => setReferenceFileIds([])} disabled={submitting || Boolean(runningTask)}>清空</Button> : null}
            </div>
          }
          options={
            <ExperimentOptionBar
              models={models.map((model) => ({ id: model.id, name: model.name }))}
              templates={templates.map((template) => ({
                id: template.id,
                name: template.name,
                version: template.version,
                preview: template.preview,
                category: imagePromptCategoryLabels[template.category],
              }))}
              modelId={modelId}
              templateId={templateId}
              loading={loading}
              disabled={submitting || Boolean(runningTask)}
              modelLabel="图片模型"
              modelPlaceholder="选择已登记的图片模型"
              onModelChange={setModelId}
              onTemplateChange={handleSelectTemplate}
            />
          }
        >
          <ExperimentPromptEditor
            template={selectedTemplate}
            templateValues={templateValues}
            draft={draft}
            placeholder="描述你想生成的图片…"
            minRows={5}
            disabled={submitting || loading || Boolean(runningTask)}
            onDraftChange={setDraft}
            onTemplateValuesChange={setTemplateValues}
            onUseFreeInput={(renderedPrompt) => {
              setTemplateId(undefined)
              setTemplateValues({})
              setDraft(renderedPrompt)
            }}
          />
        </ExperimentComposer>}
      overlays={<Modal title="从资料库选择参考图" open={libraryOpen} onCancel={() => setLibraryOpen(false)} footer={<Button type="primary" onClick={() => setLibraryOpen(false)}>完成</Button>} width={820}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {files.map((file) => {
            const selected = referenceFileIds.includes(file.id)
            return (
              <button key={file.id} type="button" onClick={() => toggleReference(file.id)} className={`overflow-hidden rounded border text-left ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}>
                <img src={buildFileDownloadUrl(file.id)} alt={file.name} className="h-28 w-full object-cover" />
                <div className="truncate p-2 text-xs">{file.name}</div>
              </button>
            )
          })}
        </div>
        {!files.length ? <Empty description="资料库中暂无图片" /> : null}
      </Modal>}
    />
  )
}
