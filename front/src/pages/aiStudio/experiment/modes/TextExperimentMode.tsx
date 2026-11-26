/**
 * 文本实验室模态。
 *
 * 模态只处理文本历史的呈现、文本生成和输入配置；会话选择、URL 与页面布局
 * 仍由统一实验室页面负责，从而避免文本实验室重新成为独立页面。
 */
import { useUiText } from '../../../../uiText'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, message } from 'antd'
import { StopOutlined } from '@ant-design/icons'
import {
  type ExperimentMessageRead,
  type ExperimentSessionRead,
} from '../../../../services/generated'
import { defaultTaskActionErrorMessage } from '../../components/taskActionHelpers'
import { ExperimentSubmissionFeedback } from '../components/ExperimentSubmissionFeedback'
import { isRejectedSubmission, useExperimentSubmission } from '../hooks/useExperimentSubmission'
import { useExperimentLeaveStatus } from '../ExperimentLeaveGuard'
import { ExperimentComposer } from '../components/ExperimentComposer'
import { ExperimentHistory } from '../components/ExperimentHistory'
import { ExperimentHistoryRestoreButton } from '../components/ExperimentHistoryRestoreButton'
import { ExperimentMessageBubble } from '../components/ExperimentMessageBubble'
import { ExperimentTaskStatus } from '../components/ExperimentTaskStatus'
import { ExperimentOptionBar } from '../components/ExperimentOptionBar'
import { ExperimentPromptEditor } from '../components/ExperimentPromptEditor'
import { renderPromptTemplate } from '../components/PromptTemplateForm'
import { useExperimentHistory } from '../hooks/useExperimentHistory'
import { useExperimentModels } from '../hooks/useExperimentModels'
import { useExperimentTemplates } from '../hooks/useExperimentTemplates'
import { focusExperimentPromptEditor, readExperimentInputSnapshot, type ExperimentInputSnapshot } from '../experimentInputSnapshot'
import { applyReply } from '../../../../services/chatSession'
import { chatClient } from '../../../../services/chatSession'
import { followTextTrial } from '../../../../services/textTrialSession'
import { useTrialModelPreference } from '../hooks/useTrialModelPreference'

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
  status?: 'running' | 'succeeded' | 'failed' | 'cancelled'
  progress?: number
  partial?: boolean
  recoveredFromHistory?: boolean
  error?: string
}

