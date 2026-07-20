/**
 * 文本生成实验室。
 *
 * 页面负责浏览器内的连续对话历史；通用 Composer 负责模型、模板与输入交互，
 * 从而可被后续图片和视频实验室复用。
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Spin, Tag, message } from 'antd'
import { ClearOutlined } from '@ant-design/icons'
import {
  LlmService,
  StudioPromptsService,
  StudioExperimentSessionsService,
  StudioTextLabService,
  type ModelRead,
  type PromptTemplateRead,
  type TextLabMessage,
  type ExperimentSessionRead,
} from '../../../services/generated'
import { ExperimentComposer } from '../experiment/components/ExperimentComposer'
import { ExperimentEmptyState } from '../experiment/components/ExperimentEmptyState'
import { ExperimentLabLayout } from '../experiment/components/ExperimentLabLayout'
import { ExperimentOptionBar } from '../experiment/components/ExperimentOptionBar'
import { ExperimentPromptEditor } from '../experiment/components/ExperimentPromptEditor'
import { ExperimentSessionControls } from '../experiment/components/ExperimentSessionControls'
import { createPromptTemplateValues, renderPromptTemplate } from '../experiment/components/PromptTemplateForm'

type LocalMessage = TextLabMessage & { id: string }

/** 文本实验室可使用的模板类别，均用于向文本模型生成或整理文案。 */
const textPromptCategories = [
  'frame_head_prompt',
  'frame_tail_prompt',
  'frame_key_prompt',
  'video_prompt',
  'storyboard_prompt',
] as const

const textPromptCategoryLabels: Record<string, string> = {
  frame_head_prompt: '首帧图片提示词',
  frame_tail_prompt: '尾帧图片提示词',
  frame_key_prompt: '关键帧图片提示词',
  video_prompt: '视频提示词',
  storyboard_prompt: '分镜提示词',
}

