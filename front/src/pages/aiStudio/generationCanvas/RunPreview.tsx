import { Alert, Space } from 'antd'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import type { CanvasDocument, CanvasPrecheck } from '../../../services/generated'
import { referenceLabels } from './referenceLabels'
import { sourceKey } from './promptRules'
import { diagnosticRelatedCards } from './canvasRelationNavigation'
import { MediaPreview } from './MediaContentEditor'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'

/** Preview is bound to the current edit generation; diagnostics use stable targets. */
export function RunPreview({ preview, canvas, submitting, disabled, onSubmit, onLocate }: { preview: CanvasPrecheck; canvas?: CanvasDocument; submitting: boolean; disabled: boolean; onSubmit: () => void; onLocate?: (target: Record<string, unknown>) => void }) {
  const methods = { text: '文字模型检查', image: '图片模型检查', video_frame: '视频静帧检查',
    video_sequence: '视频序列检查', video_mixed: '视频序列与静帧检查' }
  const labels = canvas ? referenceLabels(canvas, preview.input.used || [], preview.card_id) : new Map<string, string>()
  const mediaKinds = new Map((preview.input.used || []).map(output => [sourceKey(output.source), output.modality]))
  const awaitingUpstream = preview.input.used?.some(item => preview.execution_nodes.includes(item.source.card_id))
  const inputLabel = awaitingUpstream ? '受理时输入预览' : '实际提交文本'
  const locate = (target: Record<string, unknown>) => {
    if (onLocate) { onLocate(target); return }
    const cardId = target.card_id || preview.card_id
    const card = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(String(cardId))}"]`)
    const segmentId = target.segment_id || target.reference_id
    const element = segmentId ? card?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(String(segmentId))}"]`) || card : card
    if (element) { element.tabIndex = -1; element.focus(); element.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
  }
  return <section aria-label="运行预检" className="generation-run-preview">
    <strong>运行预检 · revision {preview.revision}</strong>
    <p>执行 {preview.execution_nodes.join('、')} · 复用已有结果 {preview.reused_results?.length || 0} 项</p>
    {awaitingUpstream && <p>本轮上游完成后将使用新结果，下方为受理时已有输入。</p>}
    <section aria-label={inputLabel}><CanvasTextPreview text={preview.input.text || ''} label={inputLabel} /></section>
    {!preview.input.video_media && !!preview.input.media?.length && <section aria-label="实际参考图片">
      {preview.input.media.filter(output => output.modality === 'image').map((output, index) => <div key={`${output.source.card_id}:${output.source.position}`}>
        <p>参考图片 {index + 1} · {labels.get(sourceKey(output.source)) || output.token} → image {index + 1} · 来源 {output.source.card_id} / 输出 {output.source.position + 1}</p>
        {output.file_id && <MediaPreview fileId={output.file_id} type="image" />}
      </div>)}
    </section>}
    <p>模型：{preview.model?.name || preview.model?.id || '未选择'}</p>
    <details><summary>有效模型参数</summary><pre>{JSON.stringify(preview.model?.params || {}, null, 2)}</pre></details>
    {preview.input.video_media && <details open><summary>实际视频用途</summary><pre>{JSON.stringify(preview.input.video_media, null, 2)}</pre></details>}
    {!!preview.input.mapping?.length && <section aria-label="引用与实际媒体映射">{preview.input.mapping.filter(item => 'source' in item).map(item => 'source' in item && <p key={sourceKey(item.source)}>{labels.get(sourceKey(item.source)) || item.token} → {item.media_position ? `${mediaKinds.get(sourceKey(item.source)) || 'media'} ${item.media_position}` : '文本输入'} · {item.token}</p>)}</section>}
    {!!preview.input.mapping?.length && <details><summary>实际使用来源及媒体对应关系</summary><pre>{JSON.stringify(preview.input.mapping, null, 2)}</pre></details>}
    {(preview.diagnostics || []).map((diagnostic, index) => {
      const { target } = diagnostic
      const related = diagnosticRelatedCards(target)
      const explicitLocation = Array.isArray(target.path) && typeof target.card_id === 'string' || target.segment_id || target.reference_id
      return <Alert key={`${diagnostic.code}:${index}`} type={diagnostic.severity === 'warning' ? 'warning' : 'error'}
        message={`${diagnostic.code}: ${diagnostic.message}`} description={`阻止：${diagnostic.blocks.map(action => ({ run: '运行', save: '保存' }[action] || action)).join('、') || '无'}`}
        action={(explicitLocation || related.length > 0) && <Space wrap>
          {explicitLocation && <Button size="small" onClick={() => locate(target)}>定位问题</Button>}
          {related.map((id, position) => {
            const card = canvas?.cards?.find(item => item.id === id)
            const label = card && 'name' in card && card.name?.trim() || `相关卡片 ${position + 1}`
            return card ? <Button key={id} size="small" onClick={() => locate({ card_id: id, path: [] })}>定位 {label}</Button> : <small key={id}>{label} 已不可用</small>
          })}
        </Space>} />
    })}
    {!!preview.automatic_checks?.length && <section aria-label="本次自动生成后检查">
      <h4>完整交付后自动检查</h4>
      {preview.automatic_checks.map(plan => <p key={plan.check_card_id}>
        检查卡 {plan.check_card_id} · 生成目标 {plan.target_card_id} · 产物 {plan.product_count} 份 · {methods[plan.observation_method]}
        {` · 预计调用 ${plan.estimated_calls} 次`}
        {plan.reason && ` · ${plan.reason}`}
      </p>)}
    </section>}
    <Space><Button variant="primary" loading={submitting} disabled={disabled || !preview.can_run || !preview.preview_token} onClick={onSubmit}>确认执行</Button>
      {!preview.can_run && <span>请修正阻塞问题并重新预检</span>}</Space>
  </section>
}
