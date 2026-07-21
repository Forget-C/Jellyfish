/**
 * 文本生成实验室。
 *
 * 页面负责浏览器内的连续对话历史；通用 Composer 负责模型、模板与输入交互，
 * 从而可被后续图片和视频实验室复用。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { ExperimentSessionSidebar } from '../experiment/components/ExperimentSessionSidebar'
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
  const navigate = useNavigate()
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
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templateId, templates],
  )

  /** 首次打开模型选择器时读取文本模型，并在本页缓存结果。 */
  const loadModels = async () => {
    if (models.length || modelsLoading) return
    setModelsLoading(true)
    try {
      const response = await LlmService.listModelsApiV1LlmModelsGet({ category: 'text', page: 1, pageSize: 100, order: 'updated_at', isDesc: true })
      const items = response.data?.items ?? []
      setModels(items)
      if (items.length === 1) setModelId(items[0].id)
    } catch { message.error('加载文本模型失败') } finally { setModelsLoading(false) }
  }

  /** 首次打开提示词选择器时读取可用模板，并在本页缓存结果。 */
  const loadTemplates = async () => {
    if (templates.length || templatesLoading) return
    setTemplatesLoading(true)
    try {
      const responses = await Promise.all(textPromptCategories.map((category) => StudioPromptsService.listPromptTemplatesApiV1StudioPromptsGet({ category, page: 1, pageSize: 100, order: 'updated_at', isDesc: true })))
      setTemplates(responses.flatMap((response) => response.data?.items ?? []))
    } catch { message.error('加载文本提示词失败') } finally { setTemplatesLoading(false) }
  }

  useEffect(() => {
    /** 加载最近文本实验会话，并恢复当前会话的用户可见历史。 */
    const loadSessions = async () => {
      try {
        const responses = await Promise.all((['text', 'image', 'video'] as ExperimentSessionRead['lab_type'][]).map((labType) => StudioExperimentSessionsService.listExperimentSessionsApiV1StudioExperimentSessionsGet({ labType })))
        const items = responses.flatMap((response) => response.data ?? []).sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
        const current = items.find((item) => item.id === searchParams.get('session')) ?? items[0]
        setSessions(items)
        if (!current) { setSessionId(undefined); return }
        if (current.lab_type !== 'text') { navigate(`/${current.lab_type}-lab?session=${current.id}`, { replace: true }); return }
        setSessionId(current.id)
      } catch {
        message.error('加载文本会话失败')
      } finally {
        setSessionsLoading(false)
      }
    }
    void loadSessions()
    // 仅在页面挂载时恢复 URL 指定会话，避免 URL 回写覆盖草稿态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    setSubmitting(true)
    try {
      const session = sessionId ? undefined : (await StudioExperimentSessionsService.createExperimentSessionApiV1StudioExperimentSessionsPost({ requestBody: { lab_type: 'text', title: '新文本会话' } })).data
      const activeSessionId = session?.id ?? sessionId
      if (!activeSessionId) throw new Error('创建文本会话失败')
      if (session) { setSessions((current) => [session, ...current]); setSessionId(session.id) }
      const persistedUser = await StudioExperimentSessionsService.createExperimentMessageApiV1StudioExperimentSessionsSessionIdMessagesPost({ sessionId: activeSessionId, requestBody: { role: 'user', content: currentPrompt, payload: { model_id: modelId } } })
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
      const persistedAssistant = await StudioExperimentSessionsService.createExperimentMessageApiV1StudioExperimentSessionsSessionIdMessagesPost({ sessionId: activeSessionId, requestBody: { role: 'assistant', content, payload: { model_id: modelId } } })
      setMessages((current) => [...current, { id: persistedAssistant.data?.id ?? createMessageId(), role: 'assistant', content }])
    } catch {
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

  /** 进入指定模态的未持久化草稿态，首条有效提交时才创建会话。 */
  const handleCreateSession = (labType: ExperimentSessionRead['lab_type'] = 'text') => {
    if (labType !== 'text') { navigate(`/${labType}-lab`); return }
    setSessionId(undefined); setMessages([]); setDraft(''); setTemplateId(undefined); setTemplateValues({}); setSearchParams({}, { replace: true })
  }

  /** 更新指定会话标题并同步统一最近会话列表。 */
  const handleRenameSession = async (targetSessionId: string, title: string) => {
    const response = await StudioExperimentSessionsService.updateExperimentSessionApiV1StudioExperimentSessionsSessionIdPatch({ sessionId: targetSessionId, requestBody: { title } })
    const updated = response.data
    if (updated) setSessions((current) => current.map((item) => item.id === updated.id ? updated : item))
  }

  /** 删除指定会话后恢复全局最近历史；没有历史时回到文本草稿态。 */
  const handleDeleteSession = async (targetSessionId: string) => {
    await StudioExperimentSessionsService.deleteExperimentSessionApiV1StudioExperimentSessionsSessionIdDelete({ sessionId: targetSessionId })
    const remaining = sessions.filter((item) => item.id !== targetSessionId)
    setSessions(remaining)
    if (targetSessionId !== sessionId) return
    const next = remaining[0]
    if (next?.lab_type === 'text') setSessionId(next.id)
    else if (next) navigate(`/${next.lab_type}-lab?session=${next.id}`)
    else handleCreateSession('text')
  }

  /** 从统一最近会话列表切换；跨模态会话跳转到对应实验页面。 */
  const handleSelectSession = (session: ExperimentSessionRead) => {
    if (session.lab_type !== 'text') { navigate(`/${session.lab_type}-lab?session=${session.id}`); return }
    setSessionId(session.id)
  }

  return (
    <ExperimentLabLayout
      title="文本实验会话"
      extra={<Button icon={<ClearOutlined />} disabled={!messages.length || submitting} onClick={() => void handleClearSession()}>清空会话</Button>}
      sidebar={<ExperimentSessionSidebar value={sessionId} sessions={sessions} disabled={submitting} onChange={handleSelectSession} onStartDraft={handleCreateSession} onRename={handleRenameSession} onDelete={handleDeleteSession} />}
      history={<>
        {sessionsLoading ? <div className="h-72 flex items-center justify-center"><Spin /></div> : null}
        {hasMoreHistory ? <Button size="small" onClick={() => void loadMoreHistory()}>加载更早消息</Button> : null}
        {!sessionsLoading && messages.length === 0 ? <ExperimentEmptyState description="选择模型并输入提示词，开始一轮文本实验" /> : null}
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
          submitDisabled={submitting}
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
          }
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
        </ExperimentComposer>}
    />
  )
}