/** 统一页面通过 render-prop 将模态内容填充进共享布局的各个区域。 */
export type TextExperimentModeRenderProps = {
  history: ReactNode
  composer: ReactNode
  clearContent?: () => Promise<void>
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
function toLocalMessages(messages: ExperimentMessageRead[], includePartial: boolean): LocalMessage[] {
  return messages.flatMap<LocalMessage>(item => {
    if (item.role !== 'user' && item.role !== 'assistant') return []
    const row: LocalMessage = {
      id: item.id,
      role: item.role,
      content: item.content ?? '',
      status: item.role === 'assistant' ? (item.status === 'failed' || item.status === 'cancelled' ? item.status : 'succeeded') : undefined,
      inputSnapshot: item.role === 'user' ? readExperimentInputSnapshot(item) : undefined,
    }
    const partial = item.payload?.partial_text
    return includePartial && item.role === 'user' && typeof partial === 'string' && partial ? [row, {
      id: 'recovered-' + item.id, role: 'assistant', content: partial, partial: true, recoveredFromHistory: true,
    }] : [row]
  })
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
  const uiText = useUiText()
  const [modelId, setModelId, setSoleModel] = useTrialModelPreference('text', sessionId)
  const [draft, setDraft] = useState('')
  const {
    templates, selectedTemplate, templateValues, setTemplateValues, templatesLoading, templatesFailed,
    loadTemplates, selectTemplate, confirmReplacement, applyFreeInput, replacementDialog,
  } = useExperimentTemplates(textPromptCategories, draft, setDraft)
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([])
  const historyState = useExperimentHistory(sessionId, { readPage: chatClient.textSnapshot })
  const inputSignature = (prompt: string) => JSON.stringify([prompt, selectedTemplate?.id, selectedTemplate?.version, templateValues])
  const submission = useExperimentSubmission(sessionId, historyState, inputSignature(draft))
  const { submitting } = submission
  const liveRun = submitting && !submission.outcomePending
  const previousSessionIdRef = useRef(sessionId)
  const streamAbortRef = useRef<AbortController | null>(null)
  const streamTaskIdRef = useRef<string | undefined>(undefined)
  const terminalRunRef = useRef<string>()
  const stopPending = useRef(false)
  const [stopState, setStopState] = useState<'idle' | 'requesting' | 'requested' | 'failed'>('idle')
  const streamSessionIdRef = useRef<string | undefined>(undefined)

  useEffect(() => () => streamAbortRef.current?.abort(), [])
  useEffect(() => {
    if (streamSessionIdRef.current && streamSessionIdRef.current !== sessionId) streamAbortRef.current?.abort()
  }, [sessionId])

  /**
   * 将共享 Hook 取得的持久化历史投影为文本聊天气泡。
   *
   * 历史请求可能在用户消息刚持久化后才返回旧快照，因此同一会话内只补充
   * 尚未在本地出现的消息，避免用旧快照覆盖乐观追加的消息；切换会话时则完整替换。
   */
  useEffect(() => {
    const persistedMessages = toLocalMessages(historyState.messages, !submitting)
    if (previousSessionIdRef.current !== sessionId) {
      previousSessionIdRef.current = sessionId
      setLocalMessages(persistedMessages)
      return
    }
    setLocalMessages((current) => {
      const persistedIds = new Set(persistedMessages.map((item) => item.id))
      return [...persistedMessages, ...current.filter((item) => !persistedIds.has(item.id) && !item.recoveredFromHistory)]
    })
  }, [historyState.messages, sessionId, submitting])

  /** 向页面壳同步提交状态，以便侧栏等共享操作在生成期间保持一致。 */
  useEffect(() => {
    onSubmittingChange?.(submitting)
  }, [onSubmittingChange, submitting])

  const { models, modelsLoading, modelsFailed, loadModels } = useExperimentModels('text', setSoleModel)

  const currentPrompt = selectedTemplate
    ? renderPromptTemplate(selectedTemplate.content, templateValues).trim()
    : draft.trim()

  /** 提交固定 SSE 文本运行；服务端是 canonical user/assistant 消息的唯一写入者。 */
  const handleSubmit = async () => {
    if (stopPending.current) return
    if (sessionId && historyState.loading) {
      message.info(uiText("正在加载会话历史，请稍后再发送"))
      return
    }
    if (!modelId) {
      message.warning(uiText("请选择文本模型"))
      return
    }
    if (!currentPrompt) {
      message.warning(selectedTemplate ? uiText("请填写模板变量，生成有效提示词") : uiText("请输入提示词"))
      return
    }

    const attempt = submission.begin()
    if (!attempt) return
    setStopState('idle')
    terminalRunRef.current = undefined
    let targetSessionId: string | undefined
    let controller: AbortController | undefined
    let terminal = false
    let acceptedTaskId: string | undefined
    const assistantId = `stream-${createMessageId()}`
    const restoreInput = () => {
      submission.restoreUnsent(attempt)
      if (acceptedTaskId && !selectedTemplate) setDraft(current => current === '' ? draft : current)
    }
    try {
      const session = sessionId ? { id: sessionId } : await ensureSession('text')
      if (!submission.isCurrent(attempt)) return
      targetSessionId = session.id
      attempt.sessionId = session.id
      controller = new AbortController()
      streamAbortRef.current = controller
      streamSessionIdRef.current = session.id
      for await (const event of followTextTrial(session.id, () => chatClient.send({
        sessionId: session.id, requestBody: { model_id: modelId, content: currentPrompt }, idempotencyKey: attempt.requestId,
      }), controller.signal)) {
        if (!submission.isCurrent(attempt)) {
          controller.abort()
          break
        }
        if (event.category === 'turn' && event.type === 'turn.accepted') {
          if (!event.turn_id || acceptedTaskId || event.payload.message?.session_id !== session.id) {
            throw new Error(uiText("文本接收回执与本轮会话不符"))
          }
          acceptedTaskId = event.turn_id
          streamTaskIdRef.current = acceptedTaskId
          const unchanged = submission.acceptInput(attempt, session.id, inputSignature(''))
          if (unchanged && !selectedTemplate) setDraft(current => current === draft ? '' : current)
          historyState.adoptCanonicalMessages(session.id, [event.payload.message])
          setLocalMessages(current => [...current, { id: assistantId, role: 'assistant', content: '', status: 'running' }])
          continue
        }
        if (!acceptedTaskId || event.turn_id !== acceptedTaskId) {
          throw new Error(uiText("文本流未返回可核对的任务身份"))
        }
        if (event.category === 'message') {
          setLocalMessages(current => current.map(item => (
            item.id === assistantId ? { ...item, content: applyReply(item.content, event.payload) } : item
          )))
        } else if (event.type === 'turn.completed') {
          if (event.payload.message?.session_id !== session.id) throw new Error(uiText("文本结果与本轮会话不符"))
          terminal = true
          terminalRunRef.current = acceptedTaskId
          historyState.adoptCanonicalMessages(session.id, [event.payload.message])
          setLocalMessages(current => current.filter(item => item.id !== assistantId))
          void historyState.refresh()
        } else if (event.type === 'turn.failed') {
          if (event.payload.error_code === 'stream_result_unknown') {
            setLocalMessages(current => current.filter(item => item.id !== assistantId))
            await historyState.refresh()
            break
          }
          terminal = true
          terminalRunRef.current = acceptedTaskId
          setLocalMessages(current => current.map(item => (
            item.id === assistantId ? { ...item, status: 'failed', error: event.payload.error ?? undefined } : item
          )))
          restoreInput()
        } else if (event.type === 'turn.stopped') {
          terminal = true
          terminalRunRef.current = acceptedTaskId
          setLocalMessages(current => current.map(item => (
            item.id === assistantId ? { ...item, status: 'cancelled' } : item
          )))
        }
      }
    } catch (error) {
      if (!submission.isCurrent(attempt) || terminal) return
      if (acceptedTaskId && targetSessionId && !controller?.signal.aborted) {
        setLocalMessages(current => current.flatMap(item => {
          if (item.id !== assistantId) return [item]
          return item.content ? [{ ...item, status: undefined, partial: true }] : []
        }))
        await submission.checkOutcome(attempt, targetSessionId, () => {
          setLocalMessages(current => current.filter(item => item.id !== assistantId))
        }, { taskId: acceptedTaskId, accepted: true })
        return
      }
      setLocalMessages(current => current.filter(item => item.id !== assistantId))
      restoreInput()
      if (controller?.signal.aborted) return
      if (targetSessionId && !isRejectedSubmission(error)) {
        await submission.checkOutcome(attempt, targetSessionId, () => {})
      } else {
        submission.reject(attempt, defaultTaskActionErrorMessage(error, uiText("文本请求提交失败，请检查模型配置")))
      }
    } finally {
      if (controller && streamAbortRef.current === controller) {
        streamAbortRef.current = null
        streamTaskIdRef.current = undefined
        streamSessionIdRef.current = undefined
      }
      submission.finish(attempt)
    }
  }

  /** Request cancellation on the live run, leaving its final state to the SSE terminal event. */
  const handleStop = async () => {
    const taskId = streamTaskIdRef.current
    const activeSessionId = streamSessionIdRef.current
    if (!taskId || !activeSessionId || stopPending.current) throw new Error(uiText("当前还不能停止生成"))
    if (terminalRunRef.current === taskId || stopState === 'requested') return
    stopPending.current = true
    setStopState('requesting')
    try {
      const response = await chatClient.textStop({
        sessionId: activeSessionId,
        taskId,
        requestBody: { reason: 'user_cancelled' },
      })
      if (terminalRunRef.current === taskId) { setStopState('idle'); return }
      const result = response.data
      if (result?.task_id !== taskId || !['cancelled', 'succeeded'].includes(result.status)) {
        throw new Error(uiText("停止请求未得到确认"))
      }
      setStopState('requested')
    } catch (error) {
      if (terminalRunRef.current === taskId) { setStopState('idle'); return }
      setStopState('failed')
      throw error
    } finally {
      stopPending.current = false
    }
  }

  useExperimentLeaveStatus(submission.dirty, liveRun ? {
    ready: Boolean(streamTaskIdRef.current),
    stopping: stopState === 'requesting',
    stop: handleStop,
  } : undefined)

  /** 清空服务端与浏览器内的当前会话消息，草稿态无需执行该操作。 */
  const handleClearSession = async () => {
    if (!sessionId) return
    await onClearSession(sessionId)
    historyState.clearLocalHistory()
    setLocalMessages([])
  }

  /** Restores a prior user message as editable free text without spending another model call. */
  const restoreUserMessage = (item: LocalMessage) => {
    const snapshot = item.inputSnapshot
    if (submitting || !snapshot) return
    confirmReplacement(() => {
      applyFreeInput(snapshot.prompt)
      setModelId(snapshot.model_id ?? undefined)
      focusExperimentPromptEditor()
      if (snapshot.model_id) message.success(uiText("已回填历史输入，可修改后重新发送"))
      else message.info(uiText("已回填提示词；请重新选择模型后发送"))
    })
  }

  return render({
    clearContent: sessionId && localMessages.length && !submitting ? handleClearSession : undefined,
    history: (
      <ExperimentHistory key={sessionId ?? 'draft'} history={historyState} messageCount={localMessages.length || Number(submitting)} emptyDescription={uiText("选择模型并输入提示词，开始一轮文本实验")}>
        {localMessages.map((item) => (
          <ExperimentMessageBubble
            key={item.id}
            footer={item.inputSnapshot ? <ExperimentHistoryRestoreButton disabled={submitting} onRestore={() => restoreUserMessage(item)} /> : undefined}
            identity={item.role === 'user' ? uiText("你") : uiText("模型")}
            status={item.status ? <ExperimentTaskStatus status={item.status} progress={item.progress} /> : null}
            tone={item.role === 'user' ? 'user' : 'assistant'}
          >
            {item.partial ? <><div>{item.content}</div><p className="experiment-result-note">{item.recoveredFromHistory ? uiText("已恢复部分回复，最终状态待核实") : uiText("流连接中断前收到的部分回复")}</p></> : item.content}{item.error ? <p className="experiment-result-error">{item.error}</p> : null}
          </ExperimentMessageBubble>
        ))}
        {liveRun && !streamTaskIdRef.current ? <p className="experiment-history-loading" role="status">{uiText("正在发送…")}</p> : null}
      </ExperimentHistory>
    ),
    composer: (
      <ExperimentOptionBar
        models={models.map((model) => ({ id: model.id, name: model.name }))}
        templates={templates.map((template) => ({
          id: template.id, name: template.name, version: template.version,
          preview: template.preview, category: textPromptCategoryLabels[template.category],
        }))}
        modelId={modelId}
        selectedTemplate={selectedTemplate ?? undefined}
        modelsLoading={modelsLoading}
        modelsFailed={modelsFailed}
        onRefreshModels={() => void loadModels(true)}
        templatesLoading={templatesLoading}
        templatesFailed={templatesFailed}
        onRefreshTemplates={() => void loadTemplates(true)}
        disabled={submitting}
        modelLabel={uiText("文本模型")}
        onModelChange={setModelId}
        onTemplateChange={selectTemplate}
        onModelOpenChange={(open) => { if (open) void loadModels() }}
        onTemplateOpenChange={(open) => { if (open) void loadTemplates() }}
      >
        {({ modelControl, addControl }) => (
          <ExperimentComposer
            secondaryAction={liveRun ? <Button icon={<StopOutlined aria-hidden="true" />} danger
              loading={stopState === 'requesting'}
              disabled={!streamTaskIdRef.current || stopState === 'requested'}
              onClick={() => { void handleStop().catch(() => {}) }}>{uiText("停止")}</Button> : null}
            submitting={submitting}
            submitDisabled={submitting || stopState === 'requesting' || submission.outcomePending || Boolean(sessionId && historyState.loading)}
            onSubmit={() => void handleSubmit()}
            options={modelControl} addAction={addControl}
          >
            {replacementDialog}
            {liveRun && stopState === 'requested' && <p role="status">{uiText("已请求停止，等待本轮结束。")}</p>}
            {liveRun && stopState === 'failed' && <p role="alert">{uiText("停止生成请求失败，请重试。")}</p>}
            <ExperimentSubmissionFeedback notice={submission.notice} onCheck={() => void submission.checkHistory()} onAcknowledge={submission.acknowledgeUnknown} />
            <ExperimentPromptEditor
              template={selectedTemplate}
              templateValues={templateValues}
              draft={draft}
              placeholder={uiText("输入提示词；Shift + Enter 换行")}
              label={uiText("文本提示词")}
              disabled={submitting}
              submitOnEnter
              onDraftChange={setDraft}
              onTemplateValuesChange={setTemplateValues}
              onUseFreeInput={applyFreeInput}
              onSubmit={() => void handleSubmit()}
            />
          </ExperimentComposer>
        )}
      </ExperimentOptionBar>
    ),
    disabled: submitting,
  })
}
