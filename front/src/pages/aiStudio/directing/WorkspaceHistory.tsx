import { useState } from 'react'
import { Alert, Button, Card, Drawer, Empty, Select, Space, Table, Tabs, Tag, Typography } from 'antd'
import { revisionDifferences } from './revisionDiff'
import { designLabels } from './designLabels'
import { DesignEditor } from './DesignEditor'
import { PlanEditor } from './PlanEditor'
import type { PlannedCutItem, SequenceCut_Input, WorkspaceRead } from '../../../services/generated'
import { candidateName, cutStatus, revisionName, revisionReferences, type ActiveCutState } from './workspaceUsage'
import { orderedWorkspaceVersions, selectWorkspaceVersion, workspaceRevisionBelongs, workspaceVersionEditErrors, type WorkspaceVersionKind, type WorkspaceVersionsSelection } from './workspaceVersions'

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

export function ActiveCutSummary({ active, workspace }: { active: ActiveCutState; workspace: WorkspaceRead }) {
  if (active.status !== 'ready') return <Alert type={active.status === 'error' ? 'warning' : 'info'} message={active.status === 'error' ? '采用状态暂不可用，请刷新状态重试。' : '正在核对当前采用…'} />
  return <Card size="small" title={active.cut ? `当前采用：${revisionName(workspace.cuts, active.cut.id, '剪辑')} · 已确认` : '当前采用'}>
    {active.cut ? <>
      <Typography.Text>真实素材 {active.cut.content.items.filter(item => 'media_range' in item).length} 项 · 预演 {active.cut.content.items.filter(item => 'design_revision_id' in item).length} 项</Typography.Text>
      <details><summary>查看采用区间与预演</summary><CutItems cut={active.cut.content} workspace={workspace} /></details>
    </> : <Typography.Text>尚未确认采用剪辑；候选素材和草稿不代表当前采用。</Typography.Text>}
  </Card>
}

