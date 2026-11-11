/**
 * 视频实验室模态组件。
 *
 * 页面壳负责会话选择和布局；本组件只保留视频特有的帧输入、异步任务轮询和结果展示。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Select, Tag, message } from 'antd'
import {
  LlmService,
  StudioFilesService,
  StudioGenerationTasksService,
  type ExperimentMessageRead,
  type FileRead,
  type VideoGenerationOptionsRead,
} from '../../../../services/generated'
import { ExperimentSubmissionFeedback } from '../components/ExperimentSubmissionFeedback'
import { useExperimentSubmission } from '../hooks/useExperimentSubmission'
import { buildFileDownloadUrl } from '../../assets/utils'
import { useExperimentLeaveStatus } from '../ExperimentLeaveGuard'
import type { ExperimentReferenceHandle } from '../components/ExperimentReferencePanel'
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
import { renderPromptTemplate } from '../components/PromptTemplateForm'
import { VideoExperimentReferences, frameLabels, videoReferenceIssues, type FrameSlot, type VideoSubjectDraft } from '../components/VideoExperimentReferences'
import { useExperimentHistory } from '../hooks/useExperimentHistory'
import { useExperimentModels } from '../hooks/useExperimentModels'
import { useExperimentTemplates } from '../hooks/useExperimentTemplates'
import { focusExperimentPromptEditor } from '../experimentInputSnapshot'
import type { ExperimentLabType } from '../hooks/useExperimentSessions'

type VideoMessage = {
  id: string; role: 'user' | 'assistant'; content: string; taskId?: string; status?: string
  progress?: number | null; videoUrl?: string; error?: string; ratio?: string
  frameFileIds?: Partial<Record<FrameSlot, string>>
  subjectReferences?: { name: string; imageFileIds: string[]; videoFileIds: string[] }[]
}
const ratioOptions = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']

/** 从任务结果中选择可播放的资料库文件或供应商视频地址。 */
function extractVideoUrl(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined
  const data = result as Record<string, unknown>
  const primaryFileId = data.primary_file_id ?? data.file_id
  if (typeof primaryFileId === 'string' && primaryFileId) return buildFileDownloadUrl(primaryFileId)
  return typeof data.url === 'string' && data.url ? data.url : undefined
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

type RenderParts = { history: ReactNode; composer: ReactNode; clearContent?: () => Promise<void>; overlays?: ReactNode; disabled?: boolean }
type VideoExperimentModeProps = {
  sessionId?: string
  ensureSession: (labType: ExperimentLabType) => Promise<{ id: string }>
  clearSessionMessages?: (sessionId: string) => Promise<void>
  render: (parts: RenderParts) => ReactNode
}

/** 组合视频模态的输入、历史和任务轮询，并交给统一实验室页面壳渲染。 */
export function VideoExperimentMode({ sessionId, ensureSession, clearSessionMessages, render }: VideoExperimentModeProps) {
  const history = useExperimentHistory(sessionId)
  const [files, setFiles] = useState<FileRead[]>([])
  const [modelId, setModelId] = useState<string>()
  const [draft, setDraft] = useState('')
  const {
    templates, selectedTemplate, templateValues, setTemplateValues, templatesLoading, templatesFailed,
    loadTemplates, selectTemplate, confirmReplacement, applyFreeInput, replacementDialog,
  } = useExperimentTemplates(['video_prompt'], draft, setDraft)
  const [ratio, setRatio] = useState<string>('16:9')
  const [frameFileIds, setFrameFileIds] = useState<Partial<Record<FrameSlot, string>>>({})
  const [subjectReferences, setSubjectReferences] = useState<VideoSubjectDraft[]>([])
  const [capability, setCapability] = useState<VideoGenerationOptionsRead>()
  const [capabilityState, setCapabilityState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const capabilityRequest = useRef(0)
  const [libraryState, setLibraryState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const inputSignature = (prompt: string) => JSON.stringify([prompt, selectedTemplate?.id, selectedTemplate?.version, templateValues, ratio, frameFileIds, subjectReferences])
  const submission = useExperimentSubmission(sessionId, history, inputSignature(draft))
  const { submitting } = submission
  useExperimentLeaveStatus(submission.dirty)

  const loadLibrary = useCallback(async () => {
    setLibraryState('loading')
    try {
      const response = await StudioFilesService.listFilesApiApiV1StudioFilesGet({ page: 1, pageSize: 100, order: 'updated_at', isDesc: true })
      const media = (response.data?.items ?? []).filter(file => file.type === 'image' || file.type === 'video')
      // 列表返回期间新上传的文件仍保留在资料库。
      setFiles(current => [...new Map([...media, ...current].map(file => [file.id, file])).values()])
      setLibraryState('ready')
    } catch {
      setLibraryState('failed')
    }
  }, [])
  useEffect(() => { void loadLibrary() }, [loadLibrary])

  const currentPrompt = selectedTemplate ? renderPromptTemplate(selectedTemplate.content, templateValues).trim() : draft.trim()
  const persistedMessages = history.messages.map(toVideoMessage)
  const { reads, runningTaskId, retryStatus } = useExperimentTaskResults(persistedMessages, history.refresh)
  const messages = persistedMessages.map((item) => {
    const result = item.taskId ? reads[item.taskId]?.result : undefined
    if (!result) return item
    return {
      ...item, status: result.status, progress: result.progress, error: result.error,
      videoUrl: result.status === 'succeeded' ? extractVideoUrl(result.generation_delivery ?? result.result) ?? item.videoUrl : item.videoUrl,
    }
  })

  const references = { frames: frameFileIds, subjects: subjectReferences }
  const referenceIssues = videoReferenceIssues(references, capability)
  const hasSubjectReferences = subjectReferences.length > 0
  const hasFrameReferences = Object.values(frameFileIds).some(Boolean)
  const allowedRatios = capability?.allowed_ratios
  const ratioConflict = Boolean(allowedRatios && !allowedRatios.includes(ratio))
  const capabilityBlocked = Boolean(modelId && capabilityState !== 'ready')
  const capabilityIncomplete = capability && (
    capability.allowed_ratios === undefined ||
    capability.supports_subject_image_reference === undefined ||
    capability.supports_subject_video_reference === undefined ||
    capability.supports_subject_reference_with_frame_reference === undefined
  )
  const disabled = submitting || Boolean(runningTaskId)

  const { models, modelsLoading, modelsFailed, loadModels } = useExperimentModels('video', id => {
    if (!modelId) selectModel(id)
  })

  /** 以请求代次关联当前模型，晚到的能力响应不能覆盖新选择。 */
  const loadCapability = async (nextModelId?: string) => {
    const request = ++capabilityRequest.current
    setCapability(undefined)
    if (!nextModelId) {
      setCapabilityState('idle')
      return
    }
    setCapabilityState('loading')
    try {
      const response = await LlmService.getVideoGenerationOptionsApiV1LlmVideoGenerationOptionsGet({ modelId: nextModelId })
      if (request !== capabilityRequest.current) return
      if (!response.data || response.data.model_id !== nextModelId) throw new Error('未返回所选模型的能力')
      setCapability(response.data)
      setCapabilityState('ready')
    } catch {
      if (request === capabilityRequest.current) setCapabilityState('failed')
    }
  }

  const selectModel = (nextModelId?: string) => {
    setModelId(nextModelId)
    void loadCapability(nextModelId)
  }

  /** 先保证会话落库，再经固定统一入口创建视频任务，避免草稿态产生空会话。 */
  const submit = async () => {
    if (!modelId) return message.warning('请选择视频模型')
    if (!currentPrompt) return message.warning(selectedTemplate ? '请填写模板变量，生成有效提示词' : '请输入视频提示词')
    if (disabled || capabilityBlocked || ratioConflict || referenceIssues.length) return
    await submission.submitTask({
      ensureSession: () => sessionId ? Promise.resolve({ id: sessionId }) : ensureSession('video'),
      request: async targetSessionId => {
        const response = await StudioGenerationTasksService.submitVideoLabGenerationTaskApiV1StudioGenerationTasksLabsVideoSessionsSessionIdTasksPost({
          sessionId: targetSessionId,
          requestBody: {
            model_id: modelId,
            execution_prompt: currentPrompt,
            media: {
              frames: {
                first: frameFileIds.first ? { file_id: frameFileIds.first, media_kind: 'image', ordinal: 0 } : null,
                last: frameFileIds.last ? { file_id: frameFileIds.last, media_kind: 'image', ordinal: 0 } : null,
                keys: frameFileIds.key ? [{ file_id: frameFileIds.key, media_kind: 'image', ordinal: 0 }] : [],
              },
              subjects: subjectReferences.map((subject) => ({
                name: subject.name.trim(),
                media: subject.media.map(({ id, kind }, ordinal) => ({ file_id: id, media_kind: kind, ordinal })),
              })),
            },
            operation_input: { kind: 'video_generation', ratio },
          },
        })
        return response.data
      },
      onAccept: (attempt, targetSessionId) => {
        const unchanged = submission.acceptInput(attempt, targetSessionId, inputSignature(''))
        if (unchanged && !selectedTemplate) setDraft(current => current === draft ? '' : current)
        message.success('视频生成任务已创建')
      },
      failureMessage: '创建视频生成任务失败，请检查模型和参考素材',
    })
  }

  /** 仅回填历史提示词；完整异步参数只保存在关联任务快照中。 */
  const restoreUserMessage = (item: VideoMessage) => {
    if (disabled) return
    confirmReplacement(() => {
      applyFreeInput(item.content)
      setFrameFileIds({})
      setSubjectReferences([])
      focusExperimentPromptEditor()
      message.info('已回填提示词；请重新选择模型、画幅和参考素材后生成')
    }, hasFrameReferences || hasSubjectReferences)
  }

  const historyNode = <ExperimentHistory key={sessionId ?? 'draft'} history={history} messageCount={messages.length} emptyDescription="选择视频模型并输入提示词，可按需添加首帧、尾帧或关键帧">
    {messages.map((item) => {
      const isUser = item.role === 'user'
      return <ExperimentMessageBubble
        key={item.id}
        footer={isUser ? <ExperimentHistoryRestoreButton disabled={disabled} onRestore={() => restoreUserMessage(item)} /> : undefined}
        identity={isUser ? '你' : '视频生成'}
        status={item.taskId ? <ExperimentTaskStatus status={item.status} progress={item.progress} unavailable={reads[item.taskId]?.unavailable} onRetry={item.taskId === runningTaskId ? retryStatus : undefined} /> : null}
        tone={isUser ? 'user' : 'assistant'}
      >
          {isUser || item.content !== '视频生成任务已提交，正在等待生成结果。' ? item.content : null}
          {isUser ? <><ExperimentHistoryReferences files={files} references={[...(['first', 'last', 'key'] as FrameSlot[]).flatMap((slot) => item.frameFileIds?.[slot] ? [{ id: item.frameFileIds[slot]!, label: frameLabels[slot] }] : []), ...(item.subjectReferences ?? []).flatMap((subject) => subject.imageFileIds.map((id) => ({ id, label: `${subject.name}图片` })))]} />{(item.subjectReferences ?? []).flatMap((subject) => subject.videoFileIds.map((id) => <Tag key={id} className="mt-1">{subject.name}视频：{files.find((file) => file.id === id)?.name ?? id}</Tag>))}{item.ratio ? <div className="mt-2 text-xs text-slate-500">画幅：{item.ratio}</div> : null}</> : null}
          {item.error ? <div className="mt-2 text-sm text-red-600">{item.error}</div> : null}
          {item.videoUrl ? <ExperimentResultMedia kind="video" urls={[item.videoUrl]} /> : null}
      </ExperimentMessageBubble>
    })}
  </ExperimentHistory>
  const referencePicker = useRef<ExperimentReferenceHandle>(null)
  const composer = <ExperimentOptionBar models={models.map((item) => ({ id: item.id, name: item.name }))} templates={templates.map((item) => ({ id: item.id, name: item.name, version: item.version, preview: item.preview, category: '视频提示词' }))} modelId={modelId} selectedTemplate={selectedTemplate ?? undefined} modelsLoading={modelsLoading} modelsFailed={modelsFailed} onRefreshModels={() => void loadModels(true)} templatesLoading={templatesLoading} templatesFailed={templatesFailed} onRefreshTemplates={() => void loadTemplates(true)} disabled={disabled} modelLabel="视频模型" onModelChange={selectModel} onTemplateChange={selectTemplate} onModelOpenChange={(open) => { if (open) void loadModels() }} onTemplateOpenChange={(open) => { if (open) void loadTemplates() }} referenceAction={{ label: "配置参考素材", onOpen: trigger => referencePicker.current?.open(trigger) }} >{({ modelControl, addControl }) => (<ExperimentComposer submitting={disabled} submitDisabled={disabled || submission.outcomePending || capabilityBlocked || ratioConflict || referenceIssues.length > 0} onSubmit={() => void submit()} options={<>{modelControl}    <Select
      value={ratio}
      onChange={setRatio}
      disabled={disabled}
      status={ratioConflict ? 'error' : undefined}
      options={[...new Set([ratio, ...(allowedRatios ?? ratioOptions)])].map(value => ({
        value,
        label: allowedRatios && !allowedRatios.includes(value) ? `${value}（当前模型不支持）` : value,
        disabled: Boolean(allowedRatios && !allowedRatios.includes(value)),
      }))}
      aria-label="视频比例"
    /></>} addAction={addControl} contextActions={<>

    <VideoExperimentReferences ref={referencePicker}
      key={sessionId ?? 'draft'}
      value={references}
      onChange={next => { setFrameFileIds(next.frames); setSubjectReferences(next.subjects) }}
      files={files}
      libraryState={libraryState}
      onRetryLibrary={() => void loadLibrary()}
      onUploaded={file => setFiles(current => [file, ...current.filter(item => item.id !== file.id)])}
      capability={capability}
      disabled={disabled}
    />
  </>} feedback={<>     {capabilityState === 'loading' && <span role="status" className="experiment-video-reference-summary">正在读取视频模型能力</span>}
    {capabilityState === 'failed' && <span role="alert" className="experiment-video-reference-issue">视频模型能力读取失败 <Button type="link" onClick={() => void loadCapability(modelId)}>重试读取能力</Button></span>}
    {capabilityIncomplete && <span className="experiment-video-reference-summary">模型未提供完整参考限制，提交时由服务端校验</span>}
    {ratioConflict && <span role="alert" className="experiment-video-reference-issue">当前模型不支持比例 {ratio}，请重新选择</span>}
    {referenceIssues.length > 0 && <span role="alert" className="experiment-video-reference-issue">{referenceIssues.join('；')}</span>}
</>}>{replacementDialog}<ExperimentSubmissionFeedback notice={submission.notice} onCheck={() => void submission.checkHistory()} onAcknowledge={submission.acknowledgeUnknown} /><ExperimentPromptEditor template={selectedTemplate} templateValues={templateValues} draft={draft} placeholder="描述你想生成的视频；Shift + Enter 换行" label="视频提示词" disabled={disabled} submitOnEnter onSubmit={() => void submit()} onDraftChange={setDraft} onTemplateValuesChange={setTemplateValues} onUseFreeInput={applyFreeInput} /></ExperimentComposer>)}</ExperimentOptionBar>
  const clearHistory = async () => {
    if (!sessionId || !clearSessionMessages) return
    await clearSessionMessages(sessionId)
    history.clearLocalHistory()
    await history.refresh()
  }
  const clearContent = messages.length && !disabled && clearSessionMessages ? clearHistory : undefined
  return render({ history: historyNode, composer, clearContent, disabled })
}
