/**
 * 文本生成实验室。
 *
 * 页面负责浏览器内的连续对话历史；通用 Composer 负责模型、模板与输入交互，
 * 从而可被后续图片和视频实验室复用。
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, Input, Spin, Tag, message } from 'antd'
import { ClearOutlined } from '@ant-design/icons'
import {
  LlmService,
  StudioPromptsService,
  StudioTextLabService,
  type ModelRead,
  type PromptTemplateRead,
  type TextLabMessage,
} from '../../../services/generated'
import { ExperimentComposer } from '../experiment/components/ExperimentComposer'
import { ExperimentOptionBar } from '../experiment/components/ExperimentOptionBar'
import { PromptTemplateForm, renderPromptTemplate } from '../experiment/components/PromptTemplateForm'
import { WorkspaceLayout } from '../../../components'

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

/** Uses a template's declared default values to initialize one non-persistent experiment run. */
function initialTemplateValues(template: PromptTemplateRead): Record<string, string> {
  const defaults = template.variable_defaults ?? {}
  return Array.from(new Set([...(template.variables ?? []), ...Object.keys(defaults)])).reduce<Record<string, string>>(
    (result, variable) => ({ ...result, [variable]: defaults[variable] ?? '' }),
    {},
  )
}

export default function TextLabPage() {
  const [models, setModels] = useState<ModelRead[]>([])
  const [templates, setTemplates] = useState<PromptTemplateRead[]>([])
  const [modelId, setModelId] = useState<string | undefined>()
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<LocalMessage[]>([])
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

  const handleSelectTemplate = (nextTemplateId?: string) => {
    setTemplateId(nextTemplateId)
    const template = templates.find((item) => item.id === nextTemplateId)
    setTemplateValues(template ? initialTemplateValues(template) : {})
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

    const userMessage: LocalMessage = { id: createMessageId(), role: 'user', content: currentPrompt }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    if (!selectedTemplate) setDraft('')
    setSubmitting(true)
    try {
      const response = await StudioTextLabService.generateTextLabResponseApiV1StudioTextLabGeneratePost({
        requestBody: {
          model_id: modelId,
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
        },
      })
      const content = response.data?.content?.trim()
      if (!content) throw new Error('模型未返回文本')
      setMessages((current) => [...current, { id: createMessageId(), role: 'assistant', content }])
    } catch {
      setMessages(messages)
      if (!selectedTemplate) setDraft(currentPrompt)
      message.error('文本模型调用失败，请检查模型、供应商配置和服务日志')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <WorkspaceLayout>
      <Card
        title="文本实验会话"
        className="app-fill-card"
        extra={<Button icon={<ClearOutlined />} disabled={!messages.length || submitting} onClick={() => setMessages([])}>清空会话</Button>}
      >
        <div className="flex-1 min-h-0 space-y-4 overflow-y-auto pr-1">
        {loading ? <div className="h-72 flex items-center justify-center"><Spin /></div> : null}
        {!loading && messages.length === 0 ? <Empty description="选择模型并输入提示词，开始一轮文本实验" /> : null}
        {messages.map((item) => (
          <div key={item.id} className={item.role === 'user' ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}>
            <Tag color={item.role === 'user' ? 'blue' : 'green'}>{item.role === 'user' ? '你' : '模型'}</Tag>
            <div className={`mt-1 whitespace-pre-wrap rounded-lg px-3 py-2 ${item.role === 'user' ? 'bg-blue-50' : 'bg-gray-50'}`}>
              {item.content}
            </div>
          </div>
        ))}
        {submitting ? <div className="mr-auto max-w-[85%]"><Tag color="green">模型</Tag><div className="mt-1 rounded-lg bg-gray-50 px-3 py-2"><Spin size="small" /> 正在生成…</div></div> : null}
        </div>

        <ExperimentComposer
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
              onModelChange={setModelId}
              onTemplateChange={handleSelectTemplate}
            />
          }
        >
          {selectedTemplate ? (
            <PromptTemplateForm
              template={selectedTemplate}
              values={templateValues}
              disabled={submitting}
              onValuesChange={setTemplateValues}
              onUseFreeInput={(renderedPrompt) => {
                setTemplateId(undefined)
                setTemplateValues({})
                setDraft(renderedPrompt)
              }}
            />
          ) : (
            <Input.TextArea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault()
                  void handleSubmit()
                }
              }}
              placeholder="输入提示词；Shift + Enter 换行"
              autoSize={{ minRows: 4, maxRows: 10 }}
              disabled={submitting || loading}
            />
          )}
        </ExperimentComposer>
      </Card>
    </WorkspaceLayout>
  )
}
