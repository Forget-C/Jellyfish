/**
 * 视频实验室模态组件。
 *
 * 页面壳负责会话选择和布局；本组件只保留视频特有的帧输入、异步任务轮询和结果展示。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Dropdown, Empty, Input, Modal, Select, Spin, Table, Tag, Tooltip, Upload, message } from 'antd'
import { CloseOutlined, FolderOpenOutlined, PictureOutlined, UploadOutlined, VideoCameraOutlined } from '@ant-design/icons'
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
  subjectReferences?: { name: string; imageFileIds: string[]; videoFileIds: string[] }[]
}
type SubjectMediaKind = 'image' | 'video'
type SubjectReferenceDraft = { id: string; name: string; imageFileIds: string[]; videoFileIds: string[] }
type VideoCapability = {
  allowed_ratios?: string[]; default_ratio?: string
  supports_subject_image_reference?: boolean; supports_subject_video_reference?: boolean
  supports_subject_reference_with_frame_reference?: boolean
  max_subjects?: number | null; max_images_per_subject?: number | null; max_videos_per_subject?: number | null
  max_media_per_subject?: number | null; max_total_subject_videos?: number | null
}

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
  const frameReferences = payload.frame_references
  if (frameReferences && typeof frameReferences === 'object') {
    const references = frameReferences as Record<string, unknown>
    if (typeof references.first_frame_file_id === 'string') frameFileIds.first = references.first_frame_file_id
    if (typeof references.last_frame_file_id === 'string') frameFileIds.last = references.last_frame_file_id
    const keyFrames = references.key_frame_file_ids
    if (Array.isArray(keyFrames) && typeof keyFrames[0] === 'string') frameFileIds.key = keyFrames[0]
  } else {
    // 兼容已持久化的旧实验消息；新提交始终写入 frame_references。
    ;(['first', 'last', 'key'] as FrameSlot[]).forEach((slot) => {
      const value = payload[`${slot}_frame_file_id`]
      if (typeof value === 'string') frameFileIds[slot] = value
    })
  }
  const subjectReferences = Array.isArray(payload.subject_references) ? payload.subject_references.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const subject = value as Record<string, unknown>
    const name = typeof subject.name === 'string' ? subject.name : '主体'
    return [{
      name,
      imageFileIds: Array.isArray(subject.image_file_ids) ? subject.image_file_ids.filter((id): id is string => typeof id === 'string') : [],
      videoFileIds: Array.isArray(subject.video_file_ids) ? subject.video_file_ids.filter((id): id is string => typeof id === 'string') : [],
    }]
  }) : []
  return {
    id: item.id, role: item.role === 'user' ? 'user' : 'assistant', content: item.content ?? '',
    taskId: item.task_id ?? undefined, status: item.status ?? undefined,
    progress: typeof payload.progress === 'number' ? payload.progress : undefined,
    videoUrl: extractVideoUrl(payload.result as Record<string, unknown> | undefined),
    error: typeof payload.error === 'string' ? payload.error : undefined,
    ratio: typeof payload.ratio === 'string' ? payload.ratio : undefined, frameFileIds, subjectReferences,
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

/** 在统一入口中管理主体图片和视频，避免素材类型拆成多个表格列。 */
function SubjectMediaControl({ disabled, disabledTitle, label, uploadingKind, supportsImage, supportsVideo, onUpload, onOpenLibrary }: {
  disabled: boolean; disabledTitle?: string; label: string; uploadingKind?: SubjectMediaKind; supportsImage: boolean; supportsVideo: boolean
  onUpload: (kind: SubjectMediaKind, file: UploadFile) => Promise<boolean>; onOpenLibrary: (kind: SubjectMediaKind) => void
}) {
  return <Dropdown trigger={['click']} disabled={disabled} dropdownRender={() => <div className="min-w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
    {supportsImage ? <><Upload className="block w-full" accept="image/*" showUploadList={false} disabled={disabled} beforeUpload={(file) => onUpload('image', file)}>
      <Button type="text" block icon={<UploadOutlined />} loading={uploadingKind === 'image'} className="!justify-start">上传图片</Button>
    </Upload><Button type="text" block icon={<FolderOpenOutlined />} className="!justify-start" onClick={() => onOpenLibrary('image')}>从资料库选择图片</Button></> : null}
    {supportsVideo ? <><Upload className="block w-full" accept="video/mp4,video/quicktime,video/x-msvideo" showUploadList={false} disabled={disabled} beforeUpload={(file) => onUpload('video', file)}>
      <Button type="text" block icon={<UploadOutlined />} loading={uploadingKind === 'video'} className="!justify-start">上传视频</Button>
    </Upload><Button type="text" block icon={<FolderOpenOutlined />} className="!justify-start" onClick={() => onOpenLibrary('video')}>从资料库选择视频</Button></> : null}
  </div>}>
    <Button size="small" icon={<UploadOutlined />} loading={Boolean(uploadingKind)} className="!w-24" title={disabledTitle}>{label}</Button>
  </Dropdown>
}

