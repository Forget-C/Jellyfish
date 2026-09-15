import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Image, Input, Select, Space, Tag, Typography } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { ContinuityRead, CutFrameRead, SeamRead, WorkspaceRead } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { directingError } from './common'

/** 展示实际区间的首尾帧与原视频，明确区分历史证据和当前采用。 */
function FrameEvidence({ frame }: { frame: CutFrameRead }) {
  return <Space direction="vertical"><Image width={160} src={buildFileDownloadUrl(frame.file_id)} /><Typography.Text type="secondary">{frame.edge === 'end' ? '落幅' : '入幅'} · {(frame.at_ms / 1000).toFixed(3)} 秒</Typography.Text></Space>
}

/** 针对当前相邻片段显式选择两张实际边界帧并保存人工结论。 */
function SeamEditor({ seam, frames, onReview, busy }: {
  seam: SeamRead; frames: CutFrameRead[]; onReview: (left: string, right: string, verdict: 'pass' | 'revise', rationale: string) => Promise<void>; busy: boolean
}) {
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [rationale, setRationale] = useState('')
  const [verdict, setVerdict] = useState<'pass' | 'revise'>('pass')
  const selectedLeft = frames.find(frame => frame.id === left && frame.current)
  const selectedRight = frames.find(frame => frame.id === right && frame.current)
  return <Card size="small" title={`${seam.left_item_id} → ${seam.right_item_id}`} extra={<Tag color={seam.status === 'pass' ? 'green' : 'orange'}>{seam.status === 'pass' ? '已通过' : seam.status === 'revise' ? '需调整' : '待复核'}</Tag>}>
    <Space direction="vertical" className="w-full">
      {seam.rationale && <Typography.Text>上次结论：{seam.rationale}</Typography.Text>}
      <Space wrap>
        <Select aria-label="前段落幅" placeholder="选择前段实际落幅" style={{ width: 220 }} value={left || undefined} onChange={setLeft} options={frames.filter(frame => frame.current && frame.item_id === seam.left_item_id && frame.edge === 'end').map((frame, i) => ({ value: frame.id, label: `落幅 ${i + 1} · ${frame.at_ms / 1000} 秒` }))} />
        <Select aria-label="后段入幅" placeholder="选择后段实际入幅" style={{ width: 220 }} value={right || undefined} onChange={setRight} options={frames.filter(frame => frame.current && frame.item_id === seam.right_item_id && frame.edge === 'start').map((frame, i) => ({ value: frame.id, label: `入幅 ${i + 1} · ${frame.at_ms / 1000} 秒` }))} />
      </Space>
      <Space wrap>{selectedLeft && <FrameEvidence frame={selectedLeft} />}{selectedRight && <FrameEvidence frame={selectedRight} />}</Space>
      <Input.TextArea aria-label="接缝审查说明" placeholder="查看实际视频和边界帧后，记录朝向、位置、动作或光线的衔接结论" value={rationale} onChange={event => setRationale(event.target.value)} />
      <Space><Select value={verdict} onChange={setVerdict} options={[{ value: 'pass', label: '衔接通过' }, { value: 'revise', label: '需要调整' }]} /><Button loading={busy} disabled={!selectedLeft || !selectedRight || !rationale.trim()} onClick={() => { void onReview(left, right, verdict, rationale) }}>保存人工接缝审查</Button></Space>
    </Space>
  </Card>
}

/** 以当前确认剪辑为依据查看真实连续性，替换仅提示有关单元与接缝，不自动重拍。 */
export function ContinuityPanel({ projectId, workspace }: { projectId: string; workspace: WorkspaceRead }) {
  const sequenceId = workspace.sequence.id
  const [state, setState] = useState<ContinuityRead>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 刷新真实证据状态，不覆盖任何正在编辑的计划。 */
  const reload = useCallback(async () => {
    try { const response = await StudioDirectingService.directingContinuity({ projectId, sequenceId }); if (response.data) setState(response.data) }
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
    if (!cut) return
    setBusy(true); setError('')
    try { const response = await StudioDirectingService.directingReviewSeam({ projectId, sequenceId, requestBody: { cut_revision_id: cut.id, left_frame_id: left, right_frame_id: right, verdict, rationale } }); if (response.data) setState(response.data) }
    catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  return <Space direction="vertical" className="w-full">
    {error && <Alert type="error" message={error} />}
    <Alert type="info" message="先在粗剪中确认实际采用，再提取边界帧并检查接缝。落幅可在拍摄计划中显式绑定为前段依赖；不会自动采用或重拍。" />
    <Button onClick={() => { void reload() }}>刷新连续性状态</Button>
    {!state && <Typography.Text>正在读取实际采用依据…</Typography.Text>}
    {state && !state.active_cut_revision_id && <Typography.Text>尚无已确认采用版本。预演卡不能作为实际连续性证据。</Typography.Text>}
    {state?.active_cut_revision_id && !cut && <Alert type="warning" message="采用版本已变化，请使用顶部“刷新状态”载入当前剪辑。" />}
    {cut && <Typography.Text>当前采用版本：{cut.id} · 草稿编辑不改变此依据</Typography.Text>}
    {cut?.content.items.map((item, index) => {
      if (!('take_id' in item)) return <Typography.Text key={item.id} type="secondary">片段 {index + 1} 为预演，不提供实际证据</Typography.Text>
      const take = workspace.takes.find(row => row.id === item.take_id)
      return <Card key={item.id} size="small" title={`实际片段 ${index + 1} · ${item.id}`}>
        <Space direction="vertical" className="w-full">
          <Typography.Text>采用区间：{item.media_range.source_in_ms / 1000}–{item.media_range.source_out_ms / 1000} 秒</Typography.Text>
          {take && <video controls preload="metadata" style={{ maxWidth: '100%', width: 360 }} src={`${buildFileDownloadUrl(take.file_id)}#t=${item.media_range.source_in_ms / 1000},${item.media_range.source_out_ms / 1000}`} />}
          <Space><Button disabled={busy} onClick={() => { void extract(item.id, 'start') }}>提取实际入幅</Button><Button disabled={busy} onClick={() => { void extract(item.id, 'end') }}>提取实际落幅</Button></Space>
          <Space wrap>{state?.frames.filter(frame => frame.current && frame.item_id === item.id).map(frame => <FrameEvidence key={frame.id} frame={frame} />)}</Space>
        </Space>
      </Card>
    })}
    <Typography.Title level={5}>实际相邻接缝</Typography.Title>
    {!state?.seams.length && <Typography.Text type="secondary">没有直接相接的两个真实片段；预演和时间线空白不作为接缝。</Typography.Text>}
    {state?.seams.map(seam => <SeamEditor key={`${state.active_cut_revision_id}:${seam.left_item_id}:${seam.right_item_id}`} seam={seam} frames={state.frames} onReview={review} busy={busy} />)}
    <Typography.Title level={5}>依赖与替换影响</Typography.Title>
    {!state?.units.length && <Typography.Text type="secondary">尚未声明前段落幅依赖。</Typography.Text>}
    {state?.units.map(unit => <Alert key={`${unit.plan_revision_id}:${unit.unit_id}`} type={unit.status === 'ready' ? 'success' : 'warning'} message={`计划 ${unit.plan_revision_id} · 单元 ${unit.unit_id} · ${unit.status === 'ready' ? '实际依据有效' : '待复核，不能提交'}`} description={unit.errors.join('；')} />)}
    {!!state?.frames.some(frame => !frame.current) && <Typography.Text type="secondary">历史提帧仍保留；采用片段或区间已变化的证据不能继续用于提交。</Typography.Text>}
  </Space>
}
