import { useWorkspaceDraft, useWorkspaceDraftStatus, WorkspaceWriteBoundary } from './WorkspaceDrafts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Image, Input, Select, Space, Tag, Typography } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { ContinuityRead, CutFrameRead, SeamRead, WorkspaceRead } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { useSearchParams } from 'react-router-dom'
import { cutDestination, takeAction } from './workspaceCut'
import { revisionName } from './workspaceUsage'
import { directingError } from './common'

/** 展示实际区间的首尾帧与原视频，明确区分历史证据和当前采用。 */
function FrameEvidence({ frame }: { frame: CutFrameRead }) {
  return <Space direction="vertical"><Image width={160} src={buildFileDownloadUrl(frame.file_id)} /><Typography.Text type="secondary">{frame.edge === 'end' ? '落幅' : '入幅'} · {(frame.at_ms / 1000).toFixed(3)} 秒</Typography.Text></Space>
}

/** 针对当前相邻片段显式选择两张实际边界帧并保存人工结论。 */
function SeamEditor({ seam, frames, onReview, busy, blocked }: {
  seam: SeamRead; frames: CutFrameRead[]; onReview: (left: string, right: string, verdict: 'pass' | 'revise', rationale: string) => Promise<boolean>; busy: boolean; blocked: boolean
}) {
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [rationale, setRationale] = useState('')
  const [verdict, setVerdict] = useState<'pass' | 'revise'>('pass')
  const [baseline, setBaseline] = useState({ left: '', right: '', rationale: '', verdict: 'pass' as 'pass' | 'revise' })
  const selectedLeft = frames.find(frame => frame.id === left && frame.current)
  const selectedRight = frames.find(frame => frame.id === right && frame.current)
  const save = async () => {
    if (!selectedLeft || !selectedRight || !rationale.trim()) return false
    const ok = await onReview(left, right, verdict, rationale)
    if (ok) setBaseline({ left, right, rationale, verdict })
    return ok
  }
  useWorkspaceDraft({ busy, name: `接缝审查 ${seam.left_item_id} → ${seam.right_item_id}`, dirty: JSON.stringify({ left, right, rationale, verdict }) !== JSON.stringify(baseline), save, discard: () => { setLeft(baseline.left); setRight(baseline.right); setRationale(baseline.rationale); setVerdict(baseline.verdict) } })
  return <WorkspaceWriteBoundary busy={busy}><Card size="small" title={`${seam.left_item_id} → ${seam.right_item_id}`} extra={<Tag color={seam.status === 'pass' ? 'green' : 'orange'}>{seam.status === 'pass' ? '已通过' : seam.status === 'revise' ? '需调整' : '待复核'}</Tag>}>
    <Space direction="vertical" className="w-full">
      {seam.rationale && <Typography.Text>上次结论：{seam.rationale}</Typography.Text>}
      <Space wrap>
        <Select aria-label="前段落幅" placeholder="选择前段实际落幅" style={{ width: 220 }} value={left || undefined} onChange={setLeft} options={frames.filter(frame => frame.current && frame.item_id === seam.left_item_id && frame.edge === 'end').map((frame, i) => ({ value: frame.id, label: `落幅 ${i + 1} · ${frame.at_ms / 1000} 秒` }))} />
        <Select aria-label="后段入幅" placeholder="选择后段实际入幅" style={{ width: 220 }} value={right || undefined} onChange={setRight} options={frames.filter(frame => frame.current && frame.item_id === seam.right_item_id && frame.edge === 'start').map((frame, i) => ({ value: frame.id, label: `入幅 ${i + 1} · ${frame.at_ms / 1000} 秒` }))} />
      </Space>
      <Space wrap>{selectedLeft && <FrameEvidence frame={selectedLeft} />}{selectedRight && <FrameEvidence frame={selectedRight} />}</Space>
      <Input.TextArea aria-label="接缝审查说明" placeholder="查看实际视频和边界帧后，记录朝向、位置、动作或光线的衔接结论" value={rationale} onChange={event => setRationale(event.target.value)} />
      <Space><Select value={verdict} onChange={setVerdict} options={[{ value: 'pass', label: '衔接通过' }, { value: 'revise', label: '需要调整' }]} /><Button loading={busy} disabled={blocked || !selectedLeft || !selectedRight || !rationale.trim()} onClick={() => { void save() }}>保存人工接缝审查</Button></Space>
    </Space>
  </Card></WorkspaceWriteBoundary>
}

