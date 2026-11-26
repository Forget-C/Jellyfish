import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Suggestion } from '@ant-design/x'
import { Alert, Button, Input, Upload } from 'antd'
import { WorkbenchConversation } from '../../../../components/workbench/WorkbenchConversation'
import { applyReply, bindChatSession, chatClient } from '../../../../services/chatSession'
import { ApiError, FilmService, LlmService, type ChatEvent, type ChatTurnReceipt, type ExperimentMessageRead, type ExperimentSessionRead, type LabChatSnapshot, type LabModels, type FileRead } from '../../../../services/generated'
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
  if (event.category === 'message') {
    next.partial_reply = applyReply(snapshot.partial_reply ?? '', event.payload)
  } else if (event.category === 'turn') {
    next.active_turn = event.type === 'turn.accepted' ? event.turn_id : null
    next.partial_reply = ''
    next.question = null
    if (event.payload.message) next.messages = mergeMessages(snapshot.messages, [event.payload.message])
  } else if (event.category === 'tool' && event.payload.message) {
    next.messages = mergeMessages(snapshot.messages, [event.payload.message])
  } else if (event.category === 'task') {
    const {messages, ...receipt} = event.payload
    next.messages = mergeMessages(snapshot.messages, messages ?? []).map(message =>
      message.task_id === receipt.task_id && message.role === 'task'
        ? {...message, media_receipt: receipt, status: receipt.status} : message)
  } else if (event.type === 'question.asked' && event.detail && 'options' in event.detail) {
    next.question = event.detail
  } else if (event.type === 'question.answered') {
    next.question = null
  }
  return next
}

