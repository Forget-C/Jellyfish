/**
 * 文本实验室模态。
 *
 * 模态只处理文本历史的呈现、文本生成和输入配置；会话选择、URL 与页面布局
 * 仍由统一实验室页面负责，从而避免文本实验室重新成为独立页面。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Spin, Tag, message } from 'antd'
import { ClearOutlined } from '@ant-design/icons'
import {
  LlmService,
  StudioExperimentSessionsService,
  StudioPromptsService,
  StudioTextLabService,
  type ExperimentMessageRead,
  type ExperimentSessionRead,
  type ModelRead,
  type PromptTemplateRead,
} from '../../../../services/generated'
import { ExperimentComposer } from '../components/ExperimentComposer'
import { ExperimentEmptyState } from '../components/ExperimentEmptyState'
import { ExperimentHistoryRestoreButton } from '../components/ExperimentHistoryRestoreButton'
import { ExperimentMessageBubble } from '../components/ExperimentMessageBubble'
import { ExperimentOptionBar } from '../components/ExperimentOptionBar'
import { ExperimentPromptEditor } from '../components/ExperimentPromptEditor'
import { createPromptTemplateValues, renderPromptTemplate } from '../components/PromptTemplateForm'
import { useExperimentHistory } from '../hooks/useExperimentHistory'
import { focusExperimentPromptEditor, readExperimentInputSnapshot, type ExperimentInputSnapshot } from '../experimentInputSnapshot'

/** 文本实验室可使用的提示词模板类别。 */
const textPromptCategories = [
  'frame_head_prompt',
  'frame_tail_prompt',
  'frame_key_prompt',
  'video_prompt',
  'storyboard_prompt',
] as const

/** 模板类别在文本实验室中的用户可见名称。 */
const textPromptCategoryLabels: Record<string, string> = {
  frame_head_prompt: '首帧图片提示词',
  frame_tail_prompt: '尾帧图片提示词',
  frame_key_prompt: '关键帧图片提示词',
  video_prompt: '视频提示词',
  storyboard_prompt: '分镜提示词',
}

type LocalMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  inputSnapshot?: ExperimentInputSnapshot
}

/** 统一页面通过 render-prop 将模态内容填充进共享布局的各个区域。 */
export type TextExperimentModeRenderProps = {
  history: ReactNode
  composer: ReactNode
  extra: ReactNode
  disabled: boolean
}

/** 文本模态依赖页面壳提供会话创建与清空动作，不直接管理侧栏或路由。 */
export type TextExperimentModeProps = {
  sessionId?: string
  ensureSession: (labType: 'text') => Promise<ExperimentSessionRead>
  onClearSession: (sessionId: string) => Promise<void>
  onSubmittingChange?: (submitting: boolean) => void
  render: (parts: TextExperimentModeRenderProps) => ReactNode
}

/** 将服务端原始消息限制为文本模态可呈现的用户和助手消息。 */
function toLocalMessages(messages: ExperimentMessageRead[]): LocalMessage[] {
  return messages
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({
      id: item.id,
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: item.content ?? '',
      inputSnapshot: item.role === 'user' ? readExperimentInputSnapshot(item) : undefined,
    }))
}

/** 为刚提交、尚未完成下一次历史读取的消息生成稳定的浏览器内标识。 */
function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 提供文本模态的历史展示和生成输入。
 *
 * 首次有效提交才通过 ensureSession 创建会话；因此草稿状态不会产生空会话。
 */
