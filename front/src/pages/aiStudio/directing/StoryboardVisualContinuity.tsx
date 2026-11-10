import { useEffect, useRef, useState } from 'react'
import { Alert, Checkbox, Space } from 'antd'
import { StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasContinuitySuspension, CanvasModelCapability, CanvasRead, ImageContentCard, VideoModelCard } from '../../../services/generated'
import { VideoFramePicker } from '../generationCanvas/VideoFramePicker'
import { useVideoSourceStatus } from '../generationCanvas/videoSourceStatus'
import { buildFileDownloadUrl } from '../assets/utils'
import type { WorkbenchModelMenuContext } from '../generationCanvas/GenerationCanvasWorkspace'
import { StoryboardContinuityRemoval } from './StoryboardContinuityRemoval'
import { directingError } from './common'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import { WorkbenchDialogActions, WorkbenchModal } from './ui/WorkbenchModal'
import { activeVisualContinuity, applyVisualContinuity, continuityPorts, continuityResults, isAdoptedContinuityResult, newContinuityResult, planSubjectSuspension, storyboardShotIndex, subjectSuspensionLabels } from './visualContinuityRules'
import type { ContinuityPort } from './visualContinuityRules'

export function StoryboardVisualContinuity(context: WorkbenchModelMenuContext) {
  const [open, setOpen] = useState(false)
  const { card, document, disabled, closeMenu } = context
  const choice = document.storyboard?.visual_continuity?.[card.id]
  const shotIndex = storyboardShotIndex(document, card.id)
  if (card.type !== 'model.video' || shotIndex < 0 ||
    (shotIndex === 0 && !activeVisualContinuity(document, card.id) && (!choice?.suspended || choice.restored))) return null
  return <>
    <Button disabled={disabled} onClick={() => setOpen(true)}>视觉承接</Button>
    {open && <ContinuityPicker {...context} target={card as VideoModelCard} onClose={() => { setOpen(false); closeMenu() }} />}
  </>
}

type SwitchOffer = { key: string; revision: number; capability: string; suspension: CanvasContinuitySuspension; labels: string[] }

