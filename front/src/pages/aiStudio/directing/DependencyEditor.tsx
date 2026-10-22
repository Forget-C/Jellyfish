import { useEffect, useState } from 'react'
import { Alert, Button, Card, Image, Select, Space, Typography } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { ContinuityRead, GenerationUnit_Input, UnitDependency, WorkspaceRead } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { directingError } from './common'
import type { ScenePredecessorSelection } from './ScenePredecessorDialog'

/** 显式声明历史单元依赖，选入实际落幅时同时建立真实图片输入绑定。 */
export function DependencyEditor({ projectId, workspace, unit, onChange, disabled, selectedSource, sceneVersion = false, onSceneSelect }: {
  onSceneSelect?: (selection: ScenePredecessorSelection) => void;
  sceneVersion?: boolean; selectedSource?: { planId: string; unitId: string };
  projectId: string; workspace: WorkspaceRead; unit: Pick<GenerationUnit_Input, 'references' | 'dependencies'>; onChange: (value: Partial<Pick<GenerationUnit_Input, 'references' | 'dependencies'>>) => void; disabled: boolean
}) {
  const [state, setState] = useState<ContinuityRead>()
  const [error, setError] = useState('')
  const [source, setSource] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [reading, setReading] = useState(true)
  const options = workspace.plans.filter(plan => plan.confirmed_at).flatMap((plan, planIndex) => plan.content.units.map((row, index) => ({ value: `${plan.id}/${row.id}`, label: sceneVersion ? `拍摄依据 ${planIndex + 1} · 单元 ${index + 1} · ${row.coverage.map(item => item.action_scope).join('；')}` : `计划 ${planIndex + 1} · 单元 ${index + 1} · ${plan.id.slice(0, 8)} / ${row.id}` })))
  /** 重新读取采用状态，失败时禁用证据选择，不能用旧落幅代替已核实结果。 */
  useEffect(() => {
    let active = true
    setReading(true)
    void StudioDirectingService.directingContinuity({ projectId, sequenceId: workspace.sequence.id }).then(response => {
      if (!response.data) throw new Error('实际落幅尚未核实')
      if (active) { setState(response.data); setError('') }
    }).catch(cause => { if (active) setError(directingError(cause)) })
      .finally(() => { if (active) setReading(false) })
    return () => { active = false }
  }, [projectId, workspace.sequence.id, workspace.cuts, attempt])
  /** 新依赖先处于未满足状态，不能仅凭计划完成标记提交。 */
  const add = () => {
    if (!source) return
    const [plan_revision_id, unit_id] = source.split('/')
    if (unit.dependencies?.some(link => link.plan_revision_id === plan_revision_id && link.unit_id === unit_id)) return
    if (onSceneSelect) onSceneSelect({ kind: 'plan', link: { plan_revision_id, unit_id } })
    else onChange({ dependencies: [...unit.dependencies || [], { plan_revision_id, unit_id }] })
    setSource(undefined)
  }
  /** 明确替换该依赖的证据输入，保留其他参考和历史计划身份。 */
  const bind = (link: UnitDependency, frameId: string) => {
    const frame = state?.frames.find(row => row.id === frameId && row.current)
    if (!frame) return
    const referenceId = link.reference_id || 'ref-' + crypto.randomUUID().slice(0, 8)
    const existing = unit.references.find(ref => ref.id === referenceId)
    const reference = { id: referenceId, file_id: frame.file_id, media_kind: 'image' as const, purpose: 'continuity' as const,
      participant_ids: existing?.participant_ids || [], ordinal: existing?.ordinal ?? Math.max(-1, ...unit.references.map(ref => ref.ordinal)) + 1,
      input_role: existing?.input_role || (unit.references.some(ref => ref.input_role === 'first_frame') ? 'subject' as const : 'first_frame' as const),
      source: { kind: 'human' as const, reference: 'local-user', version: 'actual-frame-1' } }
    if (onSceneSelect) { onSceneSelect({ kind: 'plan', link: { ...link, frame_id: frame.id, reference_id: referenceId }, reference }); return }
    onChange({ dependencies: (unit.dependencies || []).map(row => row === link ? { ...row, frame_id: frame.id, reference_id: referenceId } : row),
      references: existing ? unit.references.map(ref => ref.id === referenceId ? reference : ref) : [...unit.references, reference] })
  }
  return <Card size="small" title="前段实际落幅依赖">
    <Space direction="vertical" className="w-full">
      {reading && <p>正在核实实际落幅</p>}
      {error && <Alert type="error" message="实际落幅读取失败" description={error} />}
      {!options.length && <p>当前暂无已确认的来源单元</p>}
      <Typography.Text type="secondary">{sceneVersion ? '历史来源占用本单元承接位置；重新选择会明确替换为一个前段和首帧。' : '选择已确认计划中的来源单元，再绑定当前实际采用的落幅。'}{!sceneVersion && '参考输入位置可在下方调整，多个首帧或不支持的输入会阻止提交。'}</Typography.Text>
      <Space wrap><Select aria-label="前段来源单元" disabled={disabled} showSearch optionFilterProp="label" placeholder={sceneVersion ? '选择固定依据与来源单元' : '选择来源计划与单元'} style={{ width: 350 }} value={source} options={options} onChange={setSource} /><Button disabled={disabled || !source} onClick={add}>声明依赖</Button><Button onClick={() => setAttempt(value => value + 1)}>刷新实际落幅</Button></Space>
      {(unit.dependencies || []).filter(link => !selectedSource || link.plan_revision_id === selectedSource.planId && link.unit_id === selectedSource.unitId).map((link, index) => {
        const frame = state?.frames.find(row => row.id === link.frame_id)
        return <Space key={`${link.plan_revision_id}/${link.unit_id}`} direction="vertical" className="w-full">
          {sceneVersion ? <><Typography.Text>依赖 {index + 1} · {options.find(option => option.value === `${link.plan_revision_id}/${link.unit_id}`)?.label || '原来源不可用'}</Typography.Text>
            <details><summary>固定来源身份</summary>{link.plan_revision_id} / {link.unit_id}</details></> : <Typography.Text>依赖 {index + 1} · {link.plan_revision_id} / {link.unit_id}</Typography.Text>}
          <Select aria-label={`依赖 ${index + 1} 实际落幅`} disabled={disabled || reading || !!error} className="w-full" placeholder="尚未选入实际落幅，不能拍摄" value={link.frame_id || undefined} options={state?.frames.filter(row => row.current && row.edge === 'end' && row.plan_revision_id === link.plan_revision_id && row.unit_id === link.unit_id).map((row, i) => ({ value: row.id, label: `落幅 ${i + 1} · 片段 ${row.item_id} · ${row.at_ms / 1000} 秒` }))} onChange={id => bind(link, id)} />
          {frame && <Image width={120} src={buildFileDownloadUrl(frame.file_id)} />}
          {state && (!frame || !frame.current) && <Typography.Text type="warning">{link.frame_id ? (sceneVersion ? '原采用片段已变化，请重新选择实际落幅并保存当前版本。' : '原采用片段已变化，请重新选择实际落幅并保存新计划。') : (sceneVersion ? '请先从剪辑采用区间提取实际落幅，再返回此处绑定。' : '请先在连续性页面从采用区间提取落幅。')}</Typography.Text>}
          <Button danger disabled={disabled} onClick={() => onChange({ dependencies: (unit.dependencies || []).filter(row => row !== link) })}>移除此依赖声明（参考素材保留）</Button>
        </Space>
      })}
    </Space>
  </Card>
}
