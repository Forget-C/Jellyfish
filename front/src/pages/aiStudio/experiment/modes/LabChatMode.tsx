import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Suggestion } from '@ant-design/x'
import { Alert, Button, Input, Upload } from 'antd'
import { WorkbenchConversation } from '../../../../components/workbench/WorkbenchConversation'
import { applyReply, bindChatSession, chatClient } from '../../../../services/chatSession'
import { observeChatRequest, useChatTurnLifecycle, type ChatTurnAdapter } from '../../../../services/chatTurnLifecycle'
import { ApiError, FilmService, LlmService, type ChatEvent, type ExperimentMessageRead, type ExperimentSessionRead, type LabChatSnapshot, type LabModels, type FileRead } from '../../../../services/generated'
import { useUiText } from '../../../../uiText'
import { useExperimentLeaveStatus } from '../ExperimentLeaveGuard'
import { MediaTaskDetails } from '../components/MediaTaskDetails'
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
  render: (parts: { history: ReactNode; composer: ReactNode }) => ReactNode
}

function ChatModelChoice({kind, value, disabled, onChange}: {
  kind: ModelKind; value?: string | null; disabled: boolean; onChange: (id: string) => void
}) {
  const uiText = useUiText()
  const {models, modelsFailed, modelsLoading, loadModels} = useExperimentModels(kind, () => {})
  return <label>{uiText(labels[kind])}{' '}
    <ExperimentOptionBar models={models} modelId={value ?? undefined} disabled={disabled}
      modelsFailed={modelsFailed} modelsLoading={modelsLoading} modelLabel={labels[kind]}
      onRefreshModels={() => void loadModels(true)} onModelOpenChange={open => { if (open) void loadModels() }}
      onModelChange={id => { if (id) onChange(id) }} templates={[]} onTemplateChange={() => {}}>
      {({modelControl}) => modelControl}
    </ExperimentOptionBar>
  </label>
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
  } else if (event.type === 'question.asked' && currentTurn && event.detail && 'options' in event.detail) {
    next.question = event.detail
  } else if (event.type === 'question.answered' && currentTurn) {
    next.question = null
  }
  return next
}

const labLifecycle: ChatTurnAdapter<LabChatSnapshot> = {
  async read(sessionId, signal) {
    const {data} = await observeChatRequest(bindChatSession('chat', sessionId).snapshot(), signal)
    if (data?.kind !== 'chat' || !('models' in data.history)) throw new Error('Invalid laboratory chat snapshot')
    return data.history
  },
  events: (sessionId, cursor, signal, connected) => bindChatSession('chat', sessionId).events(cursor, signal, connected),
  apply: applyChatEvent,
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
  const modelSelect = (kind: ModelKind) => <ChatModelChoice key={kind} kind={kind} value={models[kind]}
    disabled={busy || saving} onChange={id => void selectModel(kind, id)} />
  const send = async () => {
    if (!text.trim() || busy || inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    setError('')
    const version = draftVersion.current
    const body = {request_id: crypto.randomUUID(), text, file_ids: files.map(file => file.id)}
    try {
      const session = await ensureSession('chat')
      if (!mounted.current) return
      const bound = bindChatSession('chat', session.id)
      if (!sessionId) await chatClient.labModels({sessionId: session.id, requestBody: models})
      if (!mounted.current) return
      const result = await lifecycle.submit(session.id, {
        turnId: body.request_id,
        send: () => bound.send({requestBody: body}),
      })
      if (result && result.outcome !== 'failed' && draftVersion.current === version) {
        setText('')
        setFiles([])
      }
    } catch (e) { report(e) }
    finally { inFlight.current = false; setSubmitting(false) }
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
  const items = (snapshot?.messages ?? []).map(row => ({
    ...(row.media_receipt ? { contentRender: () => {
      const receipt = row.media_receipt!
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
    }} : {}),
    key: row.id, role: row.role, content: messageText(row), placement: row.role === 'user' ? 'end' as const : 'start' as const,
  }))
  if (question) items.push({key: 'question-' + question.id, role: 'assistant', placement: 'start', content: '',
    contentRender: () => <section aria-label={uiText('选择要修订的产物')}>
      <p>{uiText('选择要修订的产物')}</p>
      {question.options.map(option => <Button key={option.file_id} disabled={sending}
        onClick={() => void answer(option.file_id)}>#{option.sequence}.{option.ordinal + 1} {option.name} {option.prompt}</Button>)}
    </section>})
  if (snapshot?.partial_reply) items.push({ key: 'pending', role: 'assistant', content: snapshot.partial_reply, placement: 'start' })
  const feedback = error || upload.uploadError?.message || (lifecycle.error ? failureText(lifecycle.error) : undefined)
  return render({
    history: <WorkbenchConversation items={items} />,
    composer: <ExperimentComposer options={modelSelect('text')} onSubmit={() => void send()}
      submitting={sending} submitDisabled={busy || !text.trim() || saving || upload.uploading}
      contextActions={<details><summary>{uiText('模态配置')}</summary>{modelSelect('image')} {modelSelect('video')}</details>}
      secondaryAction={stoppableTurn && <Button disabled={lifecycle.stopping} onClick={() => void stop()}>{uiText('停止回复')}</Button>}
      feedback={feedback ? <Alert type="error" message={feedback} /> : null}>
      <Suggestion block items={['/imagegen', '/videogen'].map(value => ({ label: value, value }))} onSelect={value => editText(value + ' ')}>
        {({ onTrigger, onKeyDown, open }) => <Input.TextArea aria-label={uiText('聊天消息')} disabled={draftLocked} value={text}
          onChange={event => { editText(event.target.value); onTrigger(event.target.value === '/' ? undefined : false) }}
          onKeyDown={event => { if (open) onKeyDown(event) }}
          onPressEnter={event => { if (!open && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />}
      </Suggestion>
      <Upload accept="image/*,video/*" disabled={draftLocked || upload.uploading} showUploadList={false} beforeUpload={file => {
        void upload.uploadFile(file, 'chat', saved => editFiles(old => [...old, saved]))
        return false
      }}><Button>{uiText('添加素材')}</Button></Upload>
      {files.map(file => <Button key={file.id} disabled={draftLocked} onClick={() => editFiles(old => old.filter(f => f.id !== file.id))}>{file.name} ×</Button>)}
    </ExperimentComposer>,
  })
}