function ContinuityPicker(context: WorkbenchModelMenuContext & {
  target: VideoModelCard
  onClose: () => void
}) {
  const { target, document, runs, disabled, prepare, commit, onClose } = context
  const projectId = document.project_id, canvasId = document.id
  const results = continuityResults(document, target.id, runs)
  const adopted = activeVisualContinuity(document, target.id)
  const update = adopted && newContinuityResult(results, adopted.origin, runs)
  const savedResult = adopted && results.find(item => isAdoptedContinuityResult(item, adopted.origin))
  const recommendation = update?.id ?? savedResult?.id ?? results[0]?.id
  const [resultId, setResultId] = useState(recommendation ?? '')
  const result = results.find(item => item.id === resultId)
  const resultStatus = useVideoSourceStatus(result?.source.source_file_id)
  const adoptedPort = adopted?.binding.input_port as ContinuityPort | undefined
  useEffect(() => {
    if (recommendation) setResultId(previous => previous || recommendation)
  }, [recommendation])
  const [purpose, setPurpose] = useState<ContinuityPort | ''>(adoptedPort ?? '')
  const [sameMotion, setSameMotion] = useState(false)
  const [subject, setSubject] = useState(adopted?.binding.subject_name ?? '')
  const [atMs, setAtMs] = useState<number>()
  const [switchOffer, setSwitchOffer] = useState<SwitchOffer>()
  const [error, setError] = useState('')
  const [capability, setCapability] = useState<CanvasModelCapability>()
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)
  const submitting = useRef(false)
  const prepared = useRef<{ key: string; id: string; before: CanvasRead; frame?: ImageContentCard }>()
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
  const sameFrame = result && adopted && isAdoptedContinuityResult(result, adopted.origin) && atMs === adopted.origin.at_ms
  const valid = result && resultStatus === 'available' && atMs !== undefined && purpose && ports.includes(purpose) && !sameFrame
    && (purpose !== 'subject_image' || subject.trim())
  const submit = async (approval?: SwitchOffer) => {
    if (!result || atMs === undefined || !purpose || !valid || !capability || submitting.current || disabled || removing) return
    const key = JSON.stringify([result.id, atMs, purpose, subject.trim(), capability.model_id])
    submitting.current = true
    setBusy(true); setError('')
    try {
      const before = await prepare()
      if (!before) throw new Error('请先保存当前画布，再采用承接画面')
      const current = before.document.cards?.find(card => card.id === target.id) as VideoModelCard | undefined
      if (current?.type !== 'model.video' || !current.model_id || current.model_id !== capability.model_id)
        throw new Error('当前镜头模型已变化，请重新选择参考用途')
      const replacing = activeVisualContinuity(before.document, target.id)
      if (replacing?.frame.id !== adopted?.frame.id || (replacing && replacing.binding.input_port !== purpose))
        throw new Error('当前承接已变化，请重新选择画面')
      const [capabilityResponse, compilation] = await Promise.all([
        Canvases.canvasModelCapability({ projectId, canvasId, modelId: current.model_id }),
        Canvases.canvasCompile({ projectId, canvasId, cardId: target.id }),
      ])
      const currentCapability = capabilityResponse.data
      if (!currentCapability || !currentCapability.input_ports.includes(purpose)) {
        setCapability(currentCapability ?? undefined); setSwitchOffer(undefined)
        throw new Error('当前模型的参考能力已变化，请重新选择用途')
      }
      const compiled = compilation.data
      if (compiled?.revision !== before.revision) {
        setSwitchOffer(undefined)
        throw new Error('画布已有新修订，请重新打开后采用')
      }
      const media = compiled.video_media
      const frameInputs = !!(media?.frames?.first || media?.frames?.last || media?.frames?.keys?.length)
      const first = media?.frames?.first, last = media?.frames?.last
      const occupied = purpose === 'first_frame' ? first : purpose === 'last_frame' ? last : undefined
      if (occupied && occupied.file_id !== replacing?.frame.file_id)
        throw new Error('此用途已有输入，请先解除后再采用')
      const plan = !replacing && !currentCapability.supports_subject_reference_with_frame_reference && purpose === 'first_frame'
        ? planSubjectSuspension(current) : undefined
      const previous = before.document.storyboard?.visual_continuity?.[target.id]
      if (plan && previous?.suspended && !previous.restored) throw new Error('请先核对当前已停用的主体参考')
      if (plan) {
        const nextOffer = { key, revision: before.revision, capability: JSON.stringify(currentCapability),
          suspension: plan.suspension, labels: subjectSuspensionLabels(before.document, current, plan.suspension) }
        if (!approval || JSON.stringify(approval) !== JSON.stringify(nextOffer)) {
          setSwitchOffer(nextOffer)
          if (approval) setError('参考冲突已变化，请重新核对')
          return
        }
      } else if (approval) {
        setSwitchOffer(undefined)
        throw new Error('参考冲突已变化，请重新确认采用')
      } else if (!currentCapability.supports_subject_reference_with_frame_reference &&
        (purpose === 'subject_image' ? frameInputs : media?.subjects?.length)) {
        throw new Error('当前模型不支持同时采用主体参考和帧参考，请保留当前输入或选择其他用途')
      }
      let pending = prepared.current?.key === key && prepared.current.before.revision === before.revision ? prepared.current : undefined
      if (!pending) {
        pending = { key, id: crypto.randomUUID(), before }
        prepared.current = pending
      }
      if (!pending.frame) {
        const response = await Canvases.canvasPrepareVideoFrame({ projectId, canvasId,
          requestBody: { ...result.source, at_ms: atMs, request_id: pending.id } })
        if (!response.data) throw new Error('无法读取选帧素材')
        pending.frame = response.data
      }
      const { frame, id } = pending
      if (await commit(before.revision, id, (saved, catalog) =>
        applyVisualContinuity(saved, catalog, currentCapability, target.id, frame, purpose, subject.trim(), id, plan?.suspension))) onClose()
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
  return <WorkbenchModal title="视觉承接" open width={640} closable={!busy && !removing} maskClosable={!busy && !removing} keyboard={!busy && !removing} onCancel={onClose}
    footer={<WorkbenchDialogActions secondary={<Button disabled={busy || removing} onClick={onClose}>{switchOffer ? '保留主体参考并取消采用' : adopted ? '保留当前采用' : '取消'}</Button>}>
      <Button variant="primary" disabled={disabled || removing || !valid} loading={busy} onClick={() => void submit(switchOffer)}>
        {switchOffer ? '切换为首帧并停用主体参考' : adopted ? '确认重新采用' : '确认采用'}
      </Button>
    </WorkbenchDialogActions>}>
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {switchOffer && <section aria-label="参考组合冲突">
        <Alert type="warning" message="当前模型不能同时使用首帧与主体参考" />
        <p>切换只停用此视频卡中的以下采用及相关引用，原卡片和素材保留。</p>
        <ul>{switchOffer.labels.map((label, index) => <li key={index}>{label}</li>)}</ul>
      </section>}
      <StoryboardContinuityRemoval {...context} disabled={disabled || busy} onComplete={onClose} onBusy={setRemoving} />
      {adopted && <section aria-label="当前采用画面">
        <p>已采用 {adoptedPort && continuityPorts[adoptedPort]} · {(adopted.origin.at_ms / 1000).toFixed(3)} 秒</p>
        {adopted.frame.file_id && <img src={buildFileDownloadUrl(adopted.frame.file_id)} alt="当前固定画面"
          style={{ display: 'block', maxHeight: 120, maxWidth: '100%' }} />}
      </section>}
      {update && <Alert type="info" showIcon message="来源镜头有新结果" description="可切换查看已采用的成果和新成果，确认后沿用当前参考用途并替换固定画面。" />}
      {!results.length ? <p>{adopted ? '来源镜头已不可用，仍使用已保存的固定画面。' : '前镜尚无成功视频，可先生成当前镜头。'}</p> : <>
        <label>视频来源 <select aria-label="视频来源" value={result?.id ?? ''} disabled={busy || removing || !!switchOffer} onChange={event => {
          setResultId(event.currentTarget.value); setAtMs(undefined); setPurpose(adoptedPort ?? ''); setSameMotion(false); setError('')
        }}>
          <option value="" disabled>请选择完整视频结果</option>
          {results.map(item => <option key={item.id} value={item.id}>{adopted && isAdoptedContinuityResult(item, adopted.origin) ? '已采用的成果 · ' : item.id === update?.id ? '新成果 · ' : item.recommended ? '推荐前镜 · ' : ''}{item.label}</option>)}
        </select></label>
        {result && resultStatus === 'unavailable' && <Alert type="warning" message="视频暂不可播放，无法选帧" />}
        {result && resultStatus === 'pending' && <p>正在核对来源视频。</p>}
        {result && resultStatus === 'available' && <>
          {(!adopted || adoptedPort === 'first_frame') && ports.includes('first_frame') && <Checkbox checked={sameMotion} disabled={busy || removing || !!switchOffer} onChange={event => setSameMotion(event.target.checked)}>
            同机位接续连续动作
          </Checkbox>}
          <VideoFramePicker key={result.id} fileId={result.source.source_file_id} disabled={busy || removing || !!switchOffer} onPosition={at => { if (!busy && !removing && !switchOffer) setAtMs(at) }}
            onUseTail={sameMotion ? () => setPurpose('first_frame') : undefined} />
        </>}
        {!target.model_id ? <p>请先在当前视频卡选择模型。</p> : capability && !ports.length ? <p>当前模型不支持采用图片画面。</p> : null}
        <label>参考用途 <select aria-label="参考用途" value={purpose} disabled={busy || removing || !!switchOffer || !ports.length || !!adopted}
          onChange={event => { setPurpose(event.currentTarget.value as ContinuityPort | ''); setError('') }}>
          <option value="">请选择用途</option>
          {ports.map(port => <option key={port} value={port}>{continuityPorts[port]}</option>)}
        </select></label>
        {purpose === 'subject_image' && <label>主体名称 <input aria-label="主体名称" value={subject} disabled={busy || removing || !!adopted}
          onChange={event => setSubject(event.currentTarget.value)} /></label>}
      </>}
      {error && <Alert type="error" message={error} />}
    </Space>
  </WorkbenchModal>
}
