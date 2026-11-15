import { Space, Tag, Typography } from 'antd'
import type { SequenceCut_Input, WorkspaceRead } from '../../../services/generated'
import { candidateName, revisionName } from './workspaceUsage'

/** 只读片段清单：逐项呈现实际源区间，预演单独标明预计时长。 */
export function CutItems({ cut, workspace }: { cut: SequenceCut_Input; workspace: WorkspaceRead }) {
  return <Space direction="vertical" className="w-full">
    {!cut.items.length && <Typography.Text type="secondary">没有剪辑项</Typography.Text>}
    {cut.items.map((item, index) => <div key={item.id}>
      {'media_range' in item ? <>片段 {index + 1} · {candidateName(workspace, item.take_id, true)} · 源区间 {(item.media_range.source_in_ms / 1000).toFixed(3)}–{(item.media_range.source_out_ms / 1000).toFixed(3)} 秒</>
        : <>片段 {index + 1} · <Tag>预演</Tag>{revisionName(workspace.designs, item.design_revision_id, '设计')} / {item.shot_id} · 预计 {item.estimated_duration_ms / 1000} 秒</>}
    </div>)}
  </Space>
}