/** Builds a stable local identifier for a browser-only laboratory message. */
function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function TextLabPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [models, setModels] = useState<ModelRead[]>([])
  const [templates, setTemplates] = useState<PromptTemplateRead[]>([])
  const [modelId, setModelId] = useState<string | undefined>()
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [sessions, setSessions] = useState<ExperimentSessionRead[]>([])
  const [sessionId, setSessionId] = useState<string>()
  const [historyPage, setHistoryPage] = useState(1)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templateId, templates],
  )

  useEffect(() => {
    /** Loads selectable text models and prompt templates without coupling the lab to a project. */
    const loadOptions = async () => {
      setLoading(true)
      try {
        const [modelsResponse, ...templateResponses] = await Promise.all([
          LlmService.listModelsApiV1LlmModelsGet({ category: 'text', page: 1, pageSize: 100, order: 'updated_at', isDesc: true }),
          ...textPromptCategories.map((category) => StudioPromptsService.listPromptTemplatesApiV1StudioPromptsGet({
            category,
            page: 1,
            pageSize: 100,
            order: 'updated_at',
            isDesc: true,
          })),
        ])
        const textModels = modelsResponse.data?.items ?? []
        setModels(textModels)
        setTemplates(templateResponses.flatMap((response) => response.data?.items ?? []))
        if (textModels.length === 1) setModelId(textModels[0].id)
      } catch {
        message.error('加载文本实验室配置失败')
      } finally {
        setLoading(false)
      }
    }
    void loadOptions()
  }, [])

  useEffect(() => {
    /** 加载最近文本实验会话，并恢复当前会话的用户可见历史。 */
    const loadSessions = async () => {
      try {
        const response = await StudioExperimentSessionsService.listExperimentSessionsApiV1StudioExperimentSessionsGet({ labType: 'text' })
        const items = response.data ?? []
        const requestedId = searchParams.get('session')
        const current = items.find((item) => item.id === requestedId) ?? items[0] ?? (await StudioExperimentSessionsService.createExperimentSessionApiV1StudioExperimentSessionsPost({ requestBody: { lab_type: 'text', title: '新文本会话' } })).data
        if (!current) throw new Error('创建文本会话失败')
        setSessions(current.id === items[0]?.id ? items : [current, ...items])
        setSessionId(current.id)
      } catch {
        message.error('加载文本会话失败')
      }
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
        setMessages((response.data ?? []).filter((item) => item.role !== 'task').map((item) => ({ id: item.id, role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content ?? '' })))
        setHistoryPage(1)
        setHasMoreHistory((response.data?.length ?? 0) === 50)
      } catch {
        message.error('加载文本历史失败')
      }
    }
    void loadMessages()
  }, [sessionId])

  /** 读取当前会话更早的一页历史，并保留时间正序展示。 */
  const loadMoreHistory = async () => {
    if (!sessionId || !hasMoreHistory) return
    const nextPage = historyPage + 1
    try {
      const response = await StudioExperimentSessionsService.listExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesGet({ sessionId, page: nextPage, pageSize: 50 })
      const older = (response.data ?? []).filter((item) => item.role !== 'task').map((item) => ({ id: item.id, role: item.role === 'assistant' ? 'assistant' as const : 'user' as const, content: item.content ?? '' }))
      setMessages((current) => [...older, ...current])
      setHistoryPage(nextPage)
      setHasMoreHistory((response.data?.length ?? 0) === 50)
    } catch { message.error('加载更早历史失败') }
  }

  const handleSelectTemplate = (nextTemplateId?: string) => {
    setTemplateId(nextTemplateId)
    const template = templates.find((item) => item.id === nextTemplateId)
    setTemplateValues(template ? createPromptTemplateValues(template) : {})
    if (template) setDraft('')
  }

  const currentPrompt = selectedTemplate
    ? renderPromptTemplate(selectedTemplate.content, templateValues).trim()
    : draft.trim()

  const handleSubmit = async () => {
    if (!modelId) {
      message.warning('请选择文本模型')
      return
    }
    if (!currentPrompt) {
      message.warning(selectedTemplate ? '请填写模板变量，生成有效提示词' : '请输入提示词')
      return
    }

    if (!sessionId) return message.warning('会话尚未准备完成')

    setSubmitting(true)
    try {
      const persistedUser = await StudioExperimentSessionsService.createExperimentMessageApiV1StudioExperimentSessionsSessionIdMessagesPost({ sessionId, requestBody: { role: 'user', content: currentPrompt, payload: { model_id: modelId } } })
      const userMessage: LocalMessage = { id: persistedUser.data?.id ?? createMessageId(), role: 'user', content: currentPrompt }
      const nextMessages = [...messages, userMessage]
      setMessages(nextMessages)
      if (!selectedTemplate) setDraft('')
      const response = await StudioTextLabService.generateTextLabResponseApiV1StudioTextLabGeneratePost({
        requestBody: {
          model_id: modelId,
          messages: [{ role: 'user', content: currentPrompt }],
        },
      })
      const content = response.data?.content?.trim()
      if (!content) throw new Error('模型未返回文本')
      const persistedAssistant = await StudioExperimentSessionsService.createExperimentMessageApiV1StudioExperimentSessionsSessionIdMessagesPost({ sessionId, requestBody: { role: 'assistant', content, payload: { model_id: modelId } } })
      setMessages((current) => [...current, { id: persistedAssistant.data?.id ?? createMessageId(), role: 'assistant', content }])
    } catch {
      setMessages(messages)
      if (!selectedTemplate) setDraft(currentPrompt)
      message.error('文本模型调用失败，请检查模型、供应商配置和服务日志')
    } finally {
      setSubmitting(false)
    }
  }

  /** 服务端清空当前会话，确保刷新后历史也保持为空。 */
  const handleClearSession = async () => {
    if (!sessionId) return
    try {
      await StudioExperimentSessionsService.clearExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesDelete({ sessionId })
      setMessages([])
    } catch { message.error('清空会话失败；含生成任务的会话不可清空') }
  }

  /** 创建并切换到新的空文本会话。 */
  const handleCreateSession = async () => {
    try {
      const response = await StudioExperimentSessionsService.createExperimentSessionApiV1StudioExperimentSessionsPost({ requestBody: { lab_type: 'text', title: '新文本会话' } })
      const session = response.data
      if (!session) throw new Error('未返回会话')
      setSessions((current) => [session, ...current])
      setSessionId(session.id)
      setMessages([])
      setDraft('')
    } catch { message.error('新建会话失败') }
  }

  /** 更新当前会话标题并同步下拉列表。 */
  const handleRenameSession = async (title: string) => {
    if (!sessionId) return
    const response = await StudioExperimentSessionsService.updateExperimentSessionApiV1StudioExperimentSessionsSessionIdPatch({ sessionId, requestBody: { title } })
    const updated = response.data
    if (updated) setSessions((current) => current.map((item) => item.id === updated.id ? updated : item))
  }

  /** 删除当前会话后切换到剩余最近会话或创建一个新会话。 */
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
      title="文本实验会话"
      extra={<div className="flex items-center gap-2"><ExperimentSessionControls value={sessionId} sessions={sessions} disabled={submitting} onChange={setSessionId} onCreate={() => void handleCreateSession()} onRename={handleRenameSession} onDelete={handleDeleteSession} /><Button icon={<ClearOutlined />} disabled={!messages.length || submitting} onClick={() => void handleClearSession()}>清空会话</Button></div>}
      history={<>
        {loading ? <div className="h-72 flex items-center justify-center"><Spin /></div> : null}
        {hasMoreHistory ? <Button size="small" onClick={() => void loadMoreHistory()}>加载更早消息</Button> : null}
        {!loading && messages.length === 0 ? <ExperimentEmptyState description="选择模型并输入提示词，开始一轮文本实验" /> : null}
        {messages.map((item) => (
          <div key={item.id} className={item.role === 'user' ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}>
            <Tag color={item.role === 'user' ? 'blue' : 'green'}>{item.role === 'user' ? '你' : '模型'}</Tag>
            <div className={`mt-1 whitespace-pre-wrap rounded-lg px-3 py-2 ${item.role === 'user' ? 'bg-blue-50' : 'bg-gray-50'}`}>
              {item.content}
            </div>
          </div>
        ))}
        {submitting ? <div className="mr-auto max-w-[85%]"><Tag color="green">模型</Tag><div className="mt-1 rounded-lg bg-gray-50 px-3 py-2"><Spin size="small" /> 正在生成…</div></div> : null}
      </>}
      composer={<ExperimentComposer
          submitting={submitting}
          submitDisabled={loading}
          onSubmit={() => void handleSubmit()}
          options={
            <ExperimentOptionBar
              models={models.map((model) => ({ id: model.id, name: model.name }))}
              templates={templates.map((template) => ({
                id: template.id,
                name: template.name,
                version: template.version,
                preview: template.preview,
                category: textPromptCategoryLabels[template.category],
              }))}
              modelId={modelId}
              templateId={templateId}
              loading={loading}
              disabled={submitting}
              modelLabel="文本模型"
              modelPlaceholder="选择已登记的文本模型"
              onModelChange={setModelId}
              onTemplateChange={handleSelectTemplate}
            />
          }
        >
          <ExperimentPromptEditor
            template={selectedTemplate}
            templateValues={templateValues}
            draft={draft}
            placeholder="输入提示词；Shift + Enter 换行"
            minRows={5}
            disabled={submitting || loading}
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
        </ExperimentComposer>}
    />
  )
}