type Revision = WorkspaceRead['designs'][number] | WorkspaceRead['plans'][number] | WorkspaceRead['cuts'][number]
const labels = { design: '设计', plan: '计划', cut: '剪辑' }
const createdTime = (value?: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未提供'

/** 只读版本浏览与编辑基线分离；只有显式行操作才交给页面执行草稿保护。 */
export function WorkspaceHistory({ open, onClose, workspace, active, embedded = false, initialSelection, initialKind = 'design', selection, onEdit }: {
  embedded?: boolean; initialSelection?: { kind: WorkspaceVersionKind; revisionId: string }; initialKind?: WorkspaceVersionKind
  open: boolean; onClose: () => void; workspace: WorkspaceRead; active: ActiveCutState
  selection?: WorkspaceVersionsSelection; onEdit?: (next: WorkspaceVersionsSelection, kind: WorkspaceVersionKind) => void
}) {
  const [kind, setKind] = useState<WorkspaceVersionKind>(initialSelection?.kind || initialKind)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<React.Key[]>([])
  const [filter, setFilter] = useState<string>()
  const [viewId, setViewId] = useState(initialSelection?.revisionId)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const [unitId, setUnitId] = useState<string>()
  const records: Revision[] = kind === 'design' ? workspace.designs : kind === 'plan' ? workspace.plans : workspace.cuts
  const name = (id: string) => revisionName(records, id, labels[kind])
  const editable = !!onEdit && !!selection && workspace.sequence.is_current !== false
  const visible = orderedWorkspaceVersions(records).filter(row => kind !== 'plan' || !filter || workspace.plans.find(plan => plan.id === row.id)?.content.design_revision_id === filter)
  const after = records.find(row => row.id === viewId && workspaceRevisionBelongs(workspace, row))
  const beforeCompare = records.find(row => row.id === compareIds[0] && workspaceRevisionBelongs(workspace, row))
  const afterCompare = records.find(row => row.id === compareIds[1] && workspaceRevisionBelongs(workspace, row))
  const changes = beforeCompare && afterCompare ? revisionDifferences(beforeCompare.content, afterCompare.content) : []
  const display = (value: unknown): string => value === undefined ? '—' : value === null ? '空值' : typeof value === 'string' ? ({ unset: '未填写', unknown: '待确定', proposal: '设计建议', fact: '已知事实', none: '明确没有', not_applicable: '不适用' } as Record<string, string>)[value] || value : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
  const editErrors = (id: string | null) => selection ? workspaceVersionEditErrors(workspace, selectWorkspaceVersion(workspace, selection, kind, id), kind) : []
  const edit = (id: string | null) => { if (editable && !editErrors(id).length) onEdit!(selectWorkspaceVersion(workspace, selection!, kind, id), kind) }
  const switchKind = (value: string) => { setKind(value as WorkspaceVersionKind); setPage(1); setExpanded([]); setViewId(undefined); setCompareIds([]); setComparing(false); setFilter(undefined); setUnitId(undefined) }
  const source = (row: Revision) => {
    if (!workspaceRevisionBelongs(workspace, row)) return '版本不属于本场'
    if (kind === 'plan') {
      const plan = workspace.plans.find(item => item.id === row.id)!
      return `固定设计：${revisionName(workspace.designs, plan.content.design_revision_id, '设计')}`
    }
    if (kind === 'cut') {
      const cut = workspace.cuts.find(item => item.id === row.id)!
      const sources = [...new Set(cut.content.items.map(item => {
        if ('take_id' in item) {
          const take = workspace.takes.find(take => take.id === item.take_id)
          return take ? revisionName(workspace.plans, take.plan_revision_id, '计划') : '素材来源不可用'
        }
        return `预演 · ${revisionName(workspace.designs, item.design_revision_id, '设计')}`
      }))]
      return `素材依据：${sources.join('、') || '尚无片段'}`
    }
    return row.parent_id ? `派生自：${name(row.parent_id)}` : '未记录派生来源'
  }
  const details = (row: Revision) => !workspaceRevisionBelongs(workspace, row) ? <Alert type="warning" message="版本不属于本场，无法查看依据" /> : <div className="workspace-version-detail">
    <p>{labels[kind]}创建时间：{createdTime(row.created_at)} · 修订 {row.version}</p>
    <p>版本身份：{row.id}</p>
    {row.parent_id && <p>{labels[kind]}派生自：{name(row.parent_id)}</p>}
    {kind !== 'design' && <p>{source(row)}</p>}
    {kind === 'design' && !row.parent_id && <p>未记录派生来源</p>}
    {kind !== 'cut' ? <p>引用：{revisionReferences(workspace, active, kind, row.id).join('；') || '暂无引用'}</p> : (() => {
      const cut = workspace.cuts.find(item => item.id === row.id)!
      const previews = cut.content.items.filter((item): item is PlannedCutItem => 'estimated_duration_ms' in item)
      return <><p>{cutStatus(cut, active)}</p><CutItems cut={cut.content} workspace={workspace} />{!!previews.length && <p>预演预计共 {previews.reduce((sum, item) => sum + item.estimated_duration_ms, 0) / 1000} 秒，不能代表真实素材覆盖。</p>}</>
    })()}
    {editable && editErrors(row.id).map(error => <Alert key={error} type="warning" message={error} />)}
  </div>
  const actions = (row: Revision) => <Space wrap size={4}>
    <Button size="small" onClick={() => { setViewId(row.id); setUnitId(undefined) }}>查看版本</Button>
    <Button size="small" disabled={compareIds.length === 2 && !compareIds.includes(row.id)} onClick={() => setCompareIds(ids => ids.includes(row.id) ? ids.filter(id => id !== row.id) : [...ids, row.id])}>{compareIds.includes(row.id) ? '移出比较' : '加入比较'}</Button>
    {editable && <Button size="small" disabled={!!editErrors(row.id).length} title={editErrors(row.id).join('；')} onClick={() => edit(row.id)}>{row.confirmed_at ? '基于此版本编辑' : '继续编辑草稿'}</Button>}
  </Space>
  const content = <div className="workspace-history">
    <Tabs activeKey={kind} onChange={switchKind} items={[{ key: 'design', label: '设计版本' }, { key: 'plan', label: '生产计划版本' }, { key: 'cut', label: '剪辑版本' }]} />
    <p className="design-secondary">查看与比较不切换编辑基线或当前采用。草稿仅保留最新保存修订；已确认版本修改后保存为新版本。</p>
    {viewId || comparing ? <>
      <Button onClick={() => { setViewId(undefined); setComparing(false) }}>返回版本列表</Button>
      {comparing ? !beforeCompare || !afterCompare ? <Alert type="warning" message="比较版本暂不可用，请返回列表重新选择" /> : <>
        <h3>{name(beforeCompare.id)} → {name(afterCompare.id)}</h3><p>{changes.length} 项变化 · 含来源、Note 状态与顺序</p>
        {!changes.length && <Empty description="两个版本内容相同" />}
        <div className="revision-differences">{changes.map((change, index) => <section key={index}><h3><Tag color={change.kind === 'added' ? 'green' : change.kind === 'removed' ? 'red' : 'blue'}>{change.kind === 'added' ? '新增' : change.kind === 'removed' ? '移除' : '修改'}</Tag>{change.path.split('.').map(part => designLabels[part] || part).join(' / ')}</h3><div><pre>{display(change.before)}</pre><pre>{display(change.after)}</pre></div></section>)}</div>
      </> : !after ? <Alert type="warning" message="指定的历史版本不存在或不属于本场次，请选择可用版本。" /> : <>
        <h3>{name(after.id)} · {after.confirmed_at ? '已确认' : '草稿'}</h3>{details(after)}
        {kind === 'design' ? <div className="workspace-version-design"><DesignEditor active={false} key={after.id} revisionId={after.id} value={workspace.designs.find(row => row.id === after.id)!.content} onChange={() => {}} disabled /></div> : kind === 'plan' ? (() => {
          const plan = workspace.plans.find(row => row.id === after.id)!
          const design = workspace.designs.find(row => row.id === plan.content.design_revision_id && workspaceRevisionBelongs(workspace, row))
          return design ? <><Select aria-label="查看计划单元" value={plan.content.units.find(unit => unit.id === unitId)?.id || plan.content.units[0]?.id} onChange={setUnitId} options={plan.content.units.map((unit, index) => ({ value: unit.id, label: `单元 ${index + 1} · ${unit.id}` }))} /><PlanEditor projectId={workspace.sequence.project_id} workspace={workspace} planId={plan.id} selectedUnitId={unitId} design={design.content} value={plan.content} onChange={() => {}} disabled /></> : <Alert type="warning" message="此计划的固定设计暂不可用，当前设计不会代替历史依据" />
        })() : null}
      </>}
    </> : <>
      <Space className="workspace-version-tools" wrap>
        {kind === 'plan' && <Select aria-label="按固定设计筛选" allowClear placeholder="全部设计的计划" value={filter} onChange={id => { setFilter(id); setPage(1) }} options={workspace.designs.map(row => ({ value: row.id, label: revisionName(workspace.designs, row.id, '设计') }))} />}
        {editable && kind === 'cut' && <Button onClick={() => edit(null)}>新剪辑草稿</Button>}
        {!!compareIds.length && <><span>待比较：{compareIds.map(name).join(' → ')}</span><Button disabled={compareIds.length !== 2} onClick={() => setComparing(true)}>比较所选版本</Button><Button onClick={() => setCompareIds([])}>清空比较</Button></>}
      </Space>
      <Table<Revision> className="workspace-version-table" size="small" rowKey="id" dataSource={visible} locale={{ emptyText: filter ? '此设计暂无计划' : '暂无版本' }}
        pagination={{ current: page, pageSize: 10, total: visible.length, showSizeChanger: false, onChange: setPage }}
        expandable={{ expandedRowKeys: expanded, onExpandedRowsChange: keys => setExpanded([...keys]), expandedRowRender: details, columnTitle: '依据', columnWidth: 44 }}
        columns={[
          { title: '版本', render: (_, row) => <Space wrap size={0}><strong>{name(row.id)}</strong>{selection?.[kind] === row.id && <Tag color="blue">编辑基线</Tag>}</Space> },
          { title: '状态', render: (_, row) => <Space wrap size={0}><Tag>{row.confirmed_at ? '已确认' : '草稿'}</Tag>{kind === 'cut' && active.status === 'ready' && active.cut?.id === row.id && <Tag color="green">当前采用</Tag>}</Space> },
          { title: '创建时间', responsive: ['lg'], render: (_, row) => createdTime(row.created_at) },
          { title: '依据／来源', responsive: ['md'], render: (_, row) => source(row) },
          { title: '操作', render: (_, row) => actions(row) },
        ]} />
    </>}
  </div>
  return embedded ? content : <Drawer title="版本与历史（只读）" open={open} onClose={onClose} width={960}>{content}</Drawer>
}
