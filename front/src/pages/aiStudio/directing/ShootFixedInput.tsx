import { useContext, useEffect, useState } from 'react'
import { Button, Tag } from 'antd'
import { LlmService } from '../../../services/generated'
import type { WorkspaceRead } from '../../../services/generated'
import { ReferencePreview } from './ReferencePreview'
import { SourceLinks } from './Sources'
import { ProductionDetailContext } from './ProductionWorkbench'
import { revisionName } from './workspaceUsage'

/** 只展示所选指令冻结的计划；名称读取失败不替换模型或借用当前编辑参数。 */
export function ShootFixedInput({ workspace, prompt, review, onHistory, compact = false }: {
  workspace: WorkspaceRead; prompt: WorkspaceRead['prompts'][number]; review?: WorkspaceRead['reviews'][number]; onHistory?: () => void; compact?: boolean;
}) {
  const detail = useContext(ProductionDetailContext)
  const plan = workspace.plans.find(row => row.id === prompt.content.plan_revision_id)
  const unit = plan?.content.units.find(row => row.id === prompt.content.unit_id)
  const design = workspace.designs.find(row => row.id === plan?.content.design_revision_id)
  const [model, setModel] = useState<{ id: string; name: string }>()
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let current = true
    setFailed(false)
    if (unit?.model_id) void LlmService.getModelApiV1LlmModelsModelIdGet({ modelId: unit.model_id }).then(response => {
      if (!response.data?.name) throw new Error('模型名称暂不可用')
      if (current) setModel({ id: unit.model_id, name: response.data.name })
    }).catch(() => { if (current) setFailed(true) })
    return () => { current = false }
  }, [unit?.model_id, attempt])
  if (!plan || !unit) return <p>此指令的固定计划暂不可用，请核对版本依据。</p>
  const summary = <dl><div><dt>模型</dt><dd>{model?.id === unit.model_id ? model.name : failed ? '模型名称暂不可用' : '正在读取模型名称'}{failed && <Button type="link" size="small" onClick={() => setAttempt(value => value + 1)}>重试</Button>}</dd></div>
      <div><dt>{compact ? '计划时长' : '时长'}</dt><dd>{unit.duration_ms / 1000} 秒</dd></div><div><dt>画幅</dt><dd>{unit.ratio}</dd></div><div><dt>参考素材</dt><dd>{unit.references.length} 份</dd></div></dl>
  if (compact) return <section className="shoot-execution-summary" aria-label="本次执行依据"><div><strong>{revisionName(workspace.prompts, prompt.id, '指令')}</strong><span>{review ? ' · 检查结论已保存' : ' · 尚未选择检查结论'}</span><Button type="link" onClick={() => detail.show({ tab: 'input' })}>查看执行依据</Button></div>{summary}</section>
  return <section className="shoot-fixed-input" aria-label="本次固定输入详情">{summary}
    <div className="shoot-fixed-references">{[...unit.references].sort((a, b) => a.ordinal - b.ordinal).map(reference => <figure key={reference.id}>
      <ReferencePreview reference={reference} />
      <figcaption>{({ subject: '主体参考', first_frame: '首帧构图', last_frame: '尾帧构图', key_frame: '关键帧' } as Record<string, string>)[reference.input_role || ''] || '参考素材'} · {reference.ordinal + 1}</figcaption>
      <small>{reference.participant_ids.map(id => design?.content.participants.find(row => row.id === id)?.name || '历史参与者暂不可用').join('、') || '整体画面'}</small>
      <SourceLinks sources={[reference.source]} />
    </figure>)}</div>
    {!unit.references.length && <p className="design-secondary">本次未绑定参考，能否生成仍以模型校验为准。</p>}
    <h3>本次动作</h3>{unit.coverage.map(item => {
      const index = design?.content.direction.shots.findIndex(shot => shot.id === item.shot_id) ?? -1
      return <p key={item.id}><strong>{index < 0 ? '历史镜头' : `镜头 ${String(index + 1).padStart(2, '0')}`}</strong> · {item.action_scope}</p>
    })}
    <h3>版本来源链</h3><div className="shoot-version-chain"><Tag>{revisionName(workspace.designs, plan.content.design_revision_id, '设计')}</Tag><span>→</span><Tag>{revisionName(workspace.plans, plan.id, '计划')}</Tag><span>→</span><Tag>{revisionName(workspace.prompts, prompt.id, '指令')}</Tag></div>
    {review && <p>{revisionName(workspace.reviews, review.id, '检查')} · {review.parent_id ? '含人工取舍' : '结论已保存'}</p>}
    <Button type="link" onClick={onHistory}>查看版本依据</Button>
    <details><summary>全部固定参数与技术标识</summary><p>模型：{unit.model_id}</p><p>计划：{plan.id} · 单元：{unit.id} · 指令：{prompt.id}</p>{Object.entries(unit.parameters || {}).map(([key, value]) => <p key={key}>{({ seed: '随机种子', guidance_scale: '提示词引导强度' } as Record<string, string>)[key] || key}：{typeof value === 'object' ? JSON.stringify(value) : String(value)}</p>)}</details>
  </section>
}
