import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { PlusOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Suggestion } from '@ant-design/x'
import { Alert, Button, Input, Upload } from 'antd'
import { ExperimentHistory } from '../components/ExperimentHistory'
import { ExperimentMessageBubble } from '../components/ExperimentMessageBubble'
import { applyReply, bindChatSession, chatClient } from '../../../../services/chatSession'
import { observeChatRequest, useChatTurnLifecycle, type ChatTurnAdapter } from '../../../../services/chatTurnLifecycle'
import { ApiError, FilmService, LlmService, type ChatEvent, type ExperimentMessageRead, type ExperimentSessionRead, type LabChatSnapshot, type LabModels, type FileRead } from '../../../../services/generated'
import { useUiText } from '../../../../uiText'
import { useExperimentLeaveStatus } from '../ExperimentLeaveGuard'
import { MediaTaskDetails } from '../components/MediaTaskDetails'
import { ExperimentReferenceImage } from '../components/ExperimentReferenceImage'
import { ExperimentResultMedia } from '../components/ExperimentResultMedia'
import { ExperimentTaskStatus } from '../components/ExperimentTaskStatus'
import { buildFileDownloadUrl } from '../../assets/utils'
import { useExperimentModels } from '../hooks/useExperimentModels'
import { ExperimentOptionBar } from '../components/ExperimentOptionBar'
import { ExperimentComposer } from '../components/ExperimentComposer'
import { useExperimentReferenceUpload } from '../hooks/useExperimentReferenceUpload'

type ModelKind = 'text' | 'image' | 'video'
const labels = { text: '主聊天模型', image: '图片模型', video: '视频模型' }
type Props = {
  sessionId?: string
  ensureSession: (kind: 'chat') => Promise<ExperimentSessionRead>
  render: (parts: { history: ReactNode; composer: ReactNode; hasMessages: boolean }) => ReactNode
}

function ChatModelChoice({kind, value, disabled, onChange, footer}: {
  kind: ModelKind; value?: string | null; disabled: boolean; onChange: (id: string) => void; footer?: ReactNode
}) {
  const uiText = useUiText()
  const {models, modelsFailed, modelsLoading, loadModels} = useExperimentModels(kind, () => {})
  return <div className="experiment-chat-model">
    {kind !== 'text' && <span>{uiText(labels[kind])} </span>}
    <ExperimentOptionBar models={models} modelId={value ?? undefined} disabled={disabled}
      modelsFailed={modelsFailed} modelsLoading={modelsLoading} modelLabel={labels[kind]} modelFooter={footer}
      onRefreshModels={() => void loadModels(true)} onModelOpenChange={open => { if (open) void loadModels() }}
      onModelChange={id => { if (id) onChange(id) }} templates={[]} onTemplateChange={() => {}}>
      {({modelControl}) => modelControl}
    </ExperimentOptionBar>
  </div>
}

function mergeMessages(previous: ExperimentMessageRead[], updates: ExperimentMessageRead[]) {
  const rows = new Map(previous.map(message => [message.id, message]))
  for (const message of updates) rows.set(message.id, message)
  return [...rows.values()].sort((first, second) => first.sequence - second.sequence)
}

function applyChatEvent(snapshot: LabChatSnapshot, event: ChatEvent): LabChatSnapshot {
  if (event.cursor <= snapshot.cursor) return snapshot
  const next = {...snapshot, cursor: event.cursor}
  const currentTurn = event.turn_id === snapshot.active_turn
  if (event.category === 'message' && currentTurn) {
    next.partial_reply = applyReply(snapshot.partial_reply ?? '', event.payload)
  } else if (event.category === 'turn') {
    if (event.type === 'turn.accepted' || currentTurn) {
      next.active_turn = event.type === 'turn.accepted' ? event.turn_id : null
      next.partial_reply = ''
      next.question = null
    }
    if (event.payload.message) next.messages = mergeMessages(snapshot.messages, [event.payload.message])
  } else if (event.category === 'tool' && event.payload.message) {
    next.messages = mergeMessages(snapshot.messages, [event.payload.message])
  } else if (event.category === 'task') {
    const {messages, ...receipt} = event.payload
    next.messages = mergeMessages(snapshot.messages, messages ?? []).map(message =>
      message.task_id === receipt.task_id && message.role === 'task'
        ? {...message, media_receipt: receipt, status: receipt.status} : message)
  } else if (event.type === 'question.answered' && currentTurn) {
    next.question = null
  }
  return next
}

