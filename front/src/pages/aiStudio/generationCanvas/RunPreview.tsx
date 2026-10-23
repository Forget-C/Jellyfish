import { Alert, Button, Space } from 'antd'
import type { CanvasPrecheck } from '../../../services/generated'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'

/** Preview is bound to the current edit generation; diagnostics use stable targets. */
export function RunPreview({ preview, submitting, disabled, onSubmit }: { preview: CanvasPrecheck; submitting: boolean; disabled: boolean; onSubmit: () => void }) {
  const locate = (target: Record<string, unknown>) => {
    const cardId = target.card_id || preview.card_id
    const card = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(String(cardId))}"]`)
    const segmentId = target.segment_id || target.reference_id
    const element = segmentId ? card?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(String(segmentId))}"]`) || card : card
    if (element) { element.tabIndex = -1; element.focus(); element.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
  }
  return <section aria-label="运行预检" className="generation-run-preview">
    <strong>运行预检 · revision {preview.revision}</strong>
    <p>执行 {preview.execution_nodes.join('、')} · 复用已有结果 {preview.reused_results?.length || 0} 项</p>
    <section aria-label="实际提交文本"><CanvasTextPreview text={preview.input.text || ''} label="实际提交文本" /></section>
    <p>模型：{preview.model?.name || preview.model?.id || '未选择'}</p>
    <details><summary>有效模型参数</summary><pre>{JSON.stringify(preview.model?.params || {}, null, 2)}</pre></details>
    {preview.input.video_media && <details open><summary>实际视频用途</summary><pre>{JSON.stringify(preview.input.video_media, null, 2)}</pre></details>}
    {!!preview.input.mapping?.length && <details><summary>实际使用来源及媒体对应关系</summary><pre>{JSON.stringify(preview.input.mapping, null, 2)}</pre></details>}
    {(preview.diagnostics || []).map((diagnostic, index) => <Alert key={`${diagnostic.code}:${index}`} type={diagnostic.severity === 'warning' ? 'warning' : 'error'}
      message={`${diagnostic.code}: ${diagnostic.message}`} description={`阻止：${diagnostic.blocks.map(action => ({ run: '运行', save: '保存' }[action] || action)).join('、') || '无'}`}
      action={<Button size="small" onClick={() => locate(diagnostic.target)}>定位问题</Button>} />)}
    <Space><Button type="primary" loading={submitting} disabled={disabled || !preview.can_run || !preview.preview_token} onClick={onSubmit}>确认执行</Button>
      {!preview.can_run && <span>请修正阻塞问题并重新预检</span>}</Space>
  </section>
}
