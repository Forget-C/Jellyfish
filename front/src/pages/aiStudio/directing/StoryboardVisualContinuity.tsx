import { useEffect, useRef, useState } from 'react'
import { Alert, Checkbox, Space } from 'antd'
import { StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasModelCapability, CanvasRead, ImageContentCard, VideoModelCard } from '../../../services/generated'
import { VideoFramePicker } from '../generationCanvas/VideoFramePicker'
import type { WorkbenchModelMenuContext } from '../generationCanvas/GenerationCanvasWorkspace'
import { directingError } from './common'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import { WorkbenchDialogActions, WorkbenchModal } from './ui/WorkbenchModal'
import { activeVisualContinuity, applyVisualContinuity, continuityPorts, continuityResults, storyboardShotIndex } from './visualContinuityRules'
import type { ContinuityPort } from './visualContinuityRules'

export function StoryboardVisualContinuity(context: WorkbenchModelMenuContext) {
  const [open, setOpen] = useState(false)
  const { card, document, disabled, closeMenu } = context
  if (card.type !== 'model.video' || storyboardShotIndex(document, card.id) <= 0) return null
  return <>
    <Button disabled={disabled} onClick={() => setOpen(true)}>视觉承接</Button>
    {open && <ContinuityPicker {...context} target={card as VideoModelCard} onClose={() => { setOpen(false); closeMenu() }} />}
  </>
}

