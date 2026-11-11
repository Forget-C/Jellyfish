/**
 * 图片实验室模态。
 *
 * 该组件只处理图片生成特有的输入、异步任务和结果呈现；会话选择及页面布局由
 * ExperimentLabPage 统一维护，从而避免图片实验室继续作为独立页面存在。
 */
import { useRef, useCallback, useEffect, useState, type ReactNode } from 'react'
import { message } from 'antd'
import {
  StudioFilesService,
  StudioGenerationTasksService,
  type ExperimentMessageRead,
  type ExperimentSessionRead,
  type FileRead,
  type TaskOutputRead,
} from '../../../../services/generated'
import { buildFileDownloadUrl } from '../../assets/utils'
import { ExperimentSubmissionFeedback } from '../components/ExperimentSubmissionFeedback'
import { useExperimentSubmission } from '../hooks/useExperimentSubmission'
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
import { ImageExperimentReferences } from '../components/ImageExperimentReferences'
import { renderPromptTemplate } from '../components/PromptTemplateForm'
import { useExperimentHistory } from '../hooks/useExperimentHistory'
import { useExperimentModels } from '../hooks/useExperimentModels'
import { useExperimentTemplates } from '../hooks/useExperimentTemplates'
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
 * 首次创建会话后，页面壳回写会话 ID；正式任务消息由历史 Hook 接管。
 */
export function ImageExperimentMode({ sessionId, ensureSession, clearSessionMessages, render }: ImageExperimentModeProps) {
  const [files, setFiles] = useState<FileRead[]>([])
  const [libraryState, setLibraryState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [modelId, setModelId] = useState<string>()
  const [draft, setDraft] = useState('')
  const {
    templates, selectedTemplate, templateValues, setTemplateValues, templatesLoading, templatesFailed,
    loadTemplates, selectTemplate, confirmReplacement, applyFreeInput, replacementDialog,
  } = useExperimentTemplates(imagePromptCategories, draft, setDraft)
  const [referenceFileIds, setReferenceFileIds] = useState<string[]>([])
  const history = useExperimentHistory(sessionId)
  const inputSignature = (prompt: string) => JSON.stringify([prompt, selectedTemplate?.id, selectedTemplate?.version, templateValues, referenceFileIds])
  const submission = useExperimentSubmission(sessionId, history, inputSignature(draft))
  const { submitting } = submission
  useExperimentLeaveStatus(submission.dirty)
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
  const currentPrompt = selectedTemplate ? renderPromptTemplate(selectedTemplate.content, templateValues).trim() : draft.trim()

  const loadLibrary = useCallback(async () => {
    setLibraryState('loading')
    try {
      const response = await StudioFilesService.listFilesApiApiV1StudioFilesGet({ page: 1, pageSize: 100, order: 'updated_at', isDesc: true })
      const images = (response.data?.items ?? []).filter(file => file.type === 'image')
      // 保留列表读取期间新上传的文件。
      setFiles(current => [...new Map([...images, ...current].map(file => [file.id, file])).values()])
      setLibraryState('ready')
    } catch {
      setLibraryState('failed')
    }
  }, [])
  useEffect(() => { void loadLibrary() }, [loadLibrary])

  const { models, modelsLoading, modelsFailed, loadModels } = useExperimentModels('image', id => {
    setModelId(current => current ?? id)
  })

  /** 在首条有效输入前创建会话，再经固定统一入口提交图片异步任务。 */
  const handleSubmit = async () => {
    if (!modelId) return message.warning('请选择图片模型')
    if (!currentPrompt) return message.warning(selectedTemplate ? '请填写模板变量，生成有效提示词' : '请输入图片提示词')
    if (disabled) return
    await submission.submitTask({
      ensureSession: () => sessionId ? Promise.resolve({ id: sessionId }) : ensureSession('image'),
      request: async targetSessionId => {
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
        return response.data
      },
      onAccept: (attempt, targetSessionId) => {
        const unchanged = submission.acceptInput(attempt, targetSessionId, inputSignature(''))
        if (unchanged && !selectedTemplate) setDraft(current => current === draft ? '' : current)
        message.success('图片生成任务已创建')
      },
      failureMessage: '创建图片生成任务失败，请检查模型、参考图和服务配置',
    })
  }

  /** 清空当前会话历史，并同步清除图片任务展示。 */
  const handleClear = async () => {
    if (!sessionId || !clearSessionMessages) return
    await clearSessionMessages(sessionId)
    history.clearLocalHistory()
    await history.refresh()
  }

  /** 仅回填历史提示词；完整异步参数只保存在关联任务快照中。 */
  const restoreUserMessage = (item: ImageLabMessage) => {
    if (disabled) return
    confirmReplacement(() => {
      applyFreeInput(item.content)
      setReferenceFileIds([])
      focusExperimentPromptEditor()
      message.info('已回填提示词；请重新选择模型和参考图后生成')
    }, referenceFileIds.length > 0)
  }

  const disabled = submitting || Boolean(runningTaskId)
  const clearContent = messages.length && !disabled && clearSessionMessages ? handleClear : undefined
  const historyContent = <ExperimentHistory key={sessionId ?? 'draft'} history={history} messageCount={messages.length} emptyDescription="选择图片模型并输入提示词，开始一轮图片实验">
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
  const referencePicker = useRef<ExperimentReferenceHandle>(null)
  const composer = <ExperimentOptionBar models={models.map((model) => ({ id: model.id, name: model.name }))} templates={templates.map((template) => ({ id: template.id, name: template.name, version: template.version, preview: template.preview, category: imagePromptCategoryLabels[template.category] }))} modelId={modelId} selectedTemplate={selectedTemplate ?? undefined} modelsLoading={modelsLoading} modelsFailed={modelsFailed} onRefreshModels={() => void loadModels(true)} templatesLoading={templatesLoading} templatesFailed={templatesFailed} onRefreshTemplates={() => void loadTemplates(true)} disabled={disabled} modelLabel="图片模型" onModelChange={setModelId} onTemplateChange={selectTemplate} onModelOpenChange={(open) => { if (open) void loadModels() }} onTemplateOpenChange={(open) => { if (open) void loadTemplates() }} referenceAction={{ label: "添加参考图", onOpen: trigger => referencePicker.current?.open(trigger) }} >{({ modelControl, addControl }) => (<ExperimentComposer
      submitting={disabled} submitDisabled={disabled || submission.outcomePending} onSubmit={() => void handleSubmit()}
      options={modelControl} addAction={addControl}
      contextActions={<ImageExperimentReferences ref={referencePicker}
        key={sessionId ?? 'draft'}
        value={referenceFileIds}
        onChange={setReferenceFileIds}
        files={files}
        libraryState={libraryState}
        onRetryLibrary={() => void loadLibrary()}
        onUploaded={file => setFiles(current => [file, ...current.filter(item => item.id !== file.id)])}
        disabled={disabled}
      />}
    >{replacementDialog}<ExperimentSubmissionFeedback notice={submission.notice} onCheck={() => void submission.checkHistory()} onAcknowledge={submission.acknowledgeUnknown} /><ExperimentPromptEditor template={selectedTemplate} templateValues={templateValues} draft={draft} placeholder="描述你想生成的图片…" label="图片提示词" disabled={disabled} onDraftChange={setDraft} onTemplateValuesChange={setTemplateValues} onUseFreeInput={applyFreeInput} /></ExperimentComposer>)}</ExperimentOptionBar>
  return render({ history: historyContent, composer, clearContent, overlays: null, disabled })
}
