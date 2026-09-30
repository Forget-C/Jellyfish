import { useEffect, useState } from 'react'
import { Alert, Button, Card, Image, Select, Space, Typography } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { ContinuityRead, GenerationUnit_Input, UnitDependency, WorkspaceRead } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { directingError } from './common'

/** 显式声明历史单元依赖，选入实际落幅时同时建立真实图片输入绑定。 */
export function DependencyEditor({ projectId, workspace, unit, onChange, disabled, selectedSource }: {
  selectedSource?: { planId: string; unitId: string };
  projectId: string; workspace: WorkspaceRead; unit: GenerationUnit_Input; onChange: (value: Partial<GenerationUnit_Input>) => void; disabled: boolean
}) {
  const [state, setState] = useState<ContinuityRead>()
  const [error, setError] = useState('')
  const [source, setSource] = useState<string>()
  const options = workspace.plans.filter(plan => plan.confirmed_at).flatMap((plan, planIndex) => plan.content.units.map((row, index) => ({ value: `${plan.id}/${row.id}`, label: `计划 ${planIndex + 1} · 单元 ${index + 1} · ${plan.id.slice(0, 8)} / ${row.id}` })))
  /** 重新读取采用状态，防止把旧页面里的落幅当作最新有效证据。 */
  const reload = async () => {
    try { const response = await StudioDirectingService.directingContinuity({ projectId, sequenceId: workspace.sequence.id }); if (response.data) setState(response.data) }
    catch (cause) { setError(directingError(cause)) }
  }
  useEffect(() => { void StudioDirectingService.directingContinuity({ projectId, sequenceId: workspace.sequence.id }).then(response => setState(response.data || undefined)).catch(cause => setError(directingError(cause))) }, [projectId, workspace.sequence.id, workspace.cuts])
  /** 新依赖先处于未满足状态，不能仅凭计划完成标记提交。 */
  const add = () => {
    if (!source) return
    const [plan_revision_id, unit_id] = source.split('/')
    if (unit.dependencies?.some(link => link.plan_revision_id === plan_revision_id && link.unit_id === unit_id)) return
    onChange({ dependencies: [...unit.dependencies || [], { plan_revision_id, unit_id }] }); setSource(undefined)
  }
  /** 明确替换该依赖的证据输入，保留其他参考和历史计划身份。 */
  const bind = (link: UnitDependency, frameId: string) => {
    const frame = state?.frames.find(row => row.id === frameId && row.current)
    if (!frame) return
    const referenceId = link.reference_id || 'ref-' + crypto.randomUUID().slice(0, 8)
    const existing = unit.references.find(ref => ref.id === referenceId)
    const reference = { id: referenceId, file_id: frame.file_id, media_kind: 'image' as const, purpose: 'continuity' as const,
      participant_ids: existing?.participant_ids || [], ordinal: existing?.ordinal ?? unit.references.length,
      input_role: existing?.input_role || (unit.references.some(ref => ref.input_role === 'first_frame') ? 'subject' as const : 'first_frame' as const),
      source: { kind: 'human' as const, reference: 'local-user', version: 'actual-frame-1' } }
    onChange({ dependencies: (unit.dependencies || []).map(row => row === link ? { ...row, frame_id: frame.id, reference_id: referenceId } : row),
      references: existing ? unit.references.map(ref => ref.id === referenceId ? reference : ref) : [...unit.references, reference] })
  }
  return <Card size="small" title="前段实际落幅依赖">
    <Space direction="vertical" className="w-full">
      {error && <Alert type="error" message={error} />}
      <Typography.Text type="secondary">选择已确认计划中的来源单元，再绑定当前实际采用的落幅。参考输入位置可在下方调整，多个首帧或不支持的输入会阻止提交。</Typography.Text>
      <Space wrap><Select aria-label="前段来源单元" disabled={disabled} showSearch optionFilterProp="label" placeholder="选择来源计划与单元" style={{ width: 350 }} value={source} options={options} onChange={setSource} /><Button disabled={disabled || !source} onClick={add}>声明依赖</Button><Button onClick={() => { void reload() }}>刷新实际落幅</Button></Space>
      {(unit.dependencies || []).filter(link => !selectedSource || link.plan_revision_id === selectedSource.planId && link.unit_id === selectedSource.unitId).map((link, index) => {
        const frame = state?.frames.find(row => row.id === link.frame_id)
        return <Space key={`${link.plan_revision_id}/${link.unit_id}`} direction="vertical" className="w-full">
          <Typography.Text>依赖 {index + 1} · {link.plan_revision_id} / {link.unit_id}</Typography.Text>
          <Select aria-label={`依赖 ${index + 1} 实际落幅`} disabled={disabled} className="w-full" placeholder="尚未选入实际落幅，不能拍摄" value={link.frame_id || undefined} options={state?.frames.filter(row => row.current && row.edge === 'end' && row.plan_revision_id === link.plan_revision_id && row.unit_id === link.unit_id).map((row, i) => ({ value: row.id, label: `落幅 ${i + 1} · 片段 ${row.item_id} · ${row.at_ms / 1000} 秒` }))} onChange={id => bind(link, id)} />
          {frame && <Image width={120} src={buildFileDownloadUrl(frame.file_id)} />}
          {state && (!frame || !frame.current) && <Typography.Text type="warning">{link.frame_id ? '原采用片段已变化，请重新选择实际落幅并保存新计划。' : '请先在连续性页面从采用区间提取落幅。'}</Typography.Text>}
          <Button danger disabled={disabled} onClick={() => onChange({ dependencies: (unit.dependencies || []).filter(row => row !== link) })}>移除此依赖声明（参考素材保留）</Button>
        </Space>
      })}
    </Space>
  </Card>
}