/** 以当前确认剪辑为依据查看真实连续性，替换仅提示有关单元与接缝，不自动重拍。 */
export function ContinuityPanel({ projectId, workspace, itemIds }: { projectId: string; workspace: WorkspaceRead; itemIds?: string[] }) {
  const sequenceId = workspace.sequence.id
  const [search, setSearch] = useSearchParams()
  const [state, setState] = useState<ContinuityRead>()
  const [pending, setPending] = useState<ContinuityRead>()
  const drafts = useWorkspaceDraftStatus()
  const snapshot = useRef({ state, dirty: false })
  snapshot.current = { state, dirty: drafts.names.some(name => name.startsWith('接缝审查 ')) }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 刷新真实证据状态，不覆盖任何正在编辑的计划。 */
  const reload = useCallback(async () => {
    try {
      const response = await StudioDirectingService.directingContinuity({ projectId, sequenceId })
      if (response.data) {
        if (snapshot.current.dirty && JSON.stringify(snapshot.current.state) !== JSON.stringify(response.data)) setPending(response.data)
        else { setState(response.data); setPending(undefined) }
      }
    }
    catch (cause) { setError(directingError(cause)) }
  }, [projectId, sequenceId])
  useEffect(() => { void reload() }, [reload, workspace.cuts])
  const cut = workspace.cuts.find(row => row.id === state?.active_cut_revision_id)
  /** 提取真实采用边界，不触发图片或视频模型调用。 */
  const extract = async (itemId: string, edge: 'start' | 'end') => {
    if (!cut) return
    setBusy(true); setError('')
    try { await StudioDirectingService.directingCutFrame({ projectId, sequenceId, requestBody: { cut_revision_id: cut.id, item_id: itemId, edge } }); await reload() }
    catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  /** 保存用户看到的当前采用版本及明确选择的两份实际证据。 */
  const review = async (left: string, right: string, verdict: 'pass' | 'revise', rationale: string) => {
    if (!cut) return false
    if (pending) { setError('连续性依据已更新，请先处理本地修改并载入最新依据。'); return false }
    setBusy(true); setError('')
    try { const response = await StudioDirectingService.directingReviewSeam({ projectId, sequenceId, requestBody: { cut_revision_id: cut.id, left_frame_id: left, right_frame_id: right, verdict, rationale } }); if (!response.data) throw new Error('保存接缝审查未返回结果'); setState(response.data); return true }
    catch (cause) { setError(directingError(cause)); return false } finally { setBusy(false) }
  }
  return <Space data-workspace-target="continuity" tabIndex={-1} direction="vertical" className="w-full">
    {error && <Alert type="error" message={error} />}
    {pending && <Alert type="warning" message="连续性依据已有更新；正在编辑的旧版输入已保留。" action={<Button onClick={() => drafts.transition(() => { setState(pending); setPending(undefined) })}>处理修改并载入最新连续性</Button>} />}
    <Alert type="info" message="先在粗剪中确认实际采用，再提取边界帧并检查接缝。落幅可在拍摄计划中显式绑定为前段依赖；不会自动采用或重拍。" />
    <Space wrap><Button onClick={() => { void reload() }}>刷新连续性状态</Button><Button onClick={() => setSearch(cutDestination(search, { view: 'cut' }))}>返回剪辑工作区</Button></Space>
    {state && <Typography.Text>接缝需处理 {state.seams.filter(row => row.status !== 'pass').length} 项 · 依赖待复核 {state.units.filter(row => row.status !== 'ready').length} 项；只处理受影响项，不要求全场重拍。</Typography.Text>}
    {!state && <Typography.Text>正在读取实际采用依据…</Typography.Text>}
    {state && !state.active_cut_revision_id && <Typography.Text>尚无已确认采用版本。预演卡不能作为实际连续性证据。</Typography.Text>}
    {state?.active_cut_revision_id && !cut && <Alert type="warning" message="采用版本已变化，请使用顶部“刷新状态”载入当前剪辑。" />}
    {cut && <Typography.Text>{pending ? '当前编辑依据（已有更新）' : '当前采用版本'}：{cut.id} · 草稿编辑不改变此依据</Typography.Text>}
    {cut?.content.items.map((item, index) => {
      if (itemIds && !itemIds.includes(item.id)) return null
      if (!('take_id' in item)) return <Typography.Text key={item.id} type="secondary">片段 {index + 1} 为预演，不提供实际证据</Typography.Text>
      const take = workspace.takes.find(row => row.id === item.take_id)
      return <Card key={item.id} size="small" title={`实际片段 ${index + 1} · ${item.id}`}>
        <Space direction="vertical" className="w-full">
          <Typography.Text>{take ? takeAction(workspace, take.id) : '素材缺失'}</Typography.Text><Button onClick={() => setSearch(cutDestination(search, { view: 'cut', cut: cut.id, item: item.id, take: take?.id, returnView: 'continuity' }))}>定位并调整片段 {index + 1}</Button>
          <Typography.Text>采用区间：{item.media_range.source_in_ms / 1000}–{item.media_range.source_out_ms / 1000} 秒</Typography.Text>
          {take && <video controls preload="metadata" style={{ maxWidth: '100%', width: 360 }} src={`${buildFileDownloadUrl(take.file_id)}#t=${item.media_range.source_in_ms / 1000},${item.media_range.source_out_ms / 1000}`} />}
          <Space><Button disabled={busy || !!pending} onClick={() => { void extract(item.id, 'start') }}>提取实际入幅</Button><Button disabled={busy || !!pending} onClick={() => { void extract(item.id, 'end') }}>提取实际落幅</Button></Space>
          <Space wrap>{state?.frames.filter(frame => frame.current && frame.item_id === item.id).map(frame => <FrameEvidence key={frame.id} frame={frame} />)}</Space>
        </Space>
      </Card>
    })}
    <Typography.Title level={5}>实际相邻接缝</Typography.Title>
    {!state?.seams.length && <Typography.Text type="secondary">没有直接相接的两个真实片段；预演和时间线空白不作为接缝。</Typography.Text>}
    {state?.seams.map(seam => <div key={`${state.active_cut_revision_id}:${seam.left_item_id}:${seam.right_item_id}`} hidden={!!itemIds && (itemIds[0] !== seam.left_item_id || itemIds[1] !== seam.right_item_id)}><SeamEditor seam={seam} frames={state.frames} onReview={review} busy={busy} blocked={!!pending} /></div>)}
    <Typography.Title level={5}>依赖与替换影响</Typography.Title>
    {!state?.units.length && <Typography.Text type="secondary">尚未声明前段落幅依赖。</Typography.Text>}
    {state?.units.map(unit => <Alert key={`${unit.plan_revision_id}:${unit.unit_id}`} type={unit.status === 'ready' ? 'success' : 'warning'} message={`计划 ${unit.plan_revision_id} · 单元 ${unit.unit_id} · ${unit.status === 'ready' ? '实际依据有效' : '待复核，不能提交'}`} description={<Space direction="vertical"><span>{unit.errors.join('；')}</span><Button onClick={() => setSearch(cutDestination(search, { view: 'shoot', plan: unit.plan_revision_id, unit: unit.unit_id, returnView: 'continuity' }))}>核对{revisionName(workspace.plans, unit.plan_revision_id, '计划')}中的此单元</Button></Space>} />)}
    {!!state?.frames.some(frame => !frame.current) && <Typography.Text type="secondary">历史提帧仍保留；采用片段或区间已变化的证据不能继续用于提交。</Typography.Text>}
  </Space>
}
