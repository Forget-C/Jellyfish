import { useUiText } from '../../../uiText'
import { Alert, Space } from 'antd'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import type { CanvasCatalog, CanvasDocument, CanvasPrecheck } from '../../../services/generated'
import { referenceLabels } from './referenceLabels'
import { sourceKey } from './promptRules'
import { diagnosticCardAction } from './canvasDiagnosticNavigation'
import { diagnosticRelatedCards } from './canvasRelationNavigation'
import { MediaPreview } from './MediaContentEditor'
import { CanvasTextPreview } from '../../../components/workbench/CanvasTextPreview'

/** Preview is bound to the current edit generation; diagnostics use stable targets. */
export function RunPreview({ preview, canvas, catalog, submitting, disabled, onSubmit, onLocate }: { preview: CanvasPrecheck; canvas?: CanvasDocument; catalog?: CanvasCatalog; submitting: boolean; disabled: boolean; onSubmit: () => void; onLocate: (target: Record<string, unknown>) => void }) {
  const uiText = useUiText()
  const methods = { text: '文字模型检查', image: '图片模型检查', video_frame: '视频静帧检查',
    video_sequence: '视频序列检查', video_mixed: '视频序列与静帧检查' }
  const labels = canvas ? referenceLabels(canvas, preview.input.used || [], preview.card_id) : new Map<string, string>()
  const mediaKinds = new Map((preview.input.used || []).map(output => [sourceKey(output.source), output.modality]))
  return <section aria-label={uiText("运行预检")} className="generation-run-preview">
    <strong>{uiText("运行预检 · revision")} {preview.revision}</strong>
    <p>{uiText("执行")} {preview.execution_nodes.join('、')} {uiText("· 复用已有结果")} {preview.reused_results?.length || 0} {uiText("项")}</p>
    <section aria-label={uiText("实际提交文本")}><CanvasTextPreview text={preview.input.text || ''} label={uiText("实际提交文本")} /></section>
    {!preview.input.video_media && !!preview.input.media?.length && <section aria-label={uiText("实际参考图片")}>
      {preview.input.media.filter(output => output.modality === 'image').map((output, index) => <div key={`${output.source.card_id}:${output.source.position}`}>
        <p>{uiText("参考图片")} {index + 1} · {labels.get(sourceKey(output.source)) || output.token} → image {index + 1} {uiText("· 来源")} {output.source.card_id} {uiText("/ 输出")} {output.source.position + 1}</p>
        {output.file_id && <MediaPreview fileId={output.file_id} type="image" />}
      </div>)}
    </section>}
    <p>{uiText("模型：")}{preview.model?.name || preview.model?.id || uiText("未选择")}</p>
    <details><summary>{uiText("有效模型参数")}</summary><pre>{JSON.stringify(preview.model?.params || {}, null, 2)}</pre></details>
    {preview.input.video_media && <details open><summary>{uiText("实际视频用途")}</summary><pre>{JSON.stringify(preview.input.video_media, null, 2)}</pre></details>}
    {!!preview.input.mapping?.length && <section aria-label={uiText("引用与实际媒体映射")}>{preview.input.mapping.filter(item => 'source' in item).map(item => 'source' in item && <p key={sourceKey(item.source)}>{labels.get(sourceKey(item.source)) || item.token} → {item.media_position ? `${mediaKinds.get(sourceKey(item.source)) || 'media'} ${item.media_position}` : uiText("文本输入")} · {item.token}</p>)}</section>}
    {!!preview.input.mapping?.length && <details><summary>{uiText("实际使用来源及媒体对应关系")}</summary><pre>{JSON.stringify(preview.input.mapping, null, 2)}</pre></details>}
    {(preview.diagnostics || []).map((diagnostic, index) => {
      const { target } = diagnostic
      const related = diagnosticRelatedCards(target)
      const segment = target.segment_id ?? target.reference_id
      const cardId = typeof target.card_id === 'string' ? target.card_id : typeof segment === 'string' ? preview.card_id : undefined
      const card = canvas?.cards?.find(item => item.id === cardId)
      const fields = catalog?.cards.find(definition => definition.type === card?.type)?.fields || []
      const explicitLocation = card && diagnosticCardAction(card, target, fields)
      const unavailableCard = cardId && !card
      return <Alert key={`${diagnostic.code}:${index}`} type={diagnostic.severity === 'warning' ? 'warning' : 'error'}
        message={`${diagnostic.code}: ${diagnostic.message}`} description={<><div>{uiText("阻止：{{value1}}", { value1: diagnostic.blocks.map(action => ({ run: '运行', save: '保存' }[action] || action)).join('、') || '无' })}</div>{unavailableCard && <small>{uiText("问题所指的卡片已不可用")}</small>}</>}
        action={(explicitLocation || related.length > 0) && <Space wrap>
          {explicitLocation && <Button size="small" onClick={() => onLocate(target)}>{explicitLocation === '查看卡片' ? explicitLocation : uiText("定位问题")}</Button>}
          {related.map((id, position) => {
            const card = canvas?.cards?.find(item => item.id === id)
            const label = card && 'name' in card && card.name?.trim() || uiText("相关卡片 {{value1}}", { value1: position + 1 })
            return card ? <Button key={id} size="small" onClick={() => onLocate({ card_id: id, path: [] })}>{uiText("定位")} {label}</Button> : <small key={id}>{label} {uiText("已不可用")}</small>
          })}
        </Space>} />
    })}
    {!!preview.automatic_checks?.length && <section aria-label={uiText("本次自动生成后检查")}>
      <h4>{uiText("完整交付后自动检查")}</h4>
      {preview.automatic_checks.map(plan => <p key={plan.check_card_id}>
        {uiText("检查卡")} {plan.check_card_id} {uiText("· 生成目标")} {plan.target_card_id} {uiText("· 产物")} {plan.product_count} {uiText("份 ·")} {methods[plan.observation_method]}
        {uiText(" · 预计调用 {{estimated_calls}} 次", { estimated_calls: plan.estimated_calls })}
        {plan.reason && ` · ${plan.reason}`}
      </p>)}
    </section>}
    <Space><Button variant="primary" loading={submitting} disabled={disabled || !preview.can_run || !preview.preview_token} onClick={onSubmit}>{uiText("确认执行")}</Button>
      {!preview.can_run && <span>{uiText("请修正阻塞问题并重新预检")}</span>}</Space>
  </section>
}
