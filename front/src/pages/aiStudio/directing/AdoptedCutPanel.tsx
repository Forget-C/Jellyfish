import { useEffect, useState } from 'react'
import { Alert, Button, Card, Space, Typography } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { ContinuityRead, WorkspaceRead } from '../../../services/generated'
import type { ActiveCutState } from './workspaceUsage'
import { candidateName, revisionName } from './workspaceUsage'
import { takeAction } from './workspaceCut'

/** 侧区只读取服务端确认采用；编辑草稿、审片与选区均不能更新这里的依据。 */
export function AdoptedCutPanel({ projectId, workspace, active, onOpen }: {
  projectId: string; workspace: WorkspaceRead; active: ActiveCutState;
  onOpen: (view: string, item?: string, take?: string) => void
}) {
  const cut = active.status === 'ready' ? active.cut : undefined
  const [result, setResult] = useState<{ workspace: WorkspaceRead; cutId: string; continuity?: ContinuityRead }>()
  useEffect(() => {
    if (!cut) return
    let cancelled = false
    void StudioDirectingService.directingContinuity({ projectId, sequenceId: workspace.sequence.id }).then(response => {
      if (!cancelled) setResult({ workspace, cutId: cut.id, continuity: response.data?.active_cut_revision_id === cut.id ? response.data : undefined })
    }).catch(() => { if (!cancelled) setResult({ workspace, cutId: cut.id }) })
    return () => { cancelled = true }
  }, [projectId, workspace, cut])
  const continuity = result?.workspace === workspace && result.cutId === cut?.id ? result.continuity : undefined
  const feedback = active.status === 'ready' ? active.feedback : undefined
  const review = feedback?.reviews.find(row => row.id === feedback.current_review_id && row.confirmed_at && row.content.cut_revision_id === cut?.id)
  return <Card role="region" aria-label="已确认采用侧区" title="当前采用的粗剪" className="self-start min-w-0">
    <Space direction="vertical" style={{ width: '100%' }}>
      {active.status !== 'ready' ? <Alert type="info" message="采用依据待核对，暂不展示确定结论。" /> : !cut ? <Typography.Text>尚无确认采用；左侧选择只会进入剪辑草稿。</Typography.Text> : <>
        <Typography.Text strong>{revisionName(workspace.cuts, cut.id, '剪辑')} · 已确认采用</Typography.Text>
        {cut.content.items.map((item, index) => <div key={item.id} style={{ width: '100%', padding: '8px 0', borderBottom: '1px solid #e5e7eb' }}>
          <Typography.Text strong>采用片段 {index + 1} · {'media_range' in item ? '真实区间' : '预演待替换'}</Typography.Text>
          {'media_range' in item ? <><p>{takeAction(workspace, item.take_id)} · {candidateName(workspace, item.take_id, true)}</p><p>源区间 {(item.media_range.source_in_ms / 1000).toFixed(3)}–{(item.media_range.source_out_ms / 1000).toFixed(3)} 秒</p><Button size="small" onClick={() => onOpen('cut', item.id, item.take_id)}>查看采用片段 {index + 1}</Button></> : <p>预计 {item.estimated_duration_ms / 1000} 秒，不计作真实素材覆盖。</p>}
        </div>)}
        <Typography.Text>画面：{review ? review.content.verdict === 'pass' ? '已验收通过' : '需要调整' : '尚无当前版本的确认验收'}</Typography.Text>
        <Typography.Text>声音：{review ? ({ pending_postproduction: '待后期', reviewed: '已实际审听', not_applicable: '不适用' }[review.content.sound_status]) : '待核对'}</Typography.Text>
        {continuity ? <Typography.Text>接缝待处理 {continuity.seams.filter(row => row.status !== 'pass').length} 项 · 依赖待复核 {continuity.units.filter(row => row.status !== 'ready').length} 项</Typography.Text> : <Typography.Text type="secondary">衔接与依赖状态待核对，可进入连续性页面检查。</Typography.Text>}
        <Button onClick={() => onOpen('continuity')}>检查接缝与替换影响</Button>
        <Button onClick={() => onOpen('feedback')}>整场验收与局部返工</Button>
      </>}
      <Button onClick={() => onOpen('ledger')}>查看完整来源与记录</Button>
    </Space>
  </Card>
}
