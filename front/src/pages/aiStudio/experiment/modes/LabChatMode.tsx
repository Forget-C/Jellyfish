import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Input, Upload } from 'antd'
import { WorkbenchConversation } from '../../../../components/workbench/WorkbenchConversation'
import { laboratoryChat } from '../../../../services/chatSession'
import { ApiError, LlmService, type ExperimentSessionRead, type LabChatSnapshot, type LabModels, type FileRead } from '../../../../services/generated'
import { useUiText } from '../../../../uiText'
import { useExperimentLeaveStatus } from '../ExperimentLeaveGuard'
import { ExperimentComposer } from '../components/ExperimentComposer'
import { useExperimentReferenceUpload } from '../hooks/useExperimentReferenceUpload'

type ModelKind = 'text' | 'image' | 'video'
const kinds: ModelKind[] = ['text', 'image', 'video']
const labels = { text: '主聊天模型', image: '图片模型', video: '视频模型' }
type Option = { id: string; name: string }
type Props = {
  sessionId?: string
  ensureSession: (kind: 'chat') => Promise<ExperimentSessionRead>
  render: (parts: { history: ReactNode; composer: ReactNode }) => ReactNode
}

/** One composer for the lab chat profile. Server snapshots own admission and history. */
export function LabChatMode({ sessionId, ensureSession, render }: Props) {
  const uiText = useUiText()
  const [models, setModels] = useState<LabModels>({})
  const [options, setOptions] = useState<Record<ModelKind, Option[]>>({ text: [], image: [], video: [] })
  const [snapshot, setSnapshot] = useState<LabChatSnapshot>()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<FileRead[]>([])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const pending = useRef<{ key: string; id: string }>()
  const initialized = useRef(false)
  const upload = useExperimentReferenceUpload<string>(() => {}, uiText('上传失败'))
  const report = (failure: unknown) => {
    const detail = failure instanceof ApiError ? failure.body?.message : undefined
    setError(detail === 'ASSISTANT_MODEL_INPUT_UNSUPPORTED' ? uiText('主聊天模型无法理解此素材，请更换模型后发送') :
      detail || (failure instanceof Error ? failure.message : uiText('请求失败')))
  }

  useEffect(() => {
    let current = true
    const load = async () => {
      const [settings, ...lists] = await Promise.all([
        LlmService.getModelSettingsApiV1LlmModelSettingsGet(),
        ...kinds.map(category => LlmService.listModelsApiV1LlmModelsGet({ category, pageSize: 100 })),
      ] as const)
      if (!current) return
      setOptions({ text: lists[0].data?.items ?? [], image: lists[1].data?.items ?? [], video: lists[2].data?.items ?? [] })
      if (!initialized.current) setModels({ text: settings.data?.default_text_model_id, image: settings.data?.default_image_model_id, video: settings.data?.default_video_model_id })
    }
    void load().catch(e => { if (current) report(e) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (!sessionId) return
    const abort = new AbortController()
    const watch = async () => {
      let cursor = 0
      const refresh = async () => {
        const data = (await laboratoryChat.snapshot({ sessionId })).data
        if (!data || abort.signal.aborted) return
        cursor = data.cursor
        setSnapshot(data)
        if (!initialized.current) { initialized.current = true; setModels(data.models) }
      }
      while (!abort.signal.aborted) {
        try {
          await refresh()
          for await (const event of laboratoryChat.events(sessionId, cursor, abort.signal)) {
            if (abort.signal.aborted) return
            if (event.cursor <= cursor) continue
            cursor = event.cursor
            if (event.type === 'message.updated') {
              setSnapshot(previous => previous ? { ...previous, cursor, partial_reply: event.payload.text } : previous)
            } else await refresh()
          }
        } catch (e) {
          if (!abort.signal.aborted) report(e)
        }
        if (!abort.signal.aborted) await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    void watch()
    return () => abort.abort()
  }, [sessionId])

  useExperimentLeaveStatus(!sending && Boolean(text.trim() || files.length))

  const selectModel = async (kind: ModelKind, value: string) => {
    initialized.current = true
    if (!sessionId) { setModels(old => ({ ...old, [kind]: value })); return }
    setSaving(true)
    try {
      const selected = await laboratoryChat.models({ sessionId, requestBody: { [kind]: value } })
      if (selected.data) setModels(selected.data)
    } catch (e) { report(e) } finally { setSaving(false) }
  }
  const busy = sending || Boolean(snapshot?.active_turn)
  const modelSelect = (kind: ModelKind) => <label key={kind}>{uiText(labels[kind])}{' '}
    <select aria-label={uiText(labels[kind])} value={models[kind] ?? ''} disabled={busy || saving}
      onChange={event => void selectModel(kind, event.target.value)}>
      <option value="" disabled>{uiText('选择模型')}</option>
      {options[kind].map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
  </label>
  const send = async () => {
    if (!text.trim() || busy || inFlight.current) return
    inFlight.current = true
    setSending(true)
    setError('')
    const fileIds = files.map(file => file.id)
    const key = JSON.stringify([text, fileIds, models])
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() }
    try {
      const session = await ensureSession('chat')
      if (!sessionId) await laboratoryChat.models({sessionId: session.id, requestBody: models})
      const result = await laboratoryChat.send({ sessionId: session.id, requestBody: {
        request_id: pending.current.id, text, file_ids: fileIds,
      } })
      if (result.data) setSnapshot(result.data)
      setText('')
      setFiles([])
      pending.current = undefined
    } catch (e) { report(e) } finally { inFlight.current = false; setSending(false) }
  }
  const stop = async () => {
    if (!sessionId || !snapshot?.active_turn) return
    try {
      const response = await laboratoryChat.stop({sessionId, turnId: snapshot.active_turn})
      if (response.data) setSnapshot(response.data)
    } catch (e) { report(e) }
  }
  const items = (snapshot?.messages ?? []).map(row => ({
    key: row.id, role: row.role, content: row.content || (row.status === 'failed' ? uiText('生成失败') : ''), placement: row.role === 'user' ? 'end' as const : 'start' as const,
  }))
  if (snapshot?.partial_reply) items.push({ key: 'pending', role: 'assistant', content: snapshot.partial_reply, placement: 'start' })
  return render({
    history: <WorkbenchConversation items={items} />,
    composer: <ExperimentComposer options={modelSelect('text')} onSubmit={() => void send()}
      submitting={sending} submitDisabled={busy || !text.trim() || saving || upload.uploading}
      contextActions={<details><summary>{uiText('模态配置')}</summary>{modelSelect('image')} {modelSelect('video')}</details>}
      secondaryAction={snapshot?.active_turn && <Button onClick={() => void stop()}>{uiText('停止回复')}</Button>}
      feedback={(error || upload.uploadError) && <Alert type="error" message={error || upload.uploadError?.message} />}>
      <Input.TextArea aria-label={uiText('聊天消息')} disabled={busy} value={text} onChange={event => setText(event.target.value)}
        onPressEnter={event => { if (!event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
      <Upload accept="image/*,video/*" disabled={busy || upload.uploading} showUploadList={false} beforeUpload={file => {
        void upload.uploadFile(file, 'chat', saved => setFiles(old => [...old, saved]))
        return false
      }}><Button>{uiText('添加素材')}</Button></Upload>
      {files.map(file => <Button key={file.id} disabled={busy} onClick={() => setFiles(old => old.filter(f => f.id !== file.id))}>{file.name} ×</Button>)}
    </ExperimentComposer>,
  })
}