function ContinuityPicker({ target, document, runs, disabled, prepare, commit, onClose }: WorkbenchModelMenuContext & {
  target: VideoModelCard
  onClose: () => void
}) {
  const projectId = document.project_id, canvasId = document.id
  const results = continuityResults(document, target.id, runs)
  const [resultId, setResultId] = useState(results[0]?.id ?? '')
  const result = results.find(item => item.id === resultId)
  const recommendation = results[0]?.id
  useEffect(() => {
    if (recommendation) setResultId(previous => previous || recommendation)
  }, [recommendation])
  const [purpose, setPurpose] = useState<ContinuityPort | ''>('')
  const [sameMotion, setSameMotion] = useState(false)
  const [subject, setSubject] = useState('')
  const [atMs, setAtMs] = useState<number>()
  const [error, setError] = useState('')
  const [capability, setCapability] = useState<CanvasModelCapability>()
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const prepared = useRef<{ key: string; id: string; before: CanvasRead; frame?: ImageContentCard }>()
  const adopted = activeVisualContinuity(document, target.id)
  useEffect(() => {
    setCapability(undefined)
    if (!target.model_id) return
    const request = Canvases.canvasModelCapability({ projectId, canvasId, modelId: target.model_id })
    let active = true
    void request.then(response => { if (active) setCapability(response.data ?? undefined) })
      .catch(cause => { if (active) setError(directingError(cause)) })
    return () => { active = false; request.cancel() }
  }, [projectId, canvasId, target.model_id])
  const ports = (Object.keys(continuityPorts) as ContinuityPort[]).filter(port => capability?.input_ports.includes(port))
  const valid = result && atMs !== undefined && purpose && ports.includes(purpose) && (purpose !== 'subject_image' || subject.trim())
  const submit = async () => {
    if (!result || atMs === undefined || !purpose || !valid || !capability || submitting.current || disabled) return
    const key = JSON.stringify([result.id, atMs, purpose, subject.trim(), capability.model_id])
    submitting.current = true
    setBusy(true); setError('')
    try {
      let pending = prepared.current?.key === key ? prepared.current : undefined
      if (!pending) {
        const before = await prepare()
        if (!before) throw new Error('请先保存当前画布，再采用承接画面')
        if (before.document.cards?.find(card => card.id === target.id && 'model_id' in card && card.model_id === capability.model_id) === undefined)
          throw new Error('当前镜头模型已变化，请重新选择参考用途')
        const compiled = (await Canvases.canvasCompile({ projectId, canvasId, cardId: target.id })).data
        if (compiled?.revision !== before.revision) throw new Error('画布已有新修订，请重新打开后采用')
        const media = compiled.video_media
        const frameInputs = !!(media?.frames?.first || media?.frames?.last || media?.frames?.keys?.length)
        if (!capability.supports_subject_reference_with_frame_reference &&
          (purpose === 'subject_image' ? frameInputs : media?.subjects?.length))
          throw new Error('当前模型不支持同时采用主体参考和帧参考，请保留当前输入或选择其他用途')
        if (purpose === 'first_frame' && media?.frames?.first || purpose === 'last_frame' && media?.frames?.last)
          throw new Error('此用途已有输入，请先解除后再采用')
        pending = { key, id: crypto.randomUUID(), before }
        prepared.current = pending
      }
      if (!pending.frame) {
        const response = await Canvases.canvasPrepareVideoFrame({ projectId, canvasId,
          requestBody: { ...result.source, at_ms: atMs, request_id: pending.id } })
        if (!response.data) throw new Error('无法读取选帧素材')
        pending.frame = response.data
      }
      const { before, frame, id } = pending
      if (await commit(before.revision, id, (current, catalog) =>
        applyVisualContinuity(current, catalog, capability, target.id, frame, purpose, subject.trim(), id))) onClose()
      else {
        setError('承接尚未确认，请关闭浮层并核对画布保存状态后重试')
      }
    } catch (cause) {
      setError(directingError(cause))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  return <WorkbenchModal title="视觉承接" open width={640} closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={onClose}
    footer={<WorkbenchDialogActions secondary={<Button disabled={busy} onClick={onClose}>取消</Button>}>
      <Button variant="primary" disabled={disabled || !valid || !!adopted} loading={busy} onClick={() => void submit()}>确认采用</Button>
    </WorkbenchDialogActions>}>
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {adopted && <p role="status">已采用 {continuityPorts[adopted.binding.input_port as ContinuityPort]} · {(adopted.origin.at_ms / 1000).toFixed(3)} 秒</p>}
      {!results.length ? <p>前镜尚无成功视频，可先生成当前镜头。</p> : <>
        <label>视频来源 <select aria-label="视频来源" value={result?.id ?? ''} disabled={busy} onChange={event => {
          setResultId(event.currentTarget.value); setAtMs(undefined); setPurpose(''); setSameMotion(false); setError('')
        }}>
          <option value="" disabled>请选择完整视频结果</option>
          {results.map(item => <option key={item.id} value={item.id}>{item.recommended ? '推荐前镜 · ' : ''}{item.label}</option>)}
        </select></label>
        {result && <>
          {ports.includes('first_frame') && <Checkbox checked={sameMotion} disabled={busy} onChange={event => setSameMotion(event.target.checked)}>
            同机位接续连续动作
          </Checkbox>}
          <VideoFramePicker key={result.id} fileId={result.source.source_file_id} disabled={busy} onPosition={setAtMs}
            onUseTail={sameMotion ? () => setPurpose('first_frame') : undefined} />
        </>}
        {!target.model_id ? <p>请先在当前视频卡选择模型。</p> : capability && !ports.length ? <p>当前模型不支持采用图片画面。</p> : null}
        <label>参考用途 <select aria-label="参考用途" value={purpose} disabled={busy || !ports.length}
          onChange={event => { setPurpose(event.currentTarget.value as ContinuityPort | ''); setError('') }}>
          <option value="">请选择用途</option>
          {ports.map(port => <option key={port} value={port}>{continuityPorts[port]}</option>)}
        </select></label>
        {purpose === 'subject_image' && <label>主体名称 <input aria-label="主体名称" value={subject} disabled={busy}
          onChange={event => setSubject(event.currentTarget.value)} /></label>}
      </>}
      {error && <Alert type="error" message={error} />}
    </Space>
  </WorkbenchModal>
}
