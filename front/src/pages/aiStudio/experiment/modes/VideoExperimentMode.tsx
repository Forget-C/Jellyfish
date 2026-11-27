import { useUiText } from '../../../../uiText'
import { bindChatSession, readTrialHistory } from '../../../../services/chatSession'
import { useTrialModelPreference } from '../hooks/useTrialModelPreference'
import { MediaTaskDetails } from '../components/MediaTaskDetails'
import { useExperimentLibrary } from '../hooks/useExperimentLibrary'
/**
 * 视频实验室模态组件。
 *
 * 页面壳负责会话选择和布局；本组件只保留视频特有的帧输入、异步任务轮询和结果展示。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, InputNumber, Popover, Select, Tag, message } from 'antd'
import {
  LlmService,
  type MediaTaskReceipt,
  type ExperimentMessageRead,
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
import { focusExperimentPromptEditor, orderedMediaReferences, readExperimentInputSnapshot, type ExperimentInputSnapshot } from '../experimentInputSnapshot'
import type { ExperimentLabType } from '../hooks/useExperimentSessions'

type VideoMessage = {
  receipt?: MediaTaskReceipt
  id: string; role: 'user' | 'assistant'; content: string; taskId?: string; status?: string
  progress?: number | null; videoUrl?: string; error?: string; ratio?: string
  resolution?: string
  seconds?: number
  frameFileIds?: Partial<Record<FrameSlot, string>>
  subjectReferences?: VideoSubjectDraft[]
  inputSnapshot?: ExperimentInputSnapshot
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
  const inputSnapshot = readExperimentInputSnapshot(item)
  const frames = inputSnapshot?.media?.frames
  const frameFileIds = {
    first: frames?.first?.file_id,
    last: frames?.last?.file_id,
    key: orderedMediaReferences(frames?.keys)[0]?.file_id,
  }
  const subjects = inputSnapshot?.media?.subjects
  const subjectReferences = Array.isArray(subjects) ? subjects.flatMap((subject, index) =>
    subject && typeof subject.name === 'string' ? [{
      id: `${item.id}-subject-${index}`,
      name: subject.name,
      media: orderedMediaReferences(subject.media).map(entry => ({ id: entry.file_id, kind: entry.media_kind })),
    }] : [],
  ) : []
  const operation = inputSnapshot?.operation_input
  return {
    id: item.id, role: item.role === 'user' ? 'user' : 'assistant', content: item.content ?? '',
    receipt: item.media_receipt ?? undefined, taskId: item.task_id ?? undefined, status: item.status ?? undefined,
    progress: typeof payload.progress === 'number' ? payload.progress : undefined,
    videoUrl: extractVideoUrl(payload.result as Record<string, unknown> | undefined),
    error: typeof payload.error === 'string' ? payload.error : undefined,
    ratio: operation && typeof operation === 'object' && 'ratio' in operation && typeof operation.ratio === 'string'
      ? operation.ratio : undefined,
    resolution: operation && typeof operation === 'object' && 'resolution' in operation && typeof operation.resolution === 'string'
      ? operation.resolution : undefined,
    seconds: operation && typeof operation === 'object' && 'seconds' in operation && typeof operation.seconds === 'number'
      ? operation.seconds : undefined,
    frameFileIds, subjectReferences, inputSnapshot,
  }
}

type RenderParts = { history: ReactNode; composer: ReactNode; hasMessages?: boolean; clearContent?: () => Promise<void>; overlays?: ReactNode; disabled?: boolean }
type VideoExperimentModeProps = {
  sessionId?: string
  ensureSession: (labType: ExperimentLabType) => Promise<{ id: string }>
  clearSessionMessages?: (sessionId: string) => Promise<void>
  render: (parts: RenderParts) => ReactNode
}

const readHistory = (paging: Parameters<typeof readTrialHistory>[1]) => readTrialHistory('video', paging)

/** 组合视频模态的输入、历史和任务轮询，并交给统一实验室页面壳渲染。 */
export function VideoExperimentMode({ sessionId, ensureSession, clearSessionMessages, render }: VideoExperimentModeProps) {
  const uiText = useUiText()
  const session = useMemo(() => sessionId ? bindChatSession('video', sessionId) : undefined, [sessionId])
  const history = useExperimentHistory(sessionId, { readPage: readHistory })
  const { files, libraryState, loadLibrary, onUploaded } = useExperimentLibrary('video')
  const [modelId, setModelId, setSoleModel] = useTrialModelPreference('video', sessionId)
  const [draft, setDraft] = useState('')
  const {
    templates, selectedTemplate, templateValues, setTemplateValues, templatesLoading, templatesFailed,
    loadTemplates, selectTemplate, confirmReplacement, applyFreeInput, replacementDialog,
  } = useExperimentTemplates(['video_prompt'], draft, setDraft)
  const [ratio, setRatio] = useState<string>('16:9')
  const [resolution, setResolution] = useState<string>()
  const [seconds, setSeconds] = useState<number>()
  const [frameFileIds, setFrameFileIds] = useState<Partial<Record<FrameSlot, string>>>({})
  const [subjectReferences, setSubjectReferences] = useState<VideoSubjectDraft[]>([])
  const [capability, setCapability] = useState<VideoGenerationOptionsRead>()
  const [capabilityState, setCapabilityState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const capabilityRequest = useRef(0)
  const inputSignature = (prompt: string) => JSON.stringify([prompt, selectedTemplate?.id, selectedTemplate?.version, templateValues, ratio, resolution, seconds, frameFileIds, subjectReferences])
  const submission = useExperimentSubmission(sessionId, history, inputSignature(draft))
  const { submitting } = submission
  useExperimentLeaveStatus(submission.dirty)


  const currentPrompt = selectedTemplate ? renderPromptTemplate(selectedTemplate.content, templateValues).trim() : draft.trim()
  const persistedMessages = history.messages.map(toVideoMessage)
  const { messages, runningTaskId, observeAdmission, retryStatus } = useExperimentTaskResults(session, history, persistedMessages, (item, result) => ({
    ...item,
    videoUrl: buildFileDownloadUrl(result.artifacts?.find(file => !file.deleted && file.media_type === 'video')?.file_id) ?? item.videoUrl,
  }))

  const references = { frames: frameFileIds, subjects: subjectReferences }
  const referenceIssues = videoReferenceIssues(references, capability)
  const hasSubjectReferences = subjectReferences.length > 0
  const hasFrameReferences = Object.values(frameFileIds).some(Boolean)
  const mode = hasSubjectReferences ? 'subject_reference' : frameFileIds.key ? 'key_frames'
    : frameFileIds.first && frameFileIds.last ? 'first_last_frames' : hasFrameReferences ? 'first_frame' : 'text_to_video'
  const videoMode = capability?.video_modes?.[mode]
  const durationOptions = videoMode?.duration_by_resolution
  const resolutions = Object.keys(durationOptions ?? {})
  const duration = resolution ? durationOptions?.[resolution] : undefined
  const durationConflict = resolutions.length > 0 && (
    !duration || seconds === null || seconds === undefined || (Array.isArray(duration) ? !duration.includes(seconds)
      : seconds < duration.min_seconds || seconds > duration.max_seconds)
  )
  const modeConflict = videoMode?.supported === false
  const allowedRatios = capability?.allowed_ratios?.filter(value => videoMode?.ratios?.includes(value) ?? true)
  const ratioConflict = Boolean(allowedRatios && !allowedRatios.includes(ratio))
  const capabilityBlocked = Boolean(modelId && capabilityState !== 'ready')
  const capabilityIncomplete = capability && (
    capability.allowed_ratios === undefined ||
    capability.supports_subject_image_reference === undefined ||
    capability.supports_subject_video_reference === undefined ||
    capability.supports_subject_reference_with_frame_reference === undefined
  )
  const disabled = submitting || Boolean(runningTaskId)

  const { models, modelsLoading, modelsFailed, loadModels } = useExperimentModels('video', setSoleModel)

  /** 以请求代次关联当前模型，晚到的能力响应不能覆盖新选择。 */
  const loadCapability = useCallback(async (nextModelId?: string) => {
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
      if (!response.data || response.data.model_id !== nextModelId) throw new Error(uiText("未返回所选模型的能力"))
      setCapability(response.data)
      setCapabilityState('ready')
    } catch {
      if (request === capabilityRequest.current) setCapabilityState('failed')
    }
  }, [uiText])

  const selectModel = (nextModelId?: string) => {
    setModelId(nextModelId)
    setResolution(undefined)
    setSeconds(undefined)
  }

  useEffect(() => { void loadCapability(modelId) }, [loadCapability, modelId])

  /** 先保证会话落库，再经固定统一入口创建视频任务，避免草稿态产生空会话。 */
  const submit = async () => {
    if (!modelId) return message.warning(uiText("请选择视频模型"))
    if (!currentPrompt) return message.warning(selectedTemplate ? uiText("请填写模板变量，生成有效提示词") : uiText("请输入视频提示词"))
    if (disabled || capabilityBlocked || ratioConflict || durationConflict || modeConflict || referenceIssues.length) return
    await submission.submitTask({
      kind: 'video',
      ensureSession: () => sessionId ? Promise.resolve({ id: sessionId }) : ensureSession('video'),
      request: (targetSessionId, idempotencyKey) => {
        const target = bindChatSession('video', targetSessionId)
        return target.send({
          idempotencyKey,
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
            operation_input: { kind: 'video_generation', ratio, ...(resolutions.length ? { resolution, seconds } : {}) },
          },
        })
      },
      onAccept: (attempt, targetSessionId, receipt) => {
        observeAdmission(receipt)
        const unchanged = submission.acceptInput(attempt, targetSessionId, inputSignature(''))
        if (unchanged && !selectedTemplate) setDraft(current => current === draft ? '' : current)
        message.success(uiText("视频生成任务已创建"))
      },
      failureMessage: uiText("创建视频生成任务失败，请检查模型和参考素材"),
    })
  }

  /** 回填提示词、模型、画幅以及与主体分开的帧素材。 */
  const restoreUserMessage = (item: VideoMessage) => {
    const snapshot = item.inputSnapshot
    if (disabled || !snapshot) return
    confirmReplacement(() => {
      applyFreeInput(snapshot.prompt)
      selectModel(snapshot.model_id ?? undefined)
      if (item.ratio) setRatio(item.ratio)
      setResolution(item.resolution)
      setSeconds(item.seconds)
      setFrameFileIds(item.frameFileIds ?? {})
      setSubjectReferences(item.subjectReferences ?? [])
      focusExperimentPromptEditor()
      message.success(uiText("已回填历史输入，可修改后重新发送"))
    }, hasFrameReferences || hasSubjectReferences)
  }

  const historyNode = <ExperimentHistory key={sessionId ?? 'draft'} history={history} messageCount={messages.length} emptyDescription={uiText("选择视频模型并输入提示词，可按需添加首帧、尾帧或关键帧")}>
    {messages.map((item) => {
      const isUser = item.role === 'user'
      return <ExperimentMessageBubble
        key={item.id}
        footer={item.inputSnapshot ? <ExperimentHistoryRestoreButton disabled={disabled} onRestore={() => restoreUserMessage(item)} /> : undefined}
        identity={isUser ? uiText("你") : uiText("视频生成")}
        status={item.taskId ? <ExperimentTaskStatus status={item.status} progress={item.progress} unavailable={item.unavailable} onRetry={item.taskId === runningTaskId ? retryStatus : undefined} /> : null}
        tone={isUser ? 'user' : 'assistant'}
      >
          {isUser || item.content !== '视频生成任务已提交，正在等待生成结果。' ? item.content : null}
          {isUser ? <><ExperimentHistoryReferences files={files} references={[...(['first', 'last', 'key'] as FrameSlot[]).flatMap((slot) => item.frameFileIds?.[slot] ? [{ id: item.frameFileIds[slot]!, label: uiText(frameLabels[slot]) }] : []), ...(item.subjectReferences ?? []).flatMap((subject) => subject.media.filter(file => file.kind === 'image').map(({ id }) => ({ id, label: uiText("{{name}}图片", { name: subject.name }) })))]} />{(item.subjectReferences ?? []).flatMap((subject) => subject.media.filter(file => file.kind === 'video').map(({ id }) => <Tag key={`${subject.id}:${id}`} className="mt-1">{subject.name}{uiText("视频：")}{files.find((file) => file.id === id)?.name ?? id}</Tag>))}{item.ratio ? <div className="mt-2 text-xs text-slate-500">{uiText("画幅：")}{item.ratio}</div> : null}</> : null}
          {item.receipt && <MediaTaskDetails receipt={item.receipt} />}
            {item.error ? <div className="mt-2 text-sm text-red-600">{item.error}</div> : null}
          {item.videoUrl ? <ExperimentResultMedia kind="video" urls={[item.videoUrl]} /> : null}
      </ExperimentMessageBubble>
    })}
  </ExperimentHistory>
  const referencePicker = useRef<ExperimentReferenceHandle>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const settingsPanel = useRef<HTMLDivElement>(null)
  const closeSettings = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.stopPropagation()
    setSettingsOpen(false)
    settingsTrigger.current?.focus()
  }
  const composer = <ExperimentOptionBar models={models.map((item) => ({ id: item.id, name: item.name }))} templates={templates.map((item) => ({ id: item.id, name: item.name, version: item.version, preview: item.preview, category: '视频提示词' }))} modelId={modelId} selectedTemplate={selectedTemplate ?? undefined} modelsLoading={modelsLoading} modelsFailed={modelsFailed} onRefreshModels={() => void loadModels(true)} templatesLoading={templatesLoading} templatesFailed={templatesFailed} onRefreshTemplates={() => void loadTemplates(true)} disabled={disabled} modelLabel={uiText("视频模型")} onModelChange={selectModel} onTemplateChange={selectTemplate} onModelOpenChange={(open) => { if (open) void loadModels() }} onTemplateOpenChange={(open) => { if (open) void loadTemplates() }} referenceAction={{ label: uiText("配置参考素材"), onOpen: trigger => referencePicker.current?.open(trigger) }} >{({ modelControl, addControl }) => (<ExperimentComposer submitting={disabled} submitDisabled={disabled || submission.outcomePending || capabilityBlocked || ratioConflict || durationConflict || modeConflict || referenceIssues.length > 0} onSubmit={() => void submit()} options={<>{modelControl}
    <Popover trigger="click" placement="topRight" open={settingsOpen} onOpenChange={setSettingsOpen}
      afterOpenChange={open => { if (open) settingsPanel.current?.focus() }}
      content={<div ref={settingsPanel} tabIndex={-1} className="experiment-video-settings" onKeyDown={closeSettings}>
      <Select
      value={ratio}
      onChange={setRatio}
      disabled={disabled}
      status={ratioConflict ? 'error' : undefined}
      options={[...new Set([ratio, ...(allowedRatios ?? ratioOptions)])].map(value => ({
        value,
        label: allowedRatios && !allowedRatios.includes(value) ? uiText("{{value}}（当前模型不支持）", { value }) : value,
        disabled: Boolean(allowedRatios && !allowedRatios.includes(value)),
      }))}
      aria-label={uiText("视频比例")}
    />
    {!!resolutions.length && <Select value={resolution} disabled={disabled} placeholder={uiText('分辨率')}
      aria-label={uiText('分辨率')} options={resolutions.map(value => ({ value, label: value }))}
      onChange={value => { setResolution(value); setSeconds(undefined) }} />}
    {duration && (Array.isArray(duration)
      ? <Select value={seconds} disabled={disabled} placeholder={uiText('时长（秒）')} aria-label={uiText('时长（秒）')}
        options={duration.map(value => ({ value, label: value }))} onChange={setSeconds} />
      : <InputNumber value={seconds} precision={0} disabled={disabled} placeholder={uiText('时长（秒）')}
        aria-label={uiText('时长（秒）')} min={duration.min_seconds} max={duration.max_seconds}
        onChange={value => setSeconds(value ?? undefined)} />)}
    </div>}>
      <Button ref={settingsTrigger} type="text" aria-label={uiText('生成参数')} aria-expanded={settingsOpen}
        onKeyDown={settingsOpen ? closeSettings : undefined} disabled={disabled} danger={ratioConflict || durationConflict}>
        {seconds === undefined ? ratio : uiText('{{ratio}} · {{seconds}} 秒', { ratio, seconds })}
      </Button>
    </Popover></>} addAction={addControl} contextActions={<>

    <VideoExperimentReferences ref={referencePicker}
      key={sessionId ?? 'draft'}
      value={references}
      onChange={next => { setFrameFileIds(next.frames); setSubjectReferences(next.subjects) }}
      files={files}
      libraryState={libraryState}
      onRetryLibrary={() => void loadLibrary()}
      onUploaded={onUploaded}
      capability={capability}
      disabled={disabled}
    />
  </>} feedback={<>     {capabilityState === 'loading' && <span role="status" className="experiment-video-reference-summary">{uiText("正在读取视频模型能力")}</span>}
    {capabilityState === 'failed' && <span role="alert" className="experiment-video-reference-issue">{uiText("视频模型能力读取失败")} <Button type="link" onClick={() => void loadCapability(modelId)}>{uiText("重试读取能力")}</Button></span>}
    {capabilityIncomplete && <span className="experiment-video-reference-summary">{uiText("模型未提供完整参考限制，提交时由服务端校验")}</span>}
    {ratioConflict && <span role="alert" className="experiment-video-reference-issue">{uiText("当前模型不支持比例")} {ratio}{uiText("，请重新选择")}</span>}
    {modeConflict && <span role="alert" className="experiment-video-reference-issue">{uiText('当前模型不支持此视频操作')}</span>}
    {durationConflict && <span role="alert" className="experiment-video-reference-issue">{uiText('请选择允许的分辨率和时长')}</span>}
    {referenceIssues.length > 0 && <span role="alert" className="experiment-video-reference-issue">{referenceIssues.join('；')}</span>}
</>}>{replacementDialog}<ExperimentSubmissionFeedback notice={submission.notice} onCheck={() => void submission.checkHistory()} onAcknowledge={submission.acknowledgeUnknown} /><ExperimentPromptEditor template={selectedTemplate} templateValues={templateValues} draft={draft} placeholder={uiText("描述你想生成的视频；Shift + Enter 换行")} label={uiText("视频提示词")} disabled={disabled} submitOnEnter onSubmit={() => void submit()} onDraftChange={setDraft} onTemplateValuesChange={setTemplateValues} onUseFreeInput={applyFreeInput} /></ExperimentComposer>)}</ExperimentOptionBar>
  const clearHistory = async () => {
    if (!sessionId || !clearSessionMessages) return
    await clearSessionMessages(sessionId)
    history.clearLocalHistory()
    await history.refresh()
  }
  const clearContent = messages.length && !disabled && clearSessionMessages ? clearHistory : undefined
  return render({ hasMessages: messages.length > 0, history: historyNode, composer, clearContent, disabled })
}
