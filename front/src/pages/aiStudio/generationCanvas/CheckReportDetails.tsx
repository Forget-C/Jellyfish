import type { ReactNode } from 'react'
import type { CanvasCheckBasis, CanvasCheckItem, CanvasCheckReportRead } from '../../../services/generated'
import { CheckRecheckForm } from './CheckRecheckForm'
import type { RecheckContext } from './CheckRecheckForm'
import { HistoricalCheckProduct } from './PostCheckPanel'
import './checkCard.css'

const executionStates = { queued: '排队中', running: '检查中', succeeded: '已完成', failed: '执行失败', cancelled: '已取消' }
const outcomes = { conforming: '符合', nonconforming: '明确问题', risk: '风险建议', indeterminate: '无法判断' }
const parameterLabels: Record<string, string> = {
  seconds: '时长（秒）', ratio: '画幅', target_ratio: '画幅', count: '数量', seed: '种子', resolution_profile: '分辨率',
}

export function BasisDetails({ basis, label }: { basis: CanvasCheckBasis; label: string }) {
  return <details className="generation-check-basis"><summary>{label}</summary>
    <p>生成目标 {basis.target_card_id} · 修订 {basis.revision}{basis.model_id && ` · 模型 ${basis.model_id}`}</p>
    <dl>{Object.entries(basis.parameters).filter(([, value]) => value !== null).map(([key, value]) =>
      <div key={key}><dt>{parameterLabels[key] || key}</dt><dd>{String(value)}</dd></div>)}</dl>
    {basis.capability && <p>已接入输入：{basis.capability.input_ports.join('、') || '无'}</p>}
    <pre aria-label="实际提交文本">{basis.input.text || '尚未填写生成文本'}</pre>
    <p>已采用来源：{basis.input.used?.map(item => item.source.card_id).join('、') || '无'}</p>
    {!!basis.input.mapping?.length && <ul aria-label="实际参考素材及用途">{basis.input.mapping.map((item, index) =>
      <li key={index}>{'source' in item ? `${item.source.card_id} · ${item.media_position === null ? '文本' : `素材 ${item.media_position}`}`
        : `${item.name || item.object_id} · ${item.input_port || '参考图片'} · 素材 ${item.media_position}`}</li>)}</ul>}
    {basis.input.video_media && <details><summary>实际视频素材用途</summary><pre>{JSON.stringify(basis.input.video_media, null, 2)}</pre></details>}
    {!!basis.input.diagnostics?.length && <ul aria-label="默认技术诊断">{basis.input.diagnostics.map((issue, index) =>
      <li key={index}>{issue.message}</li>)}</ul>}
  </details>
}

export function CheckReportDetails({ report, applicability, retry, recheck }: {
  report: CanvasCheckReportRead
  applicability?: (item: CanvasCheckItem | undefined) => string
  retry?: (itemId: string) => ReactNode
  recheck?: RecheckContext
}) {
  return <>
    <p>{report.scope === 'item' ? '单项检查' : '整卡检查'} · 本轮已有 {report.results.length} 项结论
      {report.enabled_item_ids != null && ` · 执行时启用 ${report.enabled_item_ids.length} 项`}
      {report.check_model_id && ` · 检查模型 ${report.check_model_id}`}</p>
    {report.recheck && <details>
      <summary>原报告复核 · {report.recheck.report_id}</summary>
      <p>原结论 {outcomes[report.recheck.original_result.outcome]} · {report.recheck.original_result.message}</p>
      <p>本次复核说明 {report.recheck.clarification}</p>
    </details>}
    {report.product && <HistoricalCheckProduct product={report.product} />}
    {!!report.executions?.length && <ul aria-label="模型检查执行状态">
      {report.executions.map(execution => {
        const item = report.items.find(row => row.id === execution.item_id)
        return <li key={execution.item_id}>
          {item && <span>{item.source.card_id}/{item.field_id} · </span>}
          <span role="status">{execution.status === 'running' && execution.cancel_requested
            ? '已请求取消，等待执行结束' : executionStates[execution.status]}</span>
          {execution.reason && ` · ${execution.reason}`}
          {execution.status === 'failed' && retry?.(execution.item_id)}
        </li>
      })}
    </ul>}
    {report.results.map(result => {
      const item = report.items.find(row => row.id === result.item_id)
      return <article key={result.item_id}><strong>{outcomes[result.outcome]}</strong>
        {report.product ? <p>此结论仅适用于固定历史产物</p> : applicability && <p role="status">{applicability(item)}</p>}
        {item && <p>{item.label} · 来源 {item.source.card_id}/{item.field_id} · {item.requirement}</p>}
        {item?.scope_editable && item.scope_note && <p>本轮检查范围：{item.scope_note}</p>}
        <p>{result.message}</p>
        {result.submitted_excerpt && <blockquote aria-label={report.product ? '产物片段' : '提交片段'}>{result.submitted_excerpt}</blockquote>}
        {!!result.observed_media?.length && <ul aria-label="本轮观察素材">
          {result.observed_media.map((media, index) => <li key={index}>
            {media.modality === 'image' ? '已读取图片' : '已读取视频'} · {media.file_id}
            {media.description && ` · ${media.description}`}
          </li>)}
        </ul>}
        <small>{result.boundary}</small>
        {recheck && (item?.category === 'P06' || item?.category === 'P01' || item?.category === 'R01' && report.product?.text != null)
          && <CheckRecheckForm key={report.id} {...recheck} cardId={report.check_card_id} reportId={report.id} itemId={result.item_id} />}
      </article>
    })}
    {!!report.omitted?.length && <ul aria-label="本轮未执行">
      {report.omitted.map(item => <li key={item.item_id}>{item.label} · {item.source_card_id} · {item.reason}</li>)}
    </ul>}
    <BasisDetails basis={report.basis} label="本报告固定依据" />
  </>
}