/** One composer for the lab chat profile. Server snapshots own admission and history. */
export function LabChatMode({ sessionId, ensureSession, render }: Props) {
  const uiText = useUiText()
  const boundSession = useMemo(() => sessionId ? bindChatSession('chat', sessionId) : undefined, [sessionId])
  const [models, setModels] = useState<LabModels>({})
  const [snapshot, setSnapshot] = useState<LabChatSnapshot>()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<FileRead[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [admission, setAdmission] = useState<ChatTurnReceipt>()
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const pending = useRef<{ key: string; id: string }>()
  const initialized = useRef(false)
  const upload = useExperimentReferenceUpload<string>(() => {}, uiText('上传失败'))
  const errorText = useCallback((detail?: string) => detail === 'ASSISTANT_MODEL_INPUT_UNSUPPORTED' ? uiText('主聊天模型无法理解此素材，请更换模型后发送') :
      detail === 'CHAT_TOOL_MODEL_REQUIRED' ? uiText('请选择支持工具调用的主聊天模型') :
      detail === 'CHAT_IMAGE_MODEL_REQUIRED' ? uiText('请先选择图片模型') :
      detail === 'CHAT_VIDEO_MODEL_REQUIRED' ? uiText('请先选择视频模型') :
      detail || uiText('请求失败'), [uiText])
  const report = useCallback((failure: unknown) => {
    setError(errorText(failure instanceof ApiError ? failure.body?.message : failure instanceof Error ? failure.message : undefined))
  }, [errorText])

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

  const restore = (data: LabChatSnapshot) => setSnapshot(previous =>
    previous?.session_id === data.session_id && previous.cursor > data.cursor ? previous : data)

  useEffect(() => {
    if (!boundSession) return
    const abort = new AbortController()
    const watch = async () => {
      let cursor = 0
      const refresh = async () => {
        const data = (await boundSession.snapshot()).data
        if (!data || !('models' in data.history) || abort.signal.aborted) return
        cursor = data.cursor
        restore(data.history)
        if (!initialized.current) { initialized.current = true; setModels(data.history.models) }
      }
      while (!abort.signal.aborted) {
        try {
          await refresh()
          for await (const event of boundSession.events(cursor, abort.signal)) {
            if (abort.signal.aborted) return
            if (event.cursor <= cursor) continue
            cursor = event.cursor
            setSnapshot(previous => previous && applyChatEvent(previous, event))
          }
        } catch (e) {
          if (!abort.signal.aborted) report(e)
        }
        if (!abort.signal.aborted) await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    void watch()
    return () => abort.abort()
  }, [boundSession, report])

  // HTTP acknowledges the command. The session subscription or a newer snapshot
  // releases its composer once that same turn finishes or asks for input.
  useEffect(() => {
    if (!admission || !snapshot || snapshot.session_id !== admission.session_id || snapshot.cursor <= admission.cursor) return
    if (snapshot.active_turn === admission.turn_id && !snapshot.question) return
    if (pending.current?.id === admission.turn_id) {
      const failed = snapshot.messages.some(row => row.payload?.turn_id === admission.turn_id &&
        row.status === 'failed' && !row.payload.tool_error)
      if (!failed) { setText(''); setFiles([]) }
      pending.current = undefined
    }
    setAdmission(undefined)
  }, [snapshot, admission])

  const sending = submitting || Boolean(admission)
  useExperimentLeaveStatus(!sending && Boolean(text.trim() || files.length))

  const selectModel = async (kind: ModelKind, value: string) => {
    initialized.current = true
    if (!sessionId) { setModels(old => ({ ...old, [kind]: value })); return }
    setSaving(true)
    try {
      const selected = await chatClient.labModels({ sessionId, requestBody: { [kind]: value } })
      if (selected.data) setModels(selected.data)
    } catch (e) { report(e) } finally { setSaving(false) }
  }
  const busy = sending || Boolean(snapshot?.active_turn)
  const modelSelect = (kind: ModelKind) => <ChatModelChoice key={kind} kind={kind} value={models[kind]}
    disabled={busy || saving} onChange={id => void selectModel(kind, id)} />
  const send = async () => {
    if (!text.trim() || busy || inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    setError('')
    const fileIds = files.map(file => file.id)
    const key = JSON.stringify([text, fileIds, models])
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() }
    let commandSession = boundSession
    try {
      const session = await ensureSession('chat')
      commandSession = boundSession ?? bindChatSession(session.lab_type, session.id)
      if (!sessionId) await chatClient.labModels({sessionId: session.id, requestBody: models})
      const receipt = await commandSession.send({ requestBody: {
        request_id: pending.current.id, text, file_ids: fileIds,
      } })
      setAdmission(receipt)
    } catch (e) {
      report(e)
      if (commandSession && pending.current) {
        const id = pending.current.id
        const recovered = (await commandSession.snapshot().catch(() => undefined))?.data?.history
        if (recovered && 'models' in recovered) {
          restore(recovered)
          if (recovered.messages?.some(row => row.status === 'failed' && !row.payload?.tool_error && row.payload?.turn_id === id)) pending.current = undefined
        }
      }
    } finally { inFlight.current = false; setSubmitting(false) }
  }
  const stoppableTurn = snapshot?.active_turn ?? admission?.turn_id
  const stop = async () => {
    if (!sessionId || !stoppableTurn) return
    try {
      const response = await chatClient.labStop({sessionId, turnId: stoppableTurn})
      if (response.data) restore(response.data)
    } catch (e) { report(e) }
  }
  const question = snapshot?.question
  const answer = async (fileId: string) => {
    if (!boundSession || !snapshot?.active_turn || !question || inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    try {
      const receipt = await boundSession.answer({turnId: snapshot.active_turn,
        requestBody: {question_id: question.id, file_id: fileId}})
      setAdmission(receipt)
    } catch (e) { report(e) } finally { inFlight.current = false; setSubmitting(false) }
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
  return render({
    history: <WorkbenchConversation items={items} />,
    composer: <ExperimentComposer options={modelSelect('text')} onSubmit={() => void send()}
      submitting={sending} submitDisabled={busy || !text.trim() || saving || upload.uploading}
      contextActions={<details><summary>{uiText('模态配置')}</summary>{modelSelect('image')} {modelSelect('video')}</details>}
      secondaryAction={stoppableTurn && <Button onClick={() => void stop()}>{uiText('停止回复')}</Button>}
      feedback={(error || upload.uploadError) && <Alert type="error" message={error || upload.uploadError?.message} />}>
      <Suggestion block items={['/imagegen', '/videogen'].map(value => ({ label: value, value }))} onSelect={value => setText(value + ' ')}>
        {({ onTrigger, onKeyDown, open }) => <Input.TextArea aria-label={uiText('聊天消息')} disabled={busy} value={text}
          onChange={event => { setText(event.target.value); onTrigger(event.target.value === '/' ? undefined : false) }}
          onKeyDown={event => { if (open) onKeyDown(event) }}
          onPressEnter={event => { if (!open && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />}
      </Suggestion>
      <Upload accept="image/*,video/*" disabled={busy || upload.uploading} showUploadList={false} beforeUpload={file => {
        void upload.uploadFile(file, 'chat', saved => setFiles(old => [...old, saved]))
        return false
      }}><Button>{uiText('添加素材')}</Button></Upload>
      {files.map(file => <Button key={file.id} disabled={busy} onClick={() => setFiles(old => old.filter(f => f.id !== file.id))}>{file.name} ×</Button>)}
    </ExperimentComposer>,
  })
}