async function readLabSnapshot(sessionId: string, signal: AbortSignal) {
  const {data} = await observeChatRequest(bindChatSession('chat', sessionId).snapshot(), signal)
  if (data?.kind !== 'chat' || !('models' in data.history)) throw new Error('Invalid laboratory chat snapshot')
  return data.history
}

const labLifecycle: ChatTurnAdapter<LabChatSnapshot> = {
  read: readLabSnapshot,
  events: (sessionId, cursor, signal, connected) => bindChatSession('chat', sessionId).events(cursor, signal, connected),
  async apply(snapshot, event, signal) {
    if (event.type !== 'question.asked' || event.turn_id !== snapshot.active_turn) {
      return applyChatEvent(snapshot, event)
    }
    // A question on the wire can already be answered by a different observer.
    const current = await readLabSnapshot(snapshot.session_id, signal)
    if (current.cursor < event.cursor) throw new Error('Laboratory snapshot is behind the question')
    return current
  },
  active: snapshot => snapshot.active_turn
    ? {id: snapshot.active_turn, questionId: snapshot.question?.id}
    : undefined,
  outcome(snapshot, turnId) {
    const status = [...snapshot.messages].reverse().find(row => row.role === 'assistant' &&
      row.payload?.turn_id === turnId && !row.payload.tool_error)?.status
    if (status === 'completed' || status === 'failed' || status === 'stopped' || status === 'interrupted') return status
  },
  async stop(sessionId, turnId, signal) {
    const {data} = await observeChatRequest(chatClient.labStop({sessionId, turnId}), signal)
    if (!data) throw new Error('Missing stop snapshot')
    return data
  },
}