export function TextExperimentMode({
  sessionId,
  ensureSession,
  onClearSession,
  onSubmittingChange,
  render,
}: TextExperimentModeProps) {
  const [models, setModels] = useState<ModelRead[]>([])
  const [templates, setTemplates] = useState<PromptTemplateRead[]>([])
  const [modelId, setModelId] = useState<string>()
  const [templateId, setTemplateId] = useState<string>()
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const historyState = useExperimentHistory(sessionId)
  const previousSessionIdRef = useRef(sessionId)

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templateId, templates],
  )

  /**
   * 将共享 Hook 取得的持久化历史投影为文本聊天气泡。
   *
   * 历史请求可能在用户消息刚持久化后才返回旧快照，因此同一会话内只补充
   * 尚未在本地出现的消息，避免用旧快照覆盖乐观追加的消息；切换会话时则完整替换。
   */
  useEffect(() => {
    const persistedMessages = toLocalMessages(historyState.messages)
    if (previousSessionIdRef.current !== sessionId) {
      previousSessionIdRef.current = sessionId
      setLocalMessages(persistedMessages)
      return
    }
    setLocalMessages((current) => {
      const persistedIds = new Set(persistedMessages.map((item) => item.id))
      return [...persistedMessages, ...current.filter((item) => !persistedIds.has(item.id))]
    })
  }, [historyState.messages, sessionId])

  /** 向页面壳同步提交状态，以便侧栏等共享操作在生成期间保持一致。 */
  useEffect(() => {
    onSubmittingChange?.(submitting)
  }, [onSubmittingChange, submitting])

  /** 首次打开模型选择器时读取模型，并在当前模态生命周期内缓存。 */
  const loadModels = async () => {
    if (models.length || modelsLoading) return
    setModelsLoading(true)
    try {
      const response = await LlmService.listModelsApiV1LlmModelsGet({
        category: 'text', page: 1, pageSize: 100, order: 'updated_at', isDesc: true,
      })
      const items = response.data?.items ?? []
      setModels(items)
      if (items.length === 1) setModelId(items[0].id)
    } catch {
      message.error('加载文本模型失败')
    } finally {
      setModelsLoading(false)
    }
  }

  /** 首次打开提示词选择器时读取所有适用于文本生成的模板。 */
  const loadTemplates = async () => {
    if (templates.length || templatesLoading) return
    setTemplatesLoading(true)
    try {
      const responses = await Promise.all(textPromptCategories.map((category) => (
        StudioPromptsService.listPromptTemplatesApiV1StudioPromptsGet({
          category, page: 1, pageSize: 100, order: 'updated_at', isDesc: true,
        })
      )))
      setTemplates(responses.flatMap((response) => response.data?.items ?? []))
    } catch {
      message.error('加载文本提示词失败')
    } finally {
      setTemplatesLoading(false)
    }
  }

  /** 切换模板时初始化变量表单，并清除不再适用的自由输入草稿。 */
  const handleSelectTemplate = (nextTemplateId?: string) => {
    setTemplateId(nextTemplateId)
    const template = templates.find((item) => item.id === nextTemplateId)
    setTemplateValues(template ? createPromptTemplateValues(template) : {})
    if (template) setDraft('')
  }

  const currentPrompt = selectedTemplate
    ? renderPromptTemplate(selectedTemplate.content, templateValues).trim()
    : draft.trim()

  /** 首条消息先持久化会话和用户输入，再调用模型并保存模型回复。 */
  const handleSubmit = async () => {
    if (sessionId && historyState.loading) {
      message.info('正在加载会话历史，请稍后再发送')
      return
    }
    if (!modelId) {
      message.warning('请选择文本模型')
      return
    }
    if (!currentPrompt) {
      message.warning(selectedTemplate ? '请填写模板变量，生成有效提示词' : '请输入提示词')
      return
    }

    setSubmitting(true)
    try {
      const session = await ensureSession('text')
      const persistedUser = await StudioExperimentSessionsService
        .createExperimentMessageApiV1StudioExperimentSessionsSessionIdMessagesPost({
          sessionId: session.id,
          requestBody: {
            role: 'user',
            content: currentPrompt,
            payload: { model_id: modelId, input_snapshot: { version: 1, model_id: modelId, prompt: currentPrompt } },
          },
        })
      setLocalMessages((current) => [...current, {
        id: persistedUser.data?.id ?? createMessageId(), role: 'user', content: currentPrompt,
      }])
      if (!selectedTemplate) setDraft('')

      const response = await StudioTextLabService.generateTextLabResponseApiV1StudioTextLabGeneratePost({
        requestBody: { model_id: modelId, messages: [{ role: 'user', content: currentPrompt }] },
      })
      const content = response.data?.content?.trim()
      if (!content) throw new Error('模型未返回文本')
      const persistedAssistant = await StudioExperimentSessionsService
        .createExperimentMessageApiV1StudioExperimentSessionsSessionIdMessagesPost({
          sessionId: session.id,
          requestBody: { role: 'assistant', content, payload: { model_id: modelId } },
        })
      setLocalMessages((current) => [...current, {
        id: persistedAssistant.data?.id ?? createMessageId(), role: 'assistant', content,
      }])
    } catch {
      if (!selectedTemplate) setDraft(currentPrompt)
      message.error('文本模型调用失败，请检查模型、供应商配置和服务日志')
    } finally {
      setSubmitting(false)
    }
  }

  /** 清空服务端与浏览器内的当前会话消息，草稿态无需执行该操作。 */
  const handleClearSession = async () => {
    if (!sessionId) return
    try {
      await onClearSession(sessionId)
      historyState.clearLocalHistory()
      setLocalMessages([])
    } catch {
      message.error('清空会话失败；含生成任务的会话不可清空')
    }
  }

  /** Restores a prior user message as editable free text without spending another model call. */
  const restoreUserMessage = (item: LocalMessage) => {
    if (submitting) return
    const snapshot = item.inputSnapshot
    setTemplateId(undefined)
    setTemplateValues({})
    setDraft(snapshot?.prompt ?? item.content)
    if (snapshot?.model_id) setModelId(snapshot.model_id)
    focusExperimentPromptEditor()
    message.success('已回填历史输入，可修改后重新发送')
  }

  return render({
    extra: (
      <Button
        icon={<ClearOutlined />}
        disabled={!sessionId || !localMessages.length || submitting}
        onClick={() => void handleClearSession()}
      >
        清空会话
      </Button>
    ),
    history: (
      <>
        {historyState.loading ? <div className="flex h-72 items-center justify-center"><Spin /></div> : null}
        {historyState.hasMoreHistory ? (
          <Button size="small" loading={historyState.loadingMore} onClick={() => void historyState.loadMore()}>
            加载更早消息
          </Button>
        ) : null}
        {!historyState.loading && localMessages.length === 0 ? (
          <ExperimentEmptyState description="选择模型并输入提示词，开始一轮文本实验" />
        ) : null}
        {localMessages.map((item) => (
          <ExperimentMessageBubble
            key={item.id}
            align={item.role === 'user' ? 'right' : 'left'}
            footer={item.role === 'user' ? <ExperimentHistoryRestoreButton disabled={submitting} onRestore={() => restoreUserMessage(item)} /> : undefined}
            header={<Tag color={item.role === 'user' ? 'blue' : 'green'}>{item.role === 'user' ? '你' : '模型'}</Tag>}
            tone={item.role === 'user' ? 'user' : 'assistant'}
          >
            {item.content}
          </ExperimentMessageBubble>
        ))}
        {submitting ? <div className="mr-auto max-w-[85%]"><Tag color="green">模型</Tag><div className="mt-1 rounded-lg bg-gray-50 px-3 py-2"><Spin size="small" /> 正在生成…</div></div> : null}
      </>
    ),
    composer: (
      <ExperimentComposer
        submitting={submitting}
        submitDisabled={submitting || Boolean(sessionId && historyState.loading)}
        onSubmit={() => void handleSubmit()}
        options={(
          <ExperimentOptionBar
            models={models.map((model) => ({ id: model.id, name: model.name }))}
            templates={templates.map((template) => ({
              id: template.id, name: template.name, version: template.version,
              preview: template.preview, category: textPromptCategoryLabels[template.category],
            }))}
            modelId={modelId}
            templateId={templateId}
            modelsLoading={modelsLoading}
            templatesLoading={templatesLoading}
            disabled={submitting}
            modelLabel="文本模型"
            modelPlaceholder="选择已登记的文本模型"
            onModelChange={setModelId}
            onTemplateChange={handleSelectTemplate}
            onModelOpenChange={(open) => { if (open) void loadModels() }}
            onTemplateOpenChange={(open) => { if (open) void loadTemplates() }}
          />
        )}
      >
        <ExperimentPromptEditor
          template={selectedTemplate}
          templateValues={templateValues}
          draft={draft}
          placeholder="输入提示词；Shift + Enter 换行"
          minRows={5}
          disabled={submitting}
          submitOnEnter
          onDraftChange={setDraft}
          onTemplateValuesChange={setTemplateValues}
          onUseFreeInput={(renderedPrompt) => {
            setTemplateId(undefined)
            setTemplateValues({})
            setDraft(renderedPrompt)
          }}
          onSubmit={() => void handleSubmit()}
        />
      </ExperimentComposer>
    ),
    disabled: submitting,
  })
}
