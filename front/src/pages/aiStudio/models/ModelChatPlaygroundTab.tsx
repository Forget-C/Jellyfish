import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Input, Select, Space, Spin, Typography, message as antdMessage } from 'antd'
import { DeleteOutlined, SendOutlined } from '@ant-design/icons'

import { ApiError, CancelError } from '../../../services/generated'
import { LlmService } from '../../../services/generated/services/LlmService'
import type { ModelCategoryKey, ModelRead } from '../../../services/generated'
import { categoryLabelMap } from './constants'

type ChatTurn = { role: 'user' | 'assistant'; content: string }

/**
 * 文本模型试聊：选择已保存的文本模型后发送消息，用于调试接入（不计入业务任务队列）。
 */
export default function ModelChatPlaygroundTab() {
  const [models, setModels] = useState<ModelRead[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [modelId, setModelId] = useState<string | undefined>()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [sending, setSending] = useState(false)

  const textModels = useMemo(
    () => models.filter((m) => m.category === ('text' as ModelCategoryKey)),
    [models],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoadingList(true)
      try {
        const res = await LlmService.listModelsApiV1LlmModelsGet({
          page: 1,
          pageSize: 200,
          order: 'updated_at',
          isDesc: true,
        })
        if (!cancelled) setModels(res.data?.items ?? [])
      } catch {
        antdMessage.error('加载模型列表失败')
      } finally {
        if (!cancelled) setLoadingList(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!modelId || !trimmed) {
      antdMessage.warning('请选择文本模型并输入内容')
      return
    }
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
    setSending(true)
    try {
      const res = await LlmService.chatTestLlmModelApiV1LlmModelsModelIdChatTestPost({
        modelId,
        requestBody: { message: trimmed },
      })
      const reply = res.data?.reply ?? ''
      setMessages((prev) => [...prev, { role: 'assistant', content: reply || '（空回复）' }])
    } catch (err: unknown) {
      if (err instanceof CancelError) return
      let detail = '发送失败'
      if (err instanceof ApiError) {
        const b = err.body as { message?: string } | undefined
        detail = b?.message ?? err.message
      }
      antdMessage.error(detail)
      setMessages((prev) => [...prev, { role: 'assistant', content: `【错误】${detail}` }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 p-4 gap-3 overflow-hidden max-w-4xl mx-auto w-full">
      <Alert
        type="info"
        showIcon
        message="仅支持「文本生成」类模型；发送将调用上游 API，可能产生费用。"
      />

      <Space wrap className="flex-shrink-0 items-center">
        <Typography.Text className="text-gray-600">选择模型</Typography.Text>
        <Select<string>
          className="min-w-[220px]"
          placeholder={loadingList ? '加载中…' : '请选择文本模型'}
          loading={loadingList}
          allowClear
          value={modelId}
          options={textModels.map((m) => ({
            label: `${m.name} · ${categoryLabelMap[m.category]}`,
            value: m.id,
          }))}
          onChange={(v) => setModelId(v)}
          notFoundContent={textModels.length ? '无匹配' : '暂无文本模型，请先到「模型」页添加'}
        />
        <Button icon={<DeleteOutlined />} onClick={() => setMessages([])} disabled={!messages.length}>
          清空对话
        </Button>
      </Space>

      <div className="flex-1 min-h-[280px] overflow-auto rounded border border-gray-200 bg-gray-50 p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-12">选择模型后输入消息开始试聊</div>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${i}-${m.role}`}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-800'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {sending ? (
          <div className="flex justify-start">
            <Spin size="small" />
          </div>
        ) : null}
      </div>

      <div className="flex-shrink-0 space-y-2">
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          rows={4}
          maxLength={8000}
          showCount
          disabled={!modelId || sending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={sending}
          disabled={!modelId}
          onClick={() => void handleSend()}
        >
          发送
        </Button>
      </div>
    </div>
  )
}