/** 组合视频模态的输入、历史和任务轮询，并交给统一实验室页面壳渲染。 */
export function VideoExperimentMode({ sessionId, ensureSession, clearSessionMessages, render }: VideoExperimentModeProps) {
  const history = useExperimentHistory(sessionId)
  const { refresh: refreshHistory } = history
  const [models, setModels] = useState<ModelRead[]>([])
  const [templates, setTemplates] = useState<PromptTemplateRead[]>([])
  const [files, setFiles] = useState<FileRead[]>([])
  const [modelId, setModelId] = useState<string>()
  const [templateId, setTemplateId] = useState<string>()
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [ratio, setRatio] = useState<VideoRatio>('16:9')
  const [frameFileIds, setFrameFileIds] = useState<Partial<Record<FrameSlot, string>>>({})
  const [subjectReferences, setSubjectReferences] = useState<SubjectReferenceDraft[]>([])
  const [subjectModalOpen, setSubjectModalOpen] = useState(false)
  const [uploadingSubjectMedia, setUploadingSubjectMedia] = useState<{ subjectId: string; kind: SubjectMediaKind } | null>(null)
  const [capability, setCapability] = useState<VideoCapability>()
  const [modelsLoading, setModelsLoading] = useState(false)
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [uploadingSlot, setUploadingSlot] = useState<FrameSlot | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [libraryTarget, setLibraryTarget] = useState<FrameSlot | null>(null)
  const [subjectLibraryTarget, setSubjectLibraryTarget] = useState<{ subjectId: string; kind: SubjectMediaKind } | null>(null)
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null)
  const [updates, setUpdates] = useState<Record<string, Partial<VideoMessage>>>({})

  useEffect(() => {
    /** 帧槽位与主体参考共用资料库，但按文件类型在各自入口过滤。 */
    void StudioFilesService.listFilesApiApiV1StudioFilesGet({ page: 1, pageSize: 100, order: 'updated_at', isDesc: true })
      .then((response) => setFiles(response.data?.items ?? []))
      .catch(() => message.error('加载视频资料库失败'))
  }, [])

  const selectedTemplate = useMemo(() => templates.find((item) => item.id === templateId) ?? null, [templateId, templates])
  const currentPrompt = selectedTemplate ? renderPromptTemplate(selectedTemplate.content, templateValues).trim() : draft.trim()
  const messages = useMemo(() => {
    // 正式消息保持服务端 sequence 顺序，轮询只以 task_id 覆盖瞬时任务字段。
    return history.messages.map(toVideoMessage).map((item) => ({ ...item, ...(item.taskId ? updates[item.taskId] : undefined) }))
  }, [history.messages, updates])
  const selectedFrames = useMemo(() => Object.fromEntries(Object.entries(frameFileIds).map(([slot, id]) => [slot, files.find((file) => file.id === id)])) as Partial<Record<FrameSlot, FileRead>>, [files, frameFileIds])
  const imageFiles = useMemo(() => files.filter((file) => file.type === 'image'), [files])
  const videoFiles = useMemo(() => files.filter((file) => file.type === 'video'), [files])
  const hasSubjectReferences = subjectReferences.length > 0
  const hasFrameReferences = Object.values(frameFileIds).some(Boolean)
  const hasIncompleteSubject = subjectReferences.some((subject) => !subject.name.trim() || (!subject.imageFileIds.length && !subject.videoFileIds.length))
  const subjectImageCount = subjectReferences.reduce((count, subject) => count + subject.imageFileIds.length, 0)
  const subjectVideoCount = subjectReferences.reduce((count, subject) => count + subject.videoFileIds.length, 0)
  const subjectLimitText = [
    capability?.max_subjects != null ? `主体≤${capability.max_subjects}` : null,
    capability?.max_images_per_subject != null ? `单主体图片≤${capability.max_images_per_subject}` : null,
    capability?.max_videos_per_subject != null ? `单主体视频≤${capability.max_videos_per_subject}` : null,
    capability?.max_media_per_subject != null ? `单主体素材≤${capability.max_media_per_subject}` : null,
    capability?.max_total_subject_videos != null ? `总视频≤${capability.max_total_subject_videos}` : null,
  ].filter((item): item is string => Boolean(item)).join('，')
  const runningTask = messages.find((item) => item.taskId && !['succeeded', 'failed', 'cancelled'].includes(item.status ?? 'pending'))
  const disabled = submitting || Boolean(runningTask)

  /** 首次展开时加载视频模型，并在唯一候选时自动选中。 */
  const loadModels = async () => {
    if (models.length || modelsLoading) return
    setModelsLoading(true)
    try {
      const response = await LlmService.listModelsApiV1LlmModelsGet({ category: 'video', page: 1, pageSize: 100, order: 'updated_at', isDesc: true })
      const items = response.data?.items ?? []; setModels(items)
      if (items.length === 1) { setModelId(items[0].id); void loadCapability(items[0].id) }
    } catch { message.error('加载视频模型失败') } finally { setModelsLoading(false) }
  }

  /** 读取当前选择模型的能力，防止将主体输入误发给不支持的供应商模型。 */
  const loadCapability = async (nextModelId?: string) => {
    if (!nextModelId) { setCapability(undefined); return }
    try {
      const response = await LlmService.getVideoGenerationOptionsApiV1LlmVideoGenerationOptionsGet({ modelId: nextModelId })
      const next = response.data
      setCapability(next ?? undefined)
      if (next?.allowed_ratios?.length && !next.allowed_ratios.includes(ratio)) {
        setRatio((next.default_ratio ?? next.allowed_ratios[0]) as VideoRatio)
      }
    } catch {
      setCapability(undefined)
      message.error('加载视频模型能力失败')
    }
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
        setUpdates((current) => ({ ...current, [taskId]: { status, error: task?.error ?? undefined, progress: task?.progress, videoUrl: status === 'succeeded' ? extractVideoUrl(task?.result) : current[taskId]?.videoUrl } }))
        if (status === 'failed') message.error(task?.error || '视频生成失败，请检查模型与供应商配置')
        if (['succeeded', 'failed', 'cancelled'].includes(status)) await refreshHistory()
      } catch { if (!cancelled) message.error('获取视频生成任务状态失败') }
    }
    void poll(); const timer = window.setInterval(() => void poll(), 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [refreshHistory, runningTask?.taskId])

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

  /** 上传主体介质并写入对应命名主体，避免主体素材落入关键帧字段。 */
  const uploadSubjectMedia = async (subjectId: string, kind: SubjectMediaKind, file: UploadFile): Promise<boolean> => {
    if (!file.type?.startsWith(`${kind}/`)) { message.warning(`只能上传${kind === 'image' ? '图片' : '视频'}作为主体参考`); return false }
    if (kind === 'image' && !capability?.supports_subject_image_reference) return false
    if (kind === 'video' && !capability?.supports_subject_video_reference) return false
    const subject = subjectReferences.find((item) => item.id === subjectId)
    if (!subject) return false
    if (kind === 'image' && capability?.max_images_per_subject != null && subject.imageFileIds.length >= capability.max_images_per_subject) return message.warning(`每个主体最多支持 ${capability.max_images_per_subject} 张图片`), false
    if (kind === 'video' && capability?.max_videos_per_subject != null && subject.videoFileIds.length >= capability.max_videos_per_subject) return message.warning(`每个主体最多支持 ${capability.max_videos_per_subject} 个视频`), false
    if (capability?.max_media_per_subject != null && subject.imageFileIds.length + subject.videoFileIds.length >= capability.max_media_per_subject) return message.warning(`每个主体最多支持 ${capability.max_media_per_subject} 个参考素材`), false
    if (kind === 'video' && capability?.max_total_subject_videos != null && subjectReferences.reduce((total, item) => total + item.videoFileIds.length, 0) >= capability.max_total_subject_videos) return message.warning(`当前模型最多支持 ${capability.max_total_subject_videos} 个主体视频`), false
    setUploadingSubjectMedia({ subjectId, kind })
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: file as unknown as string } })
      const uploaded = response.data; if (!uploaded) throw new Error('上传未返回文件信息')
      setFiles((current) => [uploaded, ...current.filter((item) => item.id !== uploaded.id)])
      setSubjectReferences((current) => current.map((subject) => subject.id !== subjectId ? subject : {
        ...subject,
        [kind === 'image' ? 'imageFileIds' : 'videoFileIds']: [...(kind === 'image' ? subject.imageFileIds : subject.videoFileIds), uploaded.id],
      }))
      message.success('主体参考已上传')
    } catch { message.error('主体参考上传失败') } finally { setUploadingSubjectMedia(null) }
    return false
  }

  /** 判断主体是否还能追加指定介质；上传和资料库选择必须共用此规则。 */
  const canAppendSubjectMedia = (subjectId: string, kind: SubjectMediaKind): boolean => {
    const subject = subjectReferences.find((item) => item.id === subjectId)
    if (!subject) return false
    if (kind === 'image' && (!capability?.supports_subject_image_reference || (capability.max_images_per_subject != null && subject.imageFileIds.length >= capability.max_images_per_subject))) return false
    if (kind === 'video' && (!capability?.supports_subject_video_reference || (capability.max_videos_per_subject != null && subject.videoFileIds.length >= capability.max_videos_per_subject))) return false
    if (capability?.max_media_per_subject != null && subject.imageFileIds.length + subject.videoFileIds.length >= capability.max_media_per_subject) return false
    return !(kind === 'video' && capability?.max_total_subject_videos != null && subjectReferences.reduce((total, item) => total + item.videoFileIds.length, 0) >= capability.max_total_subject_videos)
  }

  /** 切换模型时重置不兼容的参考模式，保持主体和关键帧不可同时提交。 */
  const selectModel = (nextModelId?: string) => {
    setModelId(nextModelId)
    void loadCapability(nextModelId)
  }

  /** 先保证会话落库，再创建视频任务，避免草稿态产生空会话。 */
  const submit = async () => {
    if (!modelId) return message.warning('请选择视频模型')
    if (!currentPrompt) return message.warning(selectedTemplate ? '请填写模板变量，生成有效提示词' : '请输入视频提示词')
    if (!selectedTemplate) setDraft('')
    if (hasSubjectReferences && hasFrameReferences && !capability?.supports_subject_reference_with_frame_reference) {
      return message.warning('当前模型不支持主体参考与关键帧同时使用')
    }
    if (hasSubjectReferences && !capability?.supports_subject_image_reference && !capability?.supports_subject_video_reference) {
      return message.warning('当前模型不支持主体参考')
    }
    if (subjectReferences.some((subject) => !subject.name.trim() || (!subject.imageFileIds.length && !subject.videoFileIds.length))) {
      return message.warning('每个主体都需要名称和至少一份图片或视频参考')
    }
    if (capability?.max_subjects != null && subjectReferences.length > capability.max_subjects) return message.warning(`当前模型最多支持 ${capability.max_subjects} 个主体`)
    const videoCount = subjectReferences.reduce((total, subject) => total + subject.videoFileIds.length, 0)
    if (capability?.max_total_subject_videos != null && videoCount > capability.max_total_subject_videos) return message.warning(`当前模型最多支持 ${capability.max_total_subject_videos} 个主体视频`)
    for (const subject of subjectReferences) {
      if (capability?.max_images_per_subject != null && subject.imageFileIds.length > capability.max_images_per_subject) return message.warning(`每个主体最多支持 ${capability.max_images_per_subject} 张图片`)
      if (capability?.max_videos_per_subject != null && subject.videoFileIds.length > capability.max_videos_per_subject) return message.warning(`每个主体最多支持 ${capability.max_videos_per_subject} 个视频`)
      if (capability?.max_media_per_subject != null && subject.imageFileIds.length + subject.videoFileIds.length > capability.max_media_per_subject) return message.warning(`每个主体最多支持 ${capability.max_media_per_subject} 个参考素材`)
    }
    setSubmitting(true)
    try {
      const session = await ensureSession('video')
      const response = await StudioVideoLabService.createVideoLabTaskApiV1StudioVideoLabTasksPost({ requestBody: {
        session_id: session.id, model_id: modelId, prompt: currentPrompt, ratio,
        frame_references: {
          first_frame_file_id: frameFileIds.first ?? null,
          last_frame_file_id: frameFileIds.last ?? null,
          key_frame_file_ids: frameFileIds.key ? [frameFileIds.key] : [],
        },
        subject_references: subjectReferences.map((subject) => ({ name: subject.name.trim(), image_file_ids: subject.imageFileIds, video_file_ids: subject.videoFileIds })),
      } })
      const created = response.data
      if (!created?.task_id || !created.messages?.length) throw new Error('创建视频任务未返回正式消息')
      // 创建接口直接返回正式 user/task 消息，共享 Hook 负责跨首提重挂载接管。
      history.adoptCanonicalMessages(session.id, created.messages)
      setSubjectModalOpen(false)
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
          {isUser ? <><ExperimentHistoryReferences files={files} references={[...(['first', 'last', 'key'] as FrameSlot[]).flatMap((slot) => item.frameFileIds?.[slot] ? [{ id: item.frameFileIds[slot]!, label: frameLabels[slot] }] : []), ...(item.subjectReferences ?? []).flatMap((subject) => subject.imageFileIds.map((id) => ({ id, label: `${subject.name}图片` })))]} />{(item.subjectReferences ?? []).flatMap((subject) => subject.videoFileIds.map((id) => <Tag key={id} className="mt-1">{subject.name}视频：{files.find((file) => file.id === id)?.name ?? id}</Tag>))}{item.ratio ? <div className="mt-2 text-xs text-slate-500">画幅：{item.ratio}</div> : null}</> : null}
          {item.taskId ? <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">{isRunning ? <Spin size="small" /> : null}<span>任务状态：{statusText}{typeof item.progress === 'number' ? `（${item.progress}%）` : ''}</span></div> : null}
          {item.error ? <div className="mt-2 text-sm text-red-600">{item.error}</div> : null}
          {item.videoUrl ? <button type="button" className="group relative mt-3 block h-36 w-64 max-w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-900 text-left" onClick={() => setPreviewVideoUrl(item.videoUrl ?? null)} aria-label="打开视频预览"><video muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" className="pointer-events-none h-full w-full object-cover" src={item.videoUrl} onLoadedMetadata={(event) => { event.currentTarget.currentTime = 0.1 }}>视频缩略图</video><span className="absolute inset-0 flex items-center justify-center bg-slate-950/25 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">点击预览</span></button> : null}
        </div>
      </div>
    })}
  </>
  const subjectActions = capability?.supports_subject_image_reference || capability?.supports_subject_video_reference ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 border-l border-slate-200 pl-2">
    <span className="max-w-full truncate text-xs text-slate-500" title={subjectLimitText}>主体参考：{subjectReferences.length} 个 · 图片 {subjectImageCount} · 视频 {subjectVideoCount}{subjectLimitText ? `（${subjectLimitText}）` : ''}</span>
    <Button size="small" disabled={disabled || hasFrameReferences} onClick={() => setSubjectModalOpen(true)}>编辑主体参考</Button>
    {hasFrameReferences ? <span className="text-xs text-slate-500">关键帧已启用，不能添加主体参考</span> : null}
  </div> : null
  const subjectEditor = <Modal title="编辑主体参考" open={subjectModalOpen} onCancel={() => setSubjectModalOpen(false)} footer={<div className="flex justify-end gap-2"><Button onClick={() => setSubjectModalOpen(false)}>稍后完成</Button><Button type="primary" disabled={hasIncompleteSubject} onClick={() => setSubjectModalOpen(false)}>完成</Button></div>} width={820} destroyOnClose={false}>
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
      <span>主体 {subjectReferences.length} 个 · 图片 {subjectImageCount} · 视频 {subjectVideoCount}</span>
      {subjectLimitText ? <span className="text-xs text-slate-500">{subjectLimitText}</span> : null}
      <Button size="small" disabled={disabled || (capability?.max_subjects != null && subjectReferences.length >= capability.max_subjects)} onClick={() => { const subject = { id: crypto.randomUUID(), name: '', imageFileIds: [], videoFileIds: [] }; setSubjectReferences((current) => [...current, subject]) }}>添加主体</Button>
    </div>
    <div className={`mb-3 flex h-10 items-center rounded border px-3 text-sm ${hasIncompleteSubject ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
      {hasIncompleteSubject ? '请为每个主体设置名称并至少添加一份图片或视频参考。未完成时可稍后继续编辑。' : '主体名称和参考素材已填写完整。'}
    </div>
    <Table<SubjectReferenceDraft>
      size="small"
      dataSource={subjectReferences}
      rowKey="id"
      pagination={false}
      tableLayout="fixed"
      scroll={{ x: 748 }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未添加主体参考" /> }}
      columns={[
        { title: '名称', dataIndex: 'name', width: 176, render: (name: string, subject: SubjectReferenceDraft) => <Tooltip title={name.trim() || '未设置名称'} mouseEnterDelay={0.5}><Input size="small" value={name} disabled={disabled} placeholder="输入主体名称" className="w-full truncate" aria-label="主体名称" onChange={(event) => setSubjectReferences((current) => current.map((item) => item.id === subject.id ? { ...item, name: event.target.value } : item))} /></Tooltip> },
        { title: '素材', width: 380, render: (_: unknown, subject: SubjectReferenceDraft) => {
          const media = [...subject.imageFileIds, ...subject.videoFileIds].map((fileId) => ({ fileId, fileName: files.find((file) => file.id === fileId)?.name ?? '主体素材' }))
          if (!media.length) return <span className="text-slate-400">未上传</span>
          return <div className="flex h-8 items-center gap-1 overflow-x-auto whitespace-nowrap">
            {media.map(({ fileId, fileName }) => <Tooltip key={fileId} title={fileName} mouseEnterDelay={0.5}>
              <Tag closable={!disabled} className="!m-0 flex max-w-44 shrink-0 items-center" onClose={() => setSubjectReferences((current) => current.map((item) => item.id !== subject.id ? item : { ...item, imageFileIds: item.imageFileIds.filter((id) => id !== fileId), videoFileIds: item.videoFileIds.filter((id) => id !== fileId) }))}>
                <span className="inline-block max-w-36 truncate align-bottom">{fileName}</span>
              </Tag>
            </Tooltip>)}
          </div>
        } },
        { title: '操作', width: 192, render: (_: unknown, subject: SubjectReferenceDraft) => {
          const hasMedia = subject.imageFileIds.length + subject.videoFileIds.length > 0
          const canAddImage = canAppendSubjectMedia(subject.id, 'image')
          const canAddVideo = canAppendSubjectMedia(subject.id, 'video')
          const uploadInProgress = Boolean(uploadingSubjectMedia)
          const uploadDisabled = disabled || uploadInProgress || (!canAddImage && !canAddVideo)
          const disabledTitle = uploadInProgress ? '素材上传中' : !canAddImage && !canAddVideo ? '已达到当前模型的主体素材上限' : undefined
          return <div className="flex h-8 items-center gap-2 overflow-hidden">
            <SubjectMediaControl disabled={uploadDisabled} disabledTitle={disabledTitle} label={hasMedia ? '继续上传' : '上传素材'} uploadingKind={uploadingSubjectMedia?.subjectId === subject.id ? uploadingSubjectMedia.kind : undefined} supportsImage={canAddImage} supportsVideo={canAddVideo} onUpload={(kind, file) => uploadSubjectMedia(subject.id, kind, file)} onOpenLibrary={(kind) => setSubjectLibraryTarget({ subjectId: subject.id, kind })} />
            <Button size="small" type="text" danger disabled={disabled || uploadInProgress} onClick={() => setSubjectReferences((current) => current.filter((item) => item.id !== subject.id))}>删除</Button>
          </div>
        } },
      ]}
    />
  </Modal>
  const composer = <ExperimentComposer submitting={disabled} submitDisabled={disabled} submitLabel="生成视频" onSubmit={() => void submit()} options={<ExperimentOptionBar models={models.map((item) => ({ id: item.id, name: item.name }))} templates={templates.map((item) => ({ id: item.id, name: item.name, version: item.version, preview: item.preview, category: '视频提示词' }))} modelId={modelId} templateId={templateId} modelsLoading={modelsLoading} templatesLoading={templatesLoading} disabled={disabled} modelLabel="视频模型" modelPlaceholder="选择已登记的视频模型" onModelChange={selectModel} onTemplateChange={selectTemplate} onModelOpenChange={(open) => { if (open) void loadModels() }} onTemplateOpenChange={(open) => { if (open) void loadTemplates() }} />} contextActions={<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 border-l border-slate-200 pl-2">{(['first', 'last', 'key'] as FrameSlot[]).map((slot) => <FrameControl key={slot} slot={slot} file={selectedFrames[slot]} disabled={disabled || hasSubjectReferences} uploading={uploadingSlot === slot} onUpload={uploadFrame} onOpenLibrary={setLibraryTarget} onRemove={(target) => setFrameFileIds((current) => ({ ...current, [target]: undefined }))} />)}{hasSubjectReferences ? <span className="text-xs text-slate-500">主体参考已启用，不能添加关键帧</span> : null}<Select size="small" value={ratio} onChange={setRatio} disabled={disabled} options={(capability?.allowed_ratios?.length ? capability.allowed_ratios : ratioOptions).map((value) => ({ value, label: value }))} aria-label="视频比例" />{subjectActions}</div>}><ExperimentPromptEditor template={selectedTemplate} templateValues={templateValues} draft={draft} placeholder="描述你想生成的视频…" minRows={5} disabled={disabled} onDraftChange={setDraft} onTemplateValuesChange={setTemplateValues} onUseFreeInput={(prompt) => { setTemplateId(undefined); setTemplateValues({}); setDraft(prompt) }} /></ExperimentComposer>
  const overlays = <><Modal title={libraryTarget ? `从资料库选择${frameLabels[libraryTarget]}` : '从资料库选择关键帧'} open={Boolean(libraryTarget)} onCancel={() => setLibraryTarget(null)} footer={<Button type="primary" onClick={() => setLibraryTarget(null)}>完成</Button>} width={820}><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{imageFiles.map((file) => <button key={file.id} type="button" onClick={() => { if (libraryTarget) setFrameFileIds((current) => ({ ...current, [libraryTarget]: file.id })) }} className={`overflow-hidden rounded border text-left ${libraryTarget && frameFileIds[libraryTarget] === file.id ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}><img src={buildFileDownloadUrl(file.id)} alt={file.name} className="h-28 w-full object-cover" /><div className="truncate p-2 text-xs">{file.name}</div></button>)}</div>{!imageFiles.length ? <Empty description="资料库中暂无图片" /> : null}</Modal><Modal title={subjectLibraryTarget ? `从资料库选择主体${subjectLibraryTarget.kind === 'image' ? '图片' : '视频'}` : '选择主体素材'} open={Boolean(subjectLibraryTarget)} onCancel={() => setSubjectLibraryTarget(null)} footer={<Button type="primary" onClick={() => setSubjectLibraryTarget(null)}>完成</Button>} width={820}><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{(subjectLibraryTarget?.kind === 'video' ? videoFiles : imageFiles).map((file) => <button key={file.id} type="button" onClick={() => { if (!subjectLibraryTarget) return; const target = subjectLibraryTarget; const selectedSubject = subjectReferences.find((subject) => subject.id === target.subjectId); const selectedIds = target.kind === 'image' ? selectedSubject?.imageFileIds : selectedSubject?.videoFileIds; if (selectedIds?.includes(file.id)) return message.info('该素材已添加'); if (!canAppendSubjectMedia(target.subjectId, target.kind)) return message.warning('已达到当前模型的主体参考上限'); setSubjectReferences((current) => current.map((subject) => subject.id !== target.subjectId ? subject : target.kind === 'image' ? { ...subject, imageFileIds: [...subject.imageFileIds, file.id] } : { ...subject, videoFileIds: [...subject.videoFileIds, file.id] })) }} className="overflow-hidden rounded border border-gray-200 text-left"><div className="flex h-28 items-center justify-center bg-slate-100">{subjectLibraryTarget?.kind === 'image' ? <img src={buildFileDownloadUrl(file.id)} alt={file.name} className="h-full w-full object-cover" /> : <VideoCameraOutlined className="text-2xl text-slate-500" />}</div><div className="truncate p-2 text-xs">{file.name}</div></button>)}</div>{!(subjectLibraryTarget?.kind === 'video' ? videoFiles : imageFiles).length ? <Empty description={`资料库中暂无主体${subjectLibraryTarget?.kind === 'video' ? '视频' : '图片'}`} /> : null}</Modal><Modal title="视频预览" open={Boolean(previewVideoUrl)} onCancel={() => setPreviewVideoUrl(null)} footer={null} destroyOnClose width={900}>{previewVideoUrl ? <video controls autoPlay preload="metadata" className="w-full rounded-lg bg-black" src={previewVideoUrl}>你的浏览器不支持视频预览。</video> : null}</Modal></>
  const clearHistory = async () => {
    if (!sessionId || !clearSessionMessages) return
    try { await clearSessionMessages(sessionId); history.clearLocalHistory(); await history.refresh() } catch { message.error('清空历史失败；含生成任务的会话不可清空') }
  }
  const extra = <Button disabled={!messages.length || disabled || !clearSessionMessages} onClick={() => void clearHistory()}>清空历史</Button>
  return <>{subjectEditor}{render({ history: historyNode, composer, extra, overlays, disabled })}</>
}
