import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Collapse, Empty, Image, Space, Spin, Tabs, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { StudioDirectingService } from '../../../services/generated'
import type { LedgerRead } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { directingError } from './common'
import { DesignEditor } from './DesignEditor'
import { ReviewDetails } from './ReviewDetails'

/** 三本账展示版本、来源和实验关联，编辑必须回到原始业务记录。 */
export function LedgerPanel({ projectId, sequenceId }: { projectId: string; sequenceId: string }) {
  const [data, setData] = useState<LedgerRead>()
  const [error, setError] = useState('')
  /** 按场次刷新聚合真值，失败保留上次结果和明确错误。 */
  const reload = useCallback(async () => {
    try { const response = await StudioDirectingService.directingLedger({ projectId, sequenceId }); if (response.data) setData(response.data) }
    catch (cause) { setError(directingError(cause)) }
  }, [projectId, sequenceId])
  useEffect(() => { void reload() }, [reload])
  if (!data) return <Space><Spin />{error && <Alert type="error" message={error} />}</Space>
  const { workspace, continuity, feedback } = data
  /** 展示 Take 到实际输入、设计与项目风格的完整可读链路。 */
  const trace = (takeId: string) => {
    const take = workspace.takes.find(row => row.id === takeId)
    const execution = data.executions.find(row => row.task_id === take?.task_id)
    const prompt = workspace.prompts.find(row => row.id === take?.prompt_revision_id)
    const plan = workspace.plans.find(row => row.id === take?.plan_revision_id)
    const unit = plan?.content.units.find(row => row.id === take?.unit_id)
    const design = workspace.designs.find(row => row.id === plan?.content.design_revision_id)
    return <Space direction="vertical" className="w-full">
      <Typography.Text copyable>Take {takeId} → 提示词 {prompt?.id} → 计划 {plan?.id} / 单元 {unit?.id} → 设计 {design?.id}</Typography.Text>
      {execution?.snapshot_available ? <p>实际执行：{execution.model_name} · {execution.provider_key} · {execution.seconds} 秒 · {execution.ratio} · 种子 {execution.seed ?? '未指定'} · {execution.status}</p> : <p>此条缺少完整实际执行快照，下方仅展示计划输入。</p>}
      {unit && <><p>计划模型：{unit.model_id} · {unit.duration_ms / 1000} 秒 · {unit.ratio} · 参数：{JSON.stringify(unit.parameters)}</p>
        {unit.coverage.map(item => <p key={item.id}>{item.shot_id}：{item.action_scope}</p>)}
        <Space wrap>{unit.references.map(ref => <Space key={ref.id} direction="vertical">{ref.media_kind === 'image' ? <Image width={100} src={buildFileDownloadUrl(ref.file_id)} /> : <a href={buildFileDownloadUrl(ref.file_id)}>查看参考文件</a>}<span>{ref.purpose} · {ref.input_role} · {ref.source.reference}</span></Space>)}</Space></>}
      <Collapse items={[{ key: 'prompt', label: '查看固定提示词和编译去向', children: <><Typography.Paragraph copyable className="whitespace-pre-wrap">{prompt?.content.text}</Typography.Paragraph>{prompt?.content.decisions.map((item, i) => <p key={i}>{item.section_path}：{item.disposition} · {item.explanation}</p>)}</> },
        { key: 'design', label: '查看原设计与六岗依据', children: design ? <><p>风格版本：{design.content.style_revision_id || '未指定'}</p><DesignEditor value={design.content} onChange={() => {}} disabled /></> : null }]} />
    </Space>
  }
  return <Space data-workspace-target="ledger" tabIndex={-1} direction="vertical" className="w-full" size="middle">
    {error && <Alert type="error" message={error} />}<Typography.Paragraph>本页直接组合原始业务数据。修改观察、采用或返工，请回对应页面；台账本身没有第二份可编辑真值。</Typography.Paragraph>
    <Space><Button onClick={reload}>刷新三本账</Button><Link to="?view=feedback">编辑验收与返工</Link><Link to="?view=cut">审片与粗剪</Link></Space>
    <Tabs items={[
      { key: 'continuity', label: '连续性账', children: <Space direction="vertical" className="w-full">
        <p>当前采用：{continuity.active_cut_revision_id || '尚无'}</p>
        {workspace.cuts.map((cut, index) => <Card key={cut.id} title={`剪辑 ${index + 1} · ${cut.id === continuity.active_cut_revision_id ? '当前采用' : cut.confirmed_at ? '历史确认' : '草稿'}`}>
          {cut.content.items.map(item => <Card key={item.id} size="small" title={`片段 ${item.id}`}>
            {'media_range' in item ? <><p>实际源区间 {item.media_range.source_in_ms / 1000}–{item.media_range.source_out_ms / 1000} 秒</p>{trace(item.take_id)}</> : <p>预演卡，无实际覆盖证据</p>}
          </Card>)}</Card>)}
        {continuity.seams.map(seam => <p key={seam.left_item_id + seam.right_item_id}>{seam.left_item_id} → {seam.right_item_id}：{seam.status} · {seam.rationale || '尚未审查'}</p>)}
        <Link to="?view=continuity">查看真实边界帧与局部失效</Link>
      </Space> },
      { key: 'prompts', label: '提示词版本账', children: <Space direction="vertical" className="w-full">
        {!workspace.prompts.length && <Empty description="尚无提示词" />}
        {workspace.prompts.map((prompt, index) => <Card key={prompt.id} title={`提示词 ${index + 1} · ${prompt.id}`}>
          <p>计划 {prompt.content.plan_revision_id} / 单元 {prompt.content.unit_id} · 非空白字符 {prompt.content.text.replace(/\s/g, '').length} · 格式 {prompt.content.format_version}</p>
          <Typography.Paragraph copyable className="whitespace-pre-wrap">{prompt.content.text}</Typography.Paragraph>
          {prompt.content.sources.map((source, i) => <p key={i}>来源：{source.reference} / {source.version}</p>)}
          {workspace.reviews.filter(review => review.content.occurrences.some(item => item.prompt_revision_id === prompt.id)).map(review => <details key={review.id}><summary>审稿 {review.id} · {review.confirmed_by || '草稿'}</summary>{review.content.rows.map((row, i) => <div key={i}><strong>{row.role} / {row.verdict}</strong><ReviewDetails row={row} /></div>)}</details>)}
          {data.actions.filter(action => action.revision_id === prompt.id || action.task_id && workspace.takes.some(take => take.prompt_revision_id === prompt.id && take.task_id === action.task_id)).map((action, i) => <p key={i}>{action.actor_id} · {action.displayed_label} · {action.created_at} · 任务 {action.task_id || '无'}</p>)}
          <p>产出：{workspace.takes.filter(take => take.prompt_revision_id === prompt.id).map(take => take.id).join('、') || '尚无 Take'}</p>
        </Card>)}
      </Space> },
      { key: 'takes', label: 'Take 实验账', children: <Space direction="vertical" className="w-full">
        {workspace.takes.map((take, index) => <Card key={take.id} title={`Take ${index + 1} · ${take.annotation.verdict || '未审'}`}>
          <video controls preload="metadata" className="w-full" src={buildFileDownloadUrl(take.file_id)} />
          {trace(take.id)}<p>观察：{take.annotation.rationale.text || take.annotation.rationale.reason || '未填写'}</p>
          {take.annotation.coverage.map(item => <p key={item.id}>{item.media_range.source_in_ms / 1000}–{item.media_range.source_out_ms / 1000} 秒：{item.observation} · 来源 {item.source.reference}</p>)}
          {feedback.repairs.filter(({ revision, prepared_plan_ids }) => prepared_plan_ids?.includes(take.plan_revision_id) || revision.content.result_take_id === take.id || workspace.cuts.find(cut => cut.id === revision.content.cut_revision_id)?.content.items.some(item => 'take_id' in item && item.id === revision.content.item_id && item.take_id === take.id)).map(repair => <Card key={repair.revision.id} size="small" title={`返工 ${repair.revision.id}`}>
            <p>症状：{repair.revision.content.symptom.text}；假设：{repair.revision.content.root_cause_hypothesis.text}</p><p>主要调整：{repair.revision.content.primary_change.text}</p>
            <p>返工计划：{repair.prepared_plan_ids?.join("、") || "尚未准备"}</p><p>结果 Take：{repair.revision.content.result_take_id || '尚无'}；比较：{repair.revision.content.comparison?.text || '待比较'}</p><p>实际变化：{repair.changed_factors.join('、') || '未检测到差异'}；归因：{repair.revision.content.attribution}</p>
          </Card>)}
          {feedback.knowledge.filter(row => row.content.evidence_take_ids?.includes(take.id)).map(row => <p key={row.id}>经验候选 {row.content.category}：{row.content.claim.text} · {row.confirmed_at ? '人工确认' : '待核对'}</p>)}
        </Card>)}
      </Space> },
    ]} />
  </Space>
}
