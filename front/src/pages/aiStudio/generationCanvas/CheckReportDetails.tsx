import { useUiText } from '../../../uiText'
import type { ReactNode } from 'react'
import type { CanvasCheckBasis, CanvasCheckItem, CanvasCheckReportRead, ModelRead } from '../../../services/generated'
import { CheckRecheckForm } from './CheckRecheckForm'
import type { RecheckContext } from './CheckRecheckForm'
import { HistoricalCheckProduct } from './HistoricalCheckProduct'
import { CanvasTextPreview } from '../../../components/workbench/CanvasTextPreview'
import './checkCard.css'

const executionStates = { queued: '排队中', running: '检查中', succeeded: '已完成', failed: '执行失败', cancelled: '已取消' }
const videoPhases = { before: '前态', during: '过程', after: '后态' }
const outcomes = { conforming: '符合', nonconforming: '明确问题', risk: '风险建议', indeterminate: '无法判断' }
const parameterLabels: Record<string, string> = {
  seconds: '时长（秒）', ratio: '画幅', target_ratio: '画幅', count: '数量', seed: '种子', resolution_profile: '分辨率',
}

export function BasisDetails({ basis, label }: { basis: CanvasCheckBasis; label: string }) {
  const uiText = useUiText()
  return <details className="generation-check-basis"><summary>{label}</summary>
    <p>{uiText("生成目标")} {basis.target_card_id} {uiText("· 修订")} {basis.revision}{basis.model_id && uiText(" · 模型 {{model_id}}", { model_id: basis.model_id })}</p>
    <dl>{Object.entries(basis.parameters).filter(([, value]) => value !== null).map(([key, value]) =>
      <div key={key}><dt>{uiText(parameterLabels[key] || key)}</dt><dd>{String(value)}</dd></div>)}</dl>
    {basis.capability && <p>{uiText("已接入输入：")}{basis.capability.input_ports.join('、') || uiText("无")}</p>}
    <section aria-label={uiText("实际提交文本")}><CanvasTextPreview text={basis.input.text || uiText("尚未填写生成文本")} label={uiText("实际提交文本")} /></section>
    <p>{uiText("已采用来源：")}{basis.input.used?.map(item => item.source.card_id).join('、') || uiText("无")}</p>
    {!!basis.input.mapping?.length && <ul aria-label={uiText("实际参考素材及用途")}>{basis.input.mapping.map((item, index) =>
      <li key={index}>{'source' in item ? `${item.source.card_id} · ${item.media_position === null ? '文本' : `素材 ${item.media_position}`}`
        : uiText("{{value1}} · {{value2}} · 素材 {{media_position}}", { value1: item.name || item.object_id, value2: item.input_port || '参考图片', media_position: item.media_position })}</li>)}</ul>}
    {basis.input.video_media && <details><summary>{uiText("实际视频素材用途")}</summary><pre>{JSON.stringify(basis.input.video_media, null, 2)}</pre></details>}
    {!!basis.input.diagnostics?.length && <ul aria-label={uiText("默认技术诊断")}>{basis.input.diagnostics.map((issue, index) =>
      <li key={index}>{issue.message}</li>)}</ul>}
  </details>
}

