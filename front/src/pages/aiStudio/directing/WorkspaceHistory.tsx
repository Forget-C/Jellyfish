import { useState } from 'react'
import { Alert, Card, Drawer, Empty, Select, Space, Tabs, Tag, Typography } from 'antd'
import { revisionDifferences } from './revisionDiff'
import { designLabels } from './designLabels'
import { DesignEditor } from './DesignEditor'
import type { SequenceCut_Input, WorkspaceRead } from '../../../services/generated'
import { cutStatus, revisionName, revisionReferences } from './workspaceUsage'
import type { ActiveCutState } from './workspaceUsage'

/** 只读片段清单：逐项呈现实际源区间，预演单独标明预计时长。 */
export function CutItems({ cut, workspace }: { cut: SequenceCut_Input; workspace: WorkspaceRead }) {
  return <Space direction="vertical" className="w-full">
    {!cut.items.length && <Typography.Text type="secondary">没有剪辑项</Typography.Text>}
    {cut.items.map((item, index) => <div key={item.id}>
      {'media_range' in item ? <>片段 {index + 1} · {revisionName(workspace.takes, item.take_id, 'Take')} · 源区间 {(item.media_range.source_in_ms / 1000).toFixed(3)}–{(item.media_range.source_out_ms / 1000).toFixed(3)} 秒</>
        : <>片段 {index + 1} · <Tag>预演</Tag>{revisionName(workspace.designs, item.design_revision_id, '设计')} / {item.shot_id} · 预计 {item.estimated_duration_ms / 1000} 秒</>}
    </div>)}
  </Space>
}

export function ActiveCutSummary({ active, workspace }: { active: ActiveCutState; workspace: WorkspaceRead }) {
  if (active.status !== 'ready') return <Alert type={active.status === 'error' ? 'warning' : 'info'} message={active.status === 'error' ? '采用状态暂不可用，请刷新状态重试。' : '正在核对当前采用…'} />
  return <Card size="small" title={active.cut ? `当前采用：${revisionName(workspace.cuts, active.cut.id, '剪辑')} · 已确认` : '当前采用'}>
    {active.cut ? <>
      <Typography.Text>真实素材 {active.cut.content.items.filter(item => 'media_range' in item).length} 项 · 预演 {active.cut.content.items.filter(item => 'design_revision_id' in item).length} 项</Typography.Text>
      <details><summary>查看采用区间与预演</summary><CutItems cut={active.cut.content} workspace={workspace} /></details>
    </> : <Typography.Text>尚未确认采用剪辑；候选素材和草稿不代表当前采用。</Typography.Text>}
  </Card>
}

/** 历史浏览仅呈现快照和真实引用，不切换编辑基线、不调用任何写入接口。 */
export function WorkspaceHistory({ open, onClose, workspace, active }: { open: boolean; onClose: () => void; workspace: WorkspaceRead; active: ActiveCutState }) {
  const [kind, setKind] = useState('design')
  const [beforeId, setBeforeId] = useState<string>()
  const [afterId, setAfterId] = useState<string>()
  const [mode, setMode] = useState('compare')
  const records = kind === 'design' ? workspace.designs : kind === 'plan' ? workspace.plans : workspace.cuts
  const before = records.find(row => row.id === beforeId)
  const after = records.find(row => row.id === afterId)
  const changes = before && after ? revisionDifferences(before.content, after.content) : []
  const display = (value: unknown): string => value === undefined ? '—' : value === null ? '空值' : typeof value === 'string' ? ({ unset: '未填写', unknown: '待确定', proposal: '设计建议', fact: '已知事实', none: '明确没有', not_applicable: '不适用' } as Record<string, string>)[value] || value : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
  const names = kind === 'design' ? '设计' : kind === 'plan' ? '计划' : '剪辑'
  return <Drawer title="版本与历史（只读）" open={open} onClose={onClose} width={960}>
    <Tabs activeKey={kind} onChange={key => { setKind(key); setBeforeId(undefined); setAfterId(undefined) }} items={[{ key: 'design', label: '设计版本' }, { key: 'plan', label: '生产计划版本' }, { key: 'cut', label: '剪辑版本' }]} />
    <p>浏览快照与比较不会切换编辑基线或当前采用。草稿保存只保留最新修订，不虚构逐次保存历史。</p>
    <Space wrap><Select aria-label="比较基准版本" placeholder="选择基准版本" style={{ width: 220 }} value={beforeId} options={records.map((row, index) => ({ value: row.id, label: `${names} ${index + 1} · ${row.confirmed_at ? '已确认' : '草稿'} · 修订 ${row.version}` }))} onChange={setBeforeId} />
      <span>→</span><Select aria-label="查看或比较的历史版本" placeholder="选择查看版本" style={{ width: 220 }} value={afterId} options={records.map((row, index) => ({ value: row.id, label: `${names} ${index + 1} · ${row.confirmed_at ? '已确认' : '草稿'} · 修订 ${row.version}` }))} onChange={setAfterId} /></Space>
    <Tabs activeKey={mode} onChange={setMode} items={[{ key: 'compare', label: '比较变更' }, { key: 'snapshot', label: '完整快照' }]} />
    {mode === 'compare' ? !before || !after ? <Empty description="选择两个版本，按稳定身份比较增删与字段变化" /> : <><p>{changes.length} 项变化 · 含来源、Note 状态与顺序</p>{!changes.length && <Empty description="两个版本内容相同" />}<div className="revision-differences">{changes.map((change, index) => <section key={index}><h3><Tag color={change.kind === 'added' ? 'green' : change.kind === 'removed' ? 'red' : 'blue'}>{change.kind === 'added' ? '新增' : change.kind === 'removed' ? '移除' : '修改'}</Tag>{change.path.split('.').map(part => designLabels[part] || part).join(' / ')}</h3><div><pre>{display(change.before)}</pre><pre>{display(change.after)}</pre></div></section>)}</div></> : !after ? <Empty description="选择要查看的历史版本" /> : <>
      <p>版本身份：{after.id} · 修订 {after.version}{after.parent_id ? ` · 派生自 ${after.parent_id}` : ''}</p>
      {kind === 'design' ? <div style={{ height: 680 }}><DesignEditor active={false} key={after.id} value={workspace.designs.find(row => row.id === after.id)!.content} onChange={() => {}} disabled /></div> : kind === 'cut' ? <CutItems workspace={workspace} cut={workspace.cuts.find(row => row.id === after.id)!.content} /> : <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(after.content, null, 2)}</pre>}
    </>}
    <details style={{ marginTop: 24 }}><summary>当前采用与版本引用</summary><ActiveCutSummary active={active} workspace={workspace} />{records.map(row => <p key={row.id}>{revisionName(records, row.id, names)} · {kind === 'cut' ? cutStatus(workspace.cuts.find(cut => cut.id === row.id)!, active) : revisionReferences(workspace, active, kind as 'design' | 'plan', row.id).join('；') || '暂无引用'}</p>)}</details>
  </Drawer>
}
