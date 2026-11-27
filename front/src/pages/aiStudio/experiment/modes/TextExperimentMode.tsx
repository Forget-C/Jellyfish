/**
 * 文本实验室模态。
 *
 * 模态只处理文本历史的呈现、文本生成和输入配置；会话选择、URL 与页面布局
 * 仍由统一实验室页面负责，从而避免文本实验室重新成为独立页面。
 */
import { useUiText } from '../../../../uiText'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, message } from 'antd'
import { StopOutlined } from '@ant-design/icons'
import {
  type ChatTurnReceipt,
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
import { bindChatSession, chatClient, readTrialHistory } from '../../../../services/chatSession'
import { useTextTrialObservation } from '../hooks/useTextTrialObservation'
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
  hasMessages?: boolean
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

const readTextHistory = (paging: Parameters<typeof readTrialHistory>[1]) => readTrialHistory('text', paging)

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
  const historyState = useExperimentHistory(sessionId, { readPage: readTextHistory })
  const [firstAdmission, setFirstAdmission] = useState<{receipt: ChatTurnReceipt; epoch: number}>()
  const fallbackReceipt = firstAdmission?.epoch === historyState.checkpointEpoch ? firstAdmission.receipt : undefined
  const {runs, disconnected} = useTextTrialObservation(sessionId, historyState, fallbackReceipt)
  const inputSignature = (prompt: string) => JSON.stringify([prompt, selectedTemplate?.id, selectedTemplate?.version, templateValues])
  const submission = useExperimentSubmission(sessionId, historyState, inputSignature(draft))
  const { submitting } = submission
  const [command, setCommand] = useState<{
    sessionId: string
    turnId: string
    accepted: boolean
    accept(): void
    finish(failed: boolean): void
  }>()
  const [stopState, setStopState] = useState<'idle' | 'requesting' | 'requested' | 'failed'>('idle')
  const activeRunId = Object.entries(runs ?? {}).find(([, run]) => run.status === 'running')?.[0]
    ?? (command?.sessionId === sessionId && command && !runs?.[command.turnId] ? command.turnId : undefined)
  const liveRun = Boolean(activeRunId) || submitting && !submission.outcomePending
  const busy = liveRun || submitting
  const waitingForCheckpoint = Boolean(sessionId && historyState.eventCursor === undefined)

  useEffect(() => {
    onSubmittingChange?.(busy)
  }, [onSubmittingChange, busy])

  useEffect(() => {
    if (!command || command.sessionId !== sessionId) return
    const run = runs?.[command.turnId]
    const durable = historyState.messages.find(item => item.payload?.interaction_run_id === command.turnId && item.role === 'assistant')
    if (!run && !durable) return
    if (!command.accepted) {
      command.accepted = true
      command.accept()
    }
    if (durable || run && run.status !== 'running') {
      command.finish(durable?.status === 'failed' || run?.status === 'failed')
      setCommand(undefined)
    }
  }, [runs, sessionId, command, historyState.messages])

  useEffect(() => {
    setStopState('idle')
  }, [activeRunId, sessionId])

  const confirmed = new Set(historyState.messages.filter(row => row.role === 'assistant').map(row => row.payload?.interaction_run_id))
  const projectedUsers = new Set(Object.values(runs ?? {}).map(run => run.userId))
  const localMessages = toLocalMessages(historyState.messages, true)
    .filter(row => !row.recoveredFromHistory || !projectedUsers.has(row.id.slice('recovered-'.length)))
  for (const [turnId, run] of Object.entries(runs ?? {})) {
    if (confirmed.has(turnId) || run.status === 'succeeded') continue
    const reply: LocalMessage = {
      id: 'stream-' + turnId, role: 'assistant', content: run.text,
      status: run.status === 'unknown' ? undefined : run.status,
      partial: run.status === 'unknown' || disconnected && run.status === 'running',
      error: run.error,
    }
    const index = localMessages.findIndex(row => row.id === run.userId)
    if (index === -1 || run.status !== 'running') localMessages.push(reply)
    else localMessages.splice(index + 1, 0, reply)
  }

  const { models, modelsLoading, modelsFailed, loadModels } = useExperimentModels('text', setSoleModel)

  const currentPrompt = selectedTemplate
    ? renderPromptTemplate(selectedTemplate.content, templateValues).trim()
    : draft.trim()

  /** 提交固定 SSE 文本运行；服务端是 canonical user/assistant 消息的唯一写入者。 */
  const handleSubmit = async () => {
    if (busy) return
    if (waitingForCheckpoint || (sessionId && historyState.loading)) return
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
    let targetSessionId: string | undefined
    let waiting = false
    try {
      const session = sessionId ? { id: sessionId } : await ensureSession('text')
      if (!submission.isCurrent(attempt)) return
      targetSessionId = session.id
      attempt.sessionId = session.id
      const bound = bindChatSession('text', session.id)
      const send = () => bound.send({requestBody: {model_id: modelId, content: currentPrompt}, idempotencyKey: attempt.requestId})
      const receipt = await send().catch(error => {
        if (!submission.isCurrent(attempt) || isRejectedSubmission(error)) throw error
        return send()
      })
      if (!submission.isCurrent(attempt)) return
      waiting = true
      if (!sessionId) setFirstAdmission({receipt, epoch: historyState.checkpointEpoch})
      setCommand({
        sessionId: session.id,
        turnId: receipt.turn_id,
        accepted: false,
        accept() {
          const unchanged = submission.acceptInput(attempt, session.id, inputSignature(''))
          if (unchanged && !selectedTemplate) setDraft(current => current === draft ? '' : current)
        },
        finish(failed) {
          if (failed) {
            submission.restoreUnsent(attempt)
            if (!selectedTemplate) setDraft(current => current === '' ? draft : current)
          }
          submission.finish(attempt)
        },
      })
    } catch (error) {
      if (!submission.isCurrent(attempt)) return
      if (targetSessionId && !isRejectedSubmission(error)) {
        await submission.checkOutcome(attempt, targetSessionId, () => {})
      } else {
        submission.reject(attempt, defaultTaskActionErrorMessage(error, uiText("文本请求提交失败，请检查模型配置")))
      }
    } finally {
      if (!waiting) submission.finish(attempt)
    }
  }

  /** A successful cancellation request is followed by the terminal session event. */
  const handleStop = async () => {
    if (!activeRunId || !sessionId || stopState === 'requesting' || stopState === 'requested') return
    setStopState('requesting')
    try {
      const {data} = await chatClient.textStop({
        sessionId, taskId: activeRunId, requestBody: {reason: 'user_cancelled'},
      })
      if (data?.task_id !== activeRunId || !['cancelled', 'succeeded'].includes(data.status)) {
        throw new Error(uiText("停止请求未得到确认"))
      }
      setStopState(current => current === 'requesting' ? 'requested' : current)
    } catch {
      setStopState(current => current === 'requesting' ? 'failed' : current)
    }
  }

  useExperimentLeaveStatus(submission.dirty, busy)

  /** 清空服务端与浏览器内的当前会话消息，草稿态无需执行该操作。 */
  const handleClearSession = async () => {
    if (!sessionId) return
    await onClearSession(sessionId)
    historyState.clearLocalHistory()
    await historyState.refresh()
  }

  /** Restores a prior user message as editable free text without spending another model call. */
  const restoreUserMessage = (item: LocalMessage) => {
    const snapshot = item.inputSnapshot
    if (busy || !snapshot) return
    confirmReplacement(() => {
      applyFreeInput(snapshot.prompt)
      setModelId(snapshot.model_id ?? undefined)
      focusExperimentPromptEditor()
      if (snapshot.model_id) message.success(uiText("已回填历史输入，可修改后重新发送"))
      else message.info(uiText("已回填提示词；请重新选择模型后发送"))
    })
  }

  return render({
    hasMessages: localMessages.length > 0,
    clearContent: sessionId && localMessages.length && !busy ? handleClearSession : undefined,
    history: (
      <ExperimentHistory key={sessionId ?? 'draft'} history={historyState} messageCount={localMessages.length || Number(submitting)} emptyDescription={uiText("选择模型并输入提示词，开始一轮文本实验")}>
        {localMessages.map((item) => (
          <ExperimentMessageBubble
            key={item.id}
            footer={item.inputSnapshot ? <ExperimentHistoryRestoreButton disabled={busy} onRestore={() => restoreUserMessage(item)} /> : undefined}
            identity={item.role === 'user' ? uiText("你") : uiText("模型")}
            status={item.status ? <ExperimentTaskStatus status={item.status} progress={item.progress} /> : null}
            tone={item.role === 'user' ? 'user' : 'assistant'}
          >
            {item.partial ? <><div>{item.content}</div><p className="experiment-result-note">{item.recoveredFromHistory ? uiText("已恢复部分回复，最终状态待核实") : uiText("流连接中断前收到的部分回复")}</p></> : item.content}{item.error ? <p className="experiment-result-error">{item.error}</p> : null}
          </ExperimentMessageBubble>
        ))}
        {liveRun && !activeRunId ? <p className="experiment-history-loading" role="status">{uiText("正在发送…")}</p> : null}
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
        disabled={busy}
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
              disabled={!activeRunId || stopState === 'requested'}
              onClick={() => { void handleStop().catch(() => {}) }}>{uiText("停止")}</Button> : null}
            submitting={submitting}
            submitDisabled={busy || stopState === 'requesting' || submission.outcomePending ||
              waitingForCheckpoint || Boolean(sessionId && historyState.loading)}
            onSubmit={() => void handleSubmit()}
            options={modelControl} addAction={addControl}
          >
            {replacementDialog}
            {liveRun && stopState === 'requested' && <p role="status">{uiText("已请求停止，等待本轮结束。")}</p>}
            {liveRun && stopState === 'failed' && <p role="alert">{uiText("停止生成请求失败，请重试。")}</p>}
            <ExperimentSubmissionFeedback notice={submission.notice ?? (disconnected && activeRunId ? {kind: 'run-unavailable', historyUnavailable: false} : undefined)}
              onCheck={() => { void (submission.notice ? submission.checkHistory() : historyState.refresh()) }} onAcknowledge={submission.notice ? submission.acknowledgeUnknown : undefined} />
            <ExperimentPromptEditor
              template={selectedTemplate}
              templateValues={templateValues}
              draft={draft}
              placeholder={uiText("输入提示词；Shift + Enter 换行")}
              label={uiText("文本提示词")}
              disabled={busy}
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
    disabled: busy,
  })
}
