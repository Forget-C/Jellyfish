import { useRef, useState } from 'react'
import { Alert, Space } from 'antd'
import { StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasRead } from '../../../services/generated'
import type { WorkbenchModelMenuContext } from '../generationCanvas/GenerationCanvasWorkspace'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import { activeVisualContinuity } from './visualContinuityRules'
import { planVisualContinuityRemoval } from './visualContinuityRemoval'

type Offer = NonNullable<Awaited<ReturnType<typeof previewRemoval>>>

async function previewRemoval(before: CanvasRead, target: string) {
  const { document } = before
  const projectId = (document.project_id || ''), canvasId = document.id
  const card = document.cards?.find(item => item.id === target)
  const modelId = card && 'model_id' in card ? card.model_id : undefined
  const [latest, capability] = await Promise.all([
    Canvases.canvasGet({ projectId, canvasId }),
    modelId ? Canvases.canvasModelCapability({ projectId, canvasId, modelId }).then(response => response.data ?? undefined)
      .catch(() => undefined) : Promise.resolve(undefined),
  ])
  if (latest.data?.revision !== before.revision) throw new Error('画布已有新修订，请重新打开后核对')
  const relation = document.storyboard?.visual_continuity?.[target]
  const suspension = !relation?.restored ? relation?.suspended : undefined
  const inputs = [...Object.values(suspension?.input_bindings || {}), ...Object.values(suspension?.design_media_uses || {})]
  const ids = [...new Set(inputs.map(item => item.source.card_id))]
  const outputs = await Promise.all(ids.map(cardId => Canvases.canvasCardOutputs({ projectId, canvasId, cardId })
    .then(response => response.data?.outputs ?? []).catch(() => [])))
  const sourceFiles = inputs.map(item => {
    const { source } = item
    return outputs[ids.indexOf(source.card_id)]?.find(output => output.available !== false && output.source.port_id === source.port_id &&
      (output.source.object_id || output.source.position) === (source.object_id || source.position))?.file_id || null
  })
  const plan = planVisualContinuityRemoval(document, target, capability, sourceFiles.includes(null))
  return plan && { revision: before.revision, capability, sourceFiles, plan }
}

export function StoryboardContinuityRemoval({ document, card, disabled, prepare, commit, onComplete, onBusy }: WorkbenchModelMenuContext & {
  onComplete: () => void
  onBusy: (busy: boolean) => void
}) {
  const active = activeVisualContinuity(document, card.id)
  const record = document.storyboard?.visual_continuity?.[card.id]
  const [offer, setOffer] = useState<Offer>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const requestId = useRef<{ restore: boolean; revision: number; id: string }>()
  if (!active && (!record?.suspended || record.restored)) return null
  const read = async () => {
    const before = await prepare()
    if (!before) throw new Error('请先保存当前画布，再核对承接')
    const next = await previewRemoval(before, card.id)
    if (!next) throw new Error('视觉承接已变化，请重新打开后核对')
    return next
  }
  const verify = async (restore?: boolean) => {
    if (sending.current || disabled) return
    sending.current = true
    setBusy(true); onBusy(true); setError('')
    try {
      const next = await read()
      setOffer(next)
      if (restore === undefined) return
      if (!offer || offer.revision !== next.revision || JSON.stringify([offer.capability, offer.sourceFiles]) !==
        JSON.stringify([next.capability, next.sourceFiles])) {
        setError('模型或输入已变化，请重新确认')
        return
      }
      const planned = restore ? next.plan.restored : next.plan.without
      if (!planned) throw new Error('当前参考无法按已核对的方式处理')
      const pending = requestId.current
      const id = pending?.restore === restore && pending.revision === next.revision ? pending.id : crypto.randomUUID()
      requestId.current = { restore, revision: next.revision, id }
      if (await commit(next.revision, id, (saved) => {
        const current = planVisualContinuityRemoval(saved, card.id, next.capability, next.sourceFiles.includes(null))
        const candidate = restore ? current?.restored : current?.without
        if (!candidate) throw new Error('视觉承接已变化，请重新核对')
        return candidate
      })) onComplete()
      else setError('操作尚未确认，请核对画布保存状态后重试')
    } catch (cause) {
      setError(apiErrorMessage(cause))
    } finally {
      sending.current = false
      setBusy(false); onBusy(false)
    }
  }
  return <>
    {!offer && <Button disabled={disabled} loading={busy} onClick={() => void verify()}>
      {active ? '移除承接' : '核对并恢复原参考'}
    </Button>}
    {offer && <section aria-label="移除视觉承接">
      <p>选帧素材与历史视频将保留。</p>
      {!!offer.plan.labels.length && <><p>拟恢复的主体参考</p><ul>{offer.plan.labels.map((label, index) => <li key={index}>{label}</li>)}</ul></>}
      {offer.plan.removalIssue && <Alert type="warning" message={offer.plan.removalIssue} />}
      {!!offer.plan.restoreIssues.length && <Alert type="warning" message="当前无法恢复原参考"
        description={<ul>{offer.plan.restoreIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>} />}
      <Space wrap>
        <Button disabled={busy} onClick={() => { setOffer(undefined); setError('') }}>{offer.plan.active ? '取消移除' : '取消恢复'}</Button>
        {offer.plan.active && <Button disabled={disabled || busy || !offer.plan.without} onClick={() => void verify(false)}>
          仅移除承接
        </Button>}
        {!!offer.plan.labels.length && <Button variant="primary" disabled={disabled || busy || !offer.plan.restored} onClick={() => void verify(true)}>
          {offer.plan.active ? '移除并恢复原参考' : '确认恢复原参考'}
        </Button>}
      </Space>
    </section>}
    {error && <Alert type="error" message={error} />}
  </>
}