export function CheckReportDetails({ report, applicability, retry, recheck, itemId, models, showContext = !itemId, sourceAction, active }: {
  itemId?: string
  models?: ModelRead[]
  report: CanvasCheckReportRead
  applicability?: (item: CanvasCheckItem | undefined) => string
  retry?: (itemId: string) => ReactNode
  recheck?: RecheckContext
  showContext?: boolean
  sourceAction?: (item: CanvasCheckItem) => ReactNode
  active?: boolean
}) {
  const uiText = useUiText()
  const selected = itemId && report.items.find(item => item.id === itemId)
  return <>
    {showContext && <p>{report.scope === 'item' ? uiText("单项检查") : uiText("整卡检查")} {uiText("· 本轮已有")} {report.results.length} {uiText("项结论")}
      {report.enabled_item_ids !== null && report.enabled_item_ids !== undefined && uiText(" · 执行时启用 {{length}} 项", { length: report.enabled_item_ids.length })}
      {report.check_model_id && uiText(" · 检查模型 {{value1}}", { value1: models?.find(model => model.id === report.check_model_id)?.name || report.check_model_id })}</p>}
    {report.recheck && <details>
      <summary>{uiText("原报告复核 ·")} {report.recheck.report_id}</summary>
      <p>{uiText("原结论")} {uiText(outcomes[report.recheck.original_result.outcome])} · {report.recheck.original_result.message}</p>
      <p>{uiText("本次复核说明")} {report.recheck.clarification}</p>
    </details>}
    {showContext && report.automatic && <p>{uiText("完整交付后自动检查")}</p>}
    {showContext && report.product && <HistoricalCheckProduct product={report.product} active={active} />}
    {showContext && selected && !report.results.some(result => result.item_id === selected.id) && <>
      <p>{uiText("本报告要求 ·")} {selected.label} · {selected.requirement}</p>{sourceAction?.(selected)}
    </>}
    {!!report.executions?.length && <ul aria-label={uiText("模型检查执行状态")}>
      {report.executions.filter(execution => !itemId || execution.item_id === itemId).map(execution => {
        const item = report.items.find(row => row.id === execution.item_id)
        return <li key={execution.item_id}>
          {item && <span>{item.label} · </span>}
          <span role="status">{execution.status === 'running' && execution.cancel_requested
            ? uiText("已请求取消，等待执行结束") : uiText(executionStates[execution.status])}</span>
          {execution.reason && ` · ${execution.reason}`}
          {execution.status === 'failed' && retry?.(execution.item_id)}
        </li>
      })}
    </ul>}
    {report.results.filter(result => !itemId || result.item_id === itemId).map(result => {
      const item = report.items.find(row => row.id === result.item_id)
      return <article key={result.item_id}><strong>{uiText(outcomes[result.outcome])}</strong>
        {report.product ? <p>{uiText("此结论仅适用于固定历史产物")}</p> : applicability && <p role="status">{uiText(applicability(item))}</p>}
        {item && <><p>{uiText("本报告要求 ·")} {item.label} · {item.requirement}</p><details><summary>{uiText("历史来源身份")}</summary><p>{item.source.card_id} / {item.field_id}</p></details>{sourceAction?.(item)}</>}
        {item?.scope_editable && item.scope_note && <p>{uiText("本轮检查范围：")}{item.scope_note}</p>}
        <p>{result.message}</p>
        {!!result.text_evidence?.length && <ul aria-label={uiText("要求证据")}>
          {result.text_evidence.map(evidence => <li key={`${evidence.source.card_id}:${evidence.field_id}`}>
            <details><summary>{uiText("证据来源")}</summary><p>{evidence.source.card_id} / {evidence.field_id}</p></details>
            <blockquote>{evidence.excerpt}</blockquote>
          </li>)}
        </ul>}
        {result.submitted_excerpt && <blockquote aria-label={report.product ? uiText("产物片段") : uiText("提交片段")}>{result.submitted_excerpt}</blockquote>}
        {!!result.observed_media?.length && <ul aria-label={uiText("本轮观察素材")}>
          {result.observed_media.map((media, index) => <li key={index}>
            {media.video_range ? uiText("提交视频区间 {{start_ms}}–{{end_ms}} 毫秒 · 请求 {{sampling_fps}} 帧/秒", { start_ms: media.video_range.start_ms, end_ms: media.video_range.end_ms, sampling_fps: media.video_range.sampling_fps })
              : media.frame_at_ms !== null && media.frame_at_ms !== undefined ? uiText("视频静帧 {{frame_at_ms}} 毫秒", { frame_at_ms: media.frame_at_ms })
                : media.modality === 'image' ? uiText("已读取图片") : uiText("已读取视频")} · {media.file_id}
            {media.evidence_range && <p>{uiText("模型估计证据区间")} {media.evidence_range.start_ms}–{media.evidence_range.end_ms} {uiText("毫秒")}</p>}
            {media.description && <span> · {media.description}</span>}
            {!!media.moments?.length && <ol aria-label={uiText("模型估计的可见时刻")}>
              {media.moments.map(moment => <li key={moment.phase}>
                {uiText(videoPhases[moment.phase])} · {moment.at_ms} {uiText("毫秒 ·")} {moment.description}
              </li>)}
            </ol>}
          </li>)}
        </ul>}
        <small>{result.boundary}</small>
        {recheck && report.recheck_item_ids?.includes(result.item_id)
          && <CheckRecheckForm key={report.id} {...recheck} cardId={report.check_card_id} reportId={report.id} itemId={result.item_id} />}
      </article>
    })}
    {!!report.omitted?.length && <ul aria-label={uiText("本轮未执行")}>
      {report.omitted.filter(item => !itemId || item.item_id === itemId).map(item => <li key={item.item_id}>{item.label} · {item.source_card_id} · {item.reason}</li>)}
    </ul>}
    {showContext && <BasisDetails basis={report.basis} label={uiText("本报告固定依据")} />}
  </>
}