/** One composer for the lab chat profile. Server snapshots own admission and history. */
export function LabChatMode({ sessionId, ensureSession, render }: Props) {
  const uiText = useUiText()
  const lifecycle = useChatTurnLifecycle(sessionId, labLifecycle)
  const { snapshot, stoppableTurn, stop } = lifecycle
  const [models, setModels] = useState<LabModels>({})
  const [text, setText] = useState('')
  const [files, setFiles] = useState<FileRead[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const draftVersion = useRef(0)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const initialized = useRef(false)
  const upload = useExperimentReferenceUpload<string>(() => {}, uiText('上传失败'))
  const errorText = useCallback((detail?: string) => detail === 'ASSISTANT_MODEL_INPUT_UNSUPPORTED' ? uiText('主聊天模型无法理解此素材，请更换模型后发送') :
      detail === 'CHAT_TOOL_MODEL_REQUIRED' ? uiText('请选择支持工具调用的主聊天模型') :
      detail === 'CHAT_IMAGE_MODEL_REQUIRED' ? uiText('请先选择图片模型') :
      detail === 'CHAT_VIDEO_MODEL_REQUIRED' ? uiText('请先选择视频模型') :
      detail || uiText('请求失败'), [uiText])
  const failureText = useCallback((failure: unknown) =>
    errorText(failure instanceof ApiError ? failure.body?.message : failure instanceof Error ? failure.message : undefined), [errorText])
  const report = useCallback((failure: unknown) => setError(failureText(failure)), [failureText])

  useEffect(() => {
    let current = true
    const load = async () => {
      const settings = await LlmService.getModelSettingsApiV1LlmModelSettingsGet()
      if (!current) return
      if (!initialized.current) setModels({ text: settings.data?.default_text_model_id, image: settings.data?.default_image_model_id, video: settings.data?.default_video_model_id })
    }
    void load().catch(e => { if (current) report(e) })
    return () => { current = false }
  }, [report])

  useEffect(() => {
    if (snapshot && !initialized.current) {
      initialized.current = true
      setModels(snapshot.models)
    }
  }, [snapshot])

  const sending = submitting || lifecycle.commandPending
  const draftLocked = (submitting || lifecycle.busy) && !lifecycle.reconnecting && !lifecycle.uncertain
  useExperimentLeaveStatus(Boolean(text.trim() || files.length))

  const selectModel = async (kind: ModelKind, value: string) => {
    initialized.current = true
    if (!sessionId) { setModels(old => ({ ...old, [kind]: value })); return }
    setSaving(true)
    try {
      const selected = await chatClient.labModels({ sessionId, requestBody: { [kind]: value } })
      if (selected.data) setModels(selected.data)
    } catch (e) { report(e) } finally { setSaving(false) }
  }
  const busy = submitting || lifecycle.busy
  const canSend = Boolean(text.trim()) && !busy && !saving && !upload.uploading
  const modelSelect = (kind: ModelKind, footer?: ReactNode) => <ChatModelChoice key={kind} kind={kind} value={models[kind]} footer={footer}
    disabled={busy || saving} onChange={id => void selectModel(kind, id)} />
  const send = async () => {
    if (!canSend || inFlight.current) return
    inFlight.current = true
    const version = draftVersion.current
    const restoreDraft = () => {
      if (!mounted.current || draftVersion.current !== version) return
      setText(text)
      setFiles(files)
    }
    setSubmitting(true)
    setError('')
    setText('')
    setFiles([])
    try {
      const body = {request_id: crypto.randomUUID(), text, file_ids: files.map(file => file.id)}
      const session = await ensureSession('chat')
      if (!mounted.current) return
      const bound = bindChatSession('chat', session.id)
      if (!sessionId) await chatClient.labModels({sessionId: session.id, requestBody: models})
      if (!mounted.current) return
      const result = await lifecycle.submit(session.id, {
        turnId: body.request_id,
        send: () => bound.send({requestBody: body}),
      })
      if (!result || result.outcome === 'failed') restoreDraft()
    } catch (e) {
      if (mounted.current) report(e)
      restoreDraft()
    } finally {
      inFlight.current = false
      if (mounted.current) setSubmitting(false)
    }
  }
  const question = snapshot?.question
  const answer = async (fileId: string) => {
    if (!sessionId || !snapshot?.active_turn || !question || inFlight.current) return
    inFlight.current = true
    setError('')
    const turnId = snapshot.active_turn
    const bound = bindChatSession('chat', sessionId)
    try {
      await lifecycle.submit(sessionId, {
        turnId,
        questionId: question.id,
        send: () => bound.answer({turnId, requestBody: {question_id: question.id, file_id: fileId}}),
      })
    } catch (e) { report(e) }
    finally { inFlight.current = false }
  }
  const editText = (value: string) => {
    draftVersion.current++
    setText(value)
  }
  const editFiles = (update: (current: FileRead[]) => FileRead[]) => {
    draftVersion.current++
    setFiles(update)
  }
  const messageText = (row: ExperimentMessageRead) => {
    if (row.payload?.tool_error) return [row.payload.tool, row.payload.tool_call_id, row.content].join(' · ')
    if (row.status !== 'failed') return row.content || ''
    const reason = row.payload?.error_code ? errorText(row.payload.error_code) : uiText('生成失败')
    return [row.content, reason].filter(Boolean).join('\n')
  }
  const renderMessage = (row: ExperimentMessageRead) => {
    const receipt = row.media_receipt
    if (receipt) {
      const urls = receipt.artifacts?.filter(file => !file.deleted).flatMap(file => buildFileDownloadUrl(file.file_id) ?? []) ?? []
      return <><ExperimentTaskStatus status={receipt.status} progress={receipt.progress} />
        <MediaTaskDetails receipt={receipt} />
        {row.payload?.source_file_id && <a href={buildFileDownloadUrl(row.payload.source_file_id)}>{uiText('原版产物')}</a>}
        {receipt.error && <Alert type="error" message={receipt.error} />}
        {urls.length > 0 && <ExperimentResultMedia kind={row.payload?.modality === 'video' ? 'video' : 'image'} urls={urls} />}
        {['queued', 'running'].includes(receipt.status) && !receipt.cancel_requested &&
          <Button onClick={() => void FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({
            taskId: receipt.task_id, requestBody: { reason: 'user_cancelled' },
          }).catch(report)}>{uiText('取消生成')}</Button>}
      </>
    }
    return messageText(row)
  }
  const messages = snapshot?.messages ?? []
  const hasMessages = messages.length > 0 || Boolean(snapshot?.active_turn || question || snapshot?.partial_reply)
  const feedback = error || upload.uploadError?.message || (lifecycle.error ? failureText(lifecycle.error) : undefined)
  return render({
    hasMessages,
    history: <ExperimentHistory messageCount={messages.length || Number(hasMessages)} emptyDescription={uiText('暂无会话消息')}>
      {messages.map(row => <ExperimentMessageBubble key={row.id}
        identity={row.role === 'user' ? uiText('你') : uiText('模型')}
        tone={row.role === 'user' ? 'user' : 'assistant'} result={Boolean(row.media_receipt)}>
        {renderMessage(row)}
      </ExperimentMessageBubble>)}
      {snapshot?.partial_reply && <ExperimentMessageBubble identity={uiText('模型')} tone="assistant">
        {snapshot.partial_reply}
      </ExperimentMessageBubble>}
      {question && <ExperimentMessageBubble identity={uiText('模型')} tone="assistant">
        <section aria-label={uiText('选择要修订的产物')}>
          <p>{uiText('选择要修订的产物')}</p>
          {question.options.map(option => <Button key={option.file_id} disabled={sending}
            onClick={() => void answer(option.file_id)}>#{option.sequence}.{option.ordinal + 1} {option.name} {option.prompt}</Button>)}
        </section>
      </ExperimentMessageBubble>}
    </ExperimentHistory>,
    composer: <ExperimentComposer inline options={modelSelect('text',
      <details className="experiment-modality-settings"><summary>{uiText('模态配置')}</summary>
        {modelSelect('image')} {modelSelect('video')}
      </details>)} onSubmit={() => void send()}
      submitting={sending}
      submitDisabled={!canSend}
      addAction={<Upload accept="image/*,video/*" disabled={draftLocked || upload.uploading} showUploadList={false} beforeUpload={file => {
        void upload.uploadFile(file, 'chat', saved => editFiles(old => [...old, saved]))
        return false
      }}><Button type="text" className="experiment-add-trigger" icon={<PlusOutlined />} title={uiText('添加素材')}
        aria-label={uiText('添加素材')} disabled={draftLocked || upload.uploading} /></Upload>}
      stopAction={stoppableTurn ? {
        label: uiText('停止回复'), loading: lifecycle.stopping, disabled: lifecycle.stopping,
        onClick: () => void stop(),
      } : undefined}
      feedback={(files.length || feedback) ? <>
        {files.length > 0 && <div className="experiment-chat-attachments">
          {files.map(file => <Button key={file.id} disabled={draftLocked} title={file.name}
            aria-label={uiText('移除{{label}}：{{name}}', { label: uiText('素材'), name: file.name })}
            icon={file.type === 'image' ? <ExperimentReferenceImage id={file.id} name={file.name} /> : <VideoCameraOutlined />}
            onClick={() => editFiles(old => old.filter(f => f.id !== file.id))}><span>{file.name}</span> ×</Button>)}
        </div>}
        {feedback && <Alert type="error" message={feedback} />}
      </> : null}>
      <Suggestion block items={['/imagegen', '/videogen'].map(value => ({ label: value, value }))} onSelect={value => editText(value + ' ')}>
        {({ onTrigger, onKeyDown, open }) => <Input.TextArea aria-label={uiText('聊天消息')} placeholder={uiText('输入消息，或添加素材')}
          variant="borderless" className="experiment-prompt-input" autoSize={{ minRows: 1, maxRows: 6 }} disabled={draftLocked} value={text}
          onChange={event => { editText(event.target.value); onTrigger(event.target.value === '/' ? undefined : false) }}
          onKeyDown={event => { if (open) onKeyDown(event) }}
          onPressEnter={event => { if (!open && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />}
      </Suggestion>
    </ExperimentComposer>,
  })
}
