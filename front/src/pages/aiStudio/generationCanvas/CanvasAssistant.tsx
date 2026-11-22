import { useEffect, useRef, useState } from 'react'
import { CommentOutlined, CloseOutlined } from '@ant-design/icons'
import { Alert, Input, Select, Spin } from 'antd'
import { WorkbenchButton, WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'
import { ApiError, LlmService, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasAssistantDraftContext, CanvasAssistantExchange, CanvasAssistantMessage, FileRead, ModelRead } from '../../../services/generated'
import { AssistantEditGroups, AssistantProposal } from './AssistantProposal'
import { AssistantGeneration } from './AssistantGeneration'
import { useUiText } from '../../../uiText'
import { CanvasAssistantAttachments, CanvasAssistantEvidence } from './CanvasAssistantAttachments'
import './canvasAssistant.css'

type AssistantScope = NonNullable<CanvasAssistantMessage['context']>['scope'] | 'text'

/** Nonmodal conversation for one saved canvas. Closing it keeps the draft and in-flight reply. */
export function CanvasAssistant({ canvasId, projectId, selectedCards, readDraft, approve, approvalDisabled, openRun }: {
  canvasId: string
  projectId: string
  selectedCards: string[]
  approve: (sourceId: string, groupIds?: string[]) => Promise<boolean>
  approvalDisabled: boolean
  openRun: (runId: string) => void
  readDraft: () => Pick<CanvasAssistantDraftContext, 'draft' | 'revision'>
}) {
  const uiText = useUiText()
  const trigger = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<CanvasAssistantExchange[]>()
  const [historyError, setHistoryError] = useState(false)
  const [retryLoad, setRetryLoad] = useState(0)
  const [draft, setDraft] = useState('')
  const [referenceFiles, setReferenceFiles] = useState<FileRead[]>([])
  const [uploadingReference, setUploadingReference] = useState(false)
  const [revising, setRevising] = useState<CanvasAssistantExchange>()
  const composer = useRef<HTMLFormElement>(null)
  const [sendError, setSendError] = useState<'text' | 'tools' | 'reply'>()
  const [sending, setSending] = useState(false)
  const [modelId, setModelId] = useState<string | null>(null)
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null)
  const [models, setModels] = useState<ModelRead[]>([])
  const [savingModel, setSavingModel] = useState(false)
  const [modelError, setModelError] = useState(false)
  const [scope, setScope] = useState<AssistantScope>()
  const pending = useRef<CanvasAssistantMessage>()
  const sendingNow = useRef(false)
  const lastTurn = useRef<HTMLDivElement>(null)
  const panelId = 'canvas-assistant-' + canvasId
  const inputId = panelId + '-input'
  const effectiveScope = scope ?? (selectedCards.length ? 'selection' : 'text')
  const activeGeneration = turns?.some(turn => turn.generation?.state === 'queued' || turn.generation?.state === 'running')

  useEffect(() => {
    if (!open || !activeGeneration) return
    let request: ReturnType<typeof Canvases.canvasAssistantHistory> | undefined
    let active = true
    const timer = window.setInterval(() => {
      if (request) return
      request = Canvases.canvasAssistantHistory({ canvasId, projectId })
      void request.then(response => {
        if (!active || !response.data) return
        const updates = new Map(response.data?.turns.map(turn => [turn.request_id, turn.generation]))
        setTurns(previous => previous?.map(turn => {
          const generation = updates.get(turn.request_id)
          return generation ? { ...turn, generation } : turn
        }))
      }).catch(() => { /* The next observation resumes after a transient read failure. */ })
        .finally(() => { request = undefined })
    }, 1500)
    return () => { active = false; window.clearInterval(timer); request?.cancel() }
  }, [open, activeGeneration, canvasId, projectId])

  useEffect(() => {
    if (!open) return
    const request = Canvases.canvasAssistantHistory({ canvasId, projectId })
    let current = true
    void request.then(response => {
      if (!response.data) throw new Error('missing assistant history')
      const saved = response.data.turns
      if (current) {
        setTurns(previous => (previous?.[previous.length - 1]?.sequence ?? 0) > (saved[saved.length - 1]?.sequence ?? 0)
          ? previous : saved)
        setModelId(response.data.model_id ?? null)
      }
    }).catch(() => { if (current) setHistoryError(true) })
    return () => { current = false; request.cancel() }
  }, [open, canvasId, projectId, retryLoad])

  useEffect(() => {
    if (!open) return
    let current = true
    const settings = LlmService.getModelSettingsApiV1LlmModelSettingsGet()
    const firstPage = LlmService.listModelsApiV1LlmModelsGet({ category: 'text', pageSize: 100 })
    setModelError(false)
    void Promise.all([settings, firstPage]).then(async ([defaults, first]) => {
      const data = first.data
      if (!data) throw new Error('missing assistant models')
      const listed = [...data.items]
      for (let page = 2; current && listed.length < data.pagination.total; page++) {
        const next = await LlmService.listModelsApiV1LlmModelsGet({ category: 'text', pageSize: 100, page })
        if (!next.data?.items.length) break
        listed.push(...next.data.items)
      }
      if (current) {
        setDefaultModelId(defaults.data?.default_text_model_id ?? null)
        setModels(listed)
      }
    }).catch(() => { if (current) setModelError(true) })
    return () => { current = false; settings.cancel(); firstPage.cancel() }
  }, [open, retryLoad])

  useEffect(() => {
    if (open) lastTurn.current?.scrollIntoView({ block: 'nearest' })
  }, [open, turns])

  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  const send = async () => {
    const text = draft.trim()
    if (sendingNow.current || savingModel || uploadingReference || !turns || !text) return
    if (!revising && !pending.current && effectiveScope === 'selection' && !selectedCards.length) return
    const requestBody: CanvasAssistantMessage = pending.current?.text === text
      ? pending.current : {
          text,
          request_id: crypto.randomUUID(),
          attachment_file_ids: referenceFiles.map(file => file.id),
          revises: revising?.request_id,
          context: revising?.proposal ? {
            ...readDraft(), scope: 'selection', card_ids: revising.proposal.groups
              ? [...new Set(revising.proposal.groups.filter(group => group.state === 'pending')
                .flatMap(group => group.edits.map(edit => edit.card_id)))]
              : [revising.proposal.card_id],
          } : effectiveScope === 'text' ? undefined : {
            ...readDraft(), scope: effectiveScope, card_ids: effectiveScope === 'selection' ? selectedCards : [],
          },
        }
    pending.current = requestBody
    sendingNow.current = true
    setSending(true)
    setSendError(undefined)
    try {
      const { data: turn } = await Canvases.canvasAssistantSend({ canvasId, projectId, requestBody })
      if (!turn) throw new Error('missing assistant reply')
      setTurns(current => current?.some(existing => existing.request_id === turn.request_id)
        ? current : [...(current || []).map(existing => turn.proposal && turn.revises === existing.request_id && existing.proposal
          ? { ...existing, proposal: { ...existing.proposal, state: 'superseded' as const,
            groups: existing.proposal.groups?.map(group => (group.state ?? 'pending') === 'pending'
              ? { ...group, state: 'superseded' as const } : group) } } : existing), turn])
      setRevising(undefined)
      setDraft('')
      setReferenceFiles([])
      pending.current = undefined
    } catch (error) {
      const detail = error instanceof ApiError ? error.body?.message ?? error.body?.detail : undefined
      setSendError(detail === 'ASSISTANT_TOOL_CALLING_REQUIRED' ? 'tools'
        : detail === 'ASSISTANT_TEXT_CAPABILITY_REQUIRED' ? 'text' : 'reply')
    } finally {
      sendingNow.current = false
      setSending(false)
    }
  }

  const chooseModel = async (selected: string) => {
    setSavingModel(true)
    setModelError(false)
    try {
      const { data } = await Canvases.canvasAssistantSetModel({
        canvasId, projectId, requestBody: { model_id: selected || null },
      })
      if (!data) throw new Error('missing assistant model preference')
      setModelId(data.model_id)
    } catch {
      setModelError(true)
    } finally {
      setSavingModel(false)
    }
  }

  const modelLabel = (model: ModelRead) => {
    const capability = model.effective_capabilities
    const modes = [
      ...(capability?.tool_calling ? [uiText("可读画布")] : []),
      ...(capability?.image_inputs ? [uiText("可读图片与视频静帧")] : []),
      ...(capability?.video_inputs
        ? [capability.audio_inputs ? uiText("可读连续画面及音轨") : uiText("可读连续画面")]
        : []),
    ]
    return [model.name, ...(modes.length ? modes : [uiText("仅文字对话")])].join(' · ')
  }
  const defaultModel = models.find(model => model.id === defaultModelId)
  const scopeOptions = [
    { label: uiText("仅对话"), value: 'text' },
    { label: uiText("分析所选卡片"), value: 'selection', disabled: !selectedCards.length },
    { label: uiText("审看整张画布"), value: 'canvas' },
  ]

  return <div className="canvas-assistant-dock">
    <WorkbenchIconButton ref={trigger} label={uiText("打开画布助手")} icon={<CommentOutlined />}
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => { if (open) close(); else { setHistoryError(false); setOpen(true) } }} />
    {open && <aside id={panelId} className="canvas-assistant-panel" aria-label={uiText("画布助手")}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.stopPropagation()
          close()
        }
      }}>
      <header className="canvas-assistant-header">
        <strong>{uiText("画布助手")}</strong>
        <WorkbenchIconButton label={uiText("关闭画布助手")} icon={<CloseOutlined />} variant="quiet" onClick={close} />
      </header>
      <div className="canvas-assistant-options">
        <Select value={modelId ?? ''} aria-label={uiText("助手模型")} popupMatchSelectWidth={false}
          disabled={sending || savingModel || !turns} onChange={selected => { void chooseModel(selected) }}
          options={[
            { label: defaultModel ? uiText("默认模型") + ' · ' + modelLabel(defaultModel) : uiText("默认模型"), value: '' },
            ...models.map(model => ({
              label: modelLabel(model), value: model.id,
              disabled: !model.effective_capabilities?.text_inputs || !model.effective_capabilities?.text_outputs,
            })),
          ]} />
        <Select<AssistantScope> value={effectiveScope} aria-label={uiText("提问范围")} popupMatchSelectWidth={false}
          disabled={sending} options={scopeOptions}
          onChange={value => { setScope(value); pending.current = undefined; setSendError(undefined) }} />
        {modelError && <span role="alert">{uiText("无法读取或切换助手模型")}</span>}
      </div>
      <div className="canvas-assistant-history" role="log" aria-live="polite">
        {historyError && <Alert type="error" message={uiText("暂时无法读取助手对话")}
          action={<WorkbenchButton onClick={() => { setHistoryError(false); setRetryLoad(value => value + 1) }}>{uiText("重试")}</WorkbenchButton>} />}
        {!turns && !historyError && <Spin aria-label={uiText("正在读取助手对话")} />}
        {turns?.map(turn => <article className="canvas-assistant-turn" key={turn.request_id}>
          <div className="canvas-assistant-question">{turn.text}</div>
          {!!turn.attachments?.length && <CanvasAssistantEvidence attachments={turn.attachments} />}
          <div>{turn.reply}</div>
          {turn.generation && <AssistantGeneration generation={turn.generation}
            openRun={runId => { close(); openRun(runId) }} />}
          {turn.proposal?.groups?.length ? <AssistantEditGroups groups={turn.proposal.groups}
            current={() => readDraft().draft}
            editDisabled={approvalDisabled || sending}
            revise={() => {
              setRevising(turn); pending.current = undefined; setSendError(undefined)
              composer.current?.querySelector('textarea')?.focus()
            }}
            decide={async (action, groupIds) => {
              if (action === 'approve' && !await approve(turn.request_id, groupIds)) return false
              if (action === 'reject') {
                const { data } = await Canvases.canvasAssistantDecideProposal({
                  canvasId, projectId, sourceId: turn.request_id,
                  requestBody: { action, expected_revision: readDraft().revision, group_ids: groupIds },
                })
                if (!data) return false
              }
              const { data } = await Canvases.canvasAssistantHistory({ canvasId, projectId })
              if (!data) return false
              setTurns(data.turns)
              if (revising?.request_id === turn.request_id) {
                pending.current = undefined
                setRevising(undefined)
              }
              return true
            }} /> : turn.proposal && <AssistantProposal proposal={turn.proposal} current={() => readDraft().draft} editDisabled={approvalDisabled || sending}
            revise={() => {
              setRevising(turn); pending.current = undefined; setSendError(undefined)
              composer.current?.querySelector('textarea')?.focus()
            }} decide={async action => {
              if (action === 'approve') {
                if (!await approve(turn.request_id)) return false
              } else {
                const { data } = await Canvases.canvasAssistantDecideProposal({
                  canvasId, projectId, sourceId: turn.request_id,
                  requestBody: { action, expected_revision: readDraft().revision },
                })
                if (!data) return false
              }
              const { data } = await Canvases.canvasAssistantHistory({ canvasId, projectId })
              if (!data) return false
              setTurns(data.turns)
              if (revising?.request_id === turn.request_id) {
                pending.current = undefined
                setRevising(undefined)
              }
              return true
            }} />}
          {!!turn.skills?.length && <small className="canvas-assistant-skills">
            {turn.skills.map(skill => skill.name).join('、')}
          </small>}
        </article>)}
        {sending && <p role="status">{uiText("助手正在回复")}</p>}
        <div ref={lastTurn} />
      </div>
      <form className="canvas-assistant-composer" ref={composer} onSubmit={event => { event.preventDefault(); void send() }}>
        {revising?.proposal && <div className="canvas-assistant-edit-actions">
          <span>{uiText("正在修订修改建议")} · {uiText(revising.proposal.card_name)}</span>
          <WorkbenchButton variant="quiet" disabled={sending} onClick={() => {
            setRevising(undefined); pending.current = undefined
          }}>{uiText("取消修订")}</WorkbenchButton>
        </div>}
        {sendError && <Alert type="error" message={sendError === 'tools'
          ? uiText("当前模型无法调用画布工具。切换可读画布的模型后，发送同一消息即可接续。")
          : sendError === 'text' ? uiText("当前模型无法进行文字对话，请切换助手模型。")
            : uiText("未收到助手回复，请检查助手模型后重试")} />}
        <Input.TextArea id={inputId} aria-label={uiText("给画布助手发消息")} value={draft} maxLength={16000}
          autoSize={{ minRows: 2, maxRows: 5 }} disabled={sending}
          onChange={event => { setDraft(event.target.value); pending.current = undefined; setSendError(undefined) }} />
        <CanvasAssistantAttachments projectId={projectId} files={referenceFiles} uploading={uploadingReference}
          setUploading={setUploadingReference} disabled={sending || !turns}
          onChange={files => { setReferenceFiles(files); pending.current = undefined; setSendError(undefined) }} />
        <WorkbenchButton htmlType="submit" variant="primary" loading={sending}
          disabled={!turns || !draft.trim() || savingModel || uploadingReference || !revising && !pending.current && effectiveScope === 'selection' && !selectedCards.length}>{uiText("发送消息")}</WorkbenchButton>
      </form>
    </aside>}
  </div>
}
