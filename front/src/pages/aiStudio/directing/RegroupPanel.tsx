import { useState } from 'react'
import { Alert, Button, Card, Select, Space, Typography } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { WorkspaceRead } from '../../../services/generated'
import { directingError } from './common'

/** 对已确认范围执行显式重组，服务端派生新计划并保留其他单元。 */
export function RegroupPanel({ projectId, sequenceId, plan, disabled, onChange }: {
  projectId: string; sequenceId: string; plan: WorkspaceRead['plans'][number]; disabled: boolean; onChange: (value: WorkspaceRead) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 统一请求服务端重组，不在页面自行猜测依赖或丢弃不一致的参考。 */
  const regroup = async (operation: 'split' | 'merge') => {
    setBusy(true); setError('')
    try {
      const response = await StudioDirectingService.directingRegroupUnits({ projectId, sequenceId, requestBody: { plan_revision_id: plan.id, unit_ids: selected, operation } })
      if (response.data) onChange(response.data)
    } catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  return <Card size="small" title="重组已确认单元">
    <Space direction="vertical" className="w-full">
      {error && <Alert type="error" message={error} />}
      <Typography.Text type="secondary">重组会生成新计划草稿；需要重新确认、编译和审稿。组合要求模型、画幅、参数和参考一致，多镜范围不表示模型支持多镜执行。</Typography.Text>
      {disabled && <Typography.Text type="warning">请先保存并确认当前计划，或载入已确认版本。</Typography.Text>}
      <Select mode="multiple" aria-label="重组单元" disabled={disabled || busy} className="w-full" value={selected} options={plan.content.units.map((unit, index) => ({ value: unit.id, label: `单元 ${index + 1} · ${unit.coverage.map(item => item.action_scope).join('；')}` }))} onChange={setSelected} />
      <Space wrap><Button disabled={disabled || !selected.length} loading={busy} onClick={() => { void regroup('split') }}>按镜头拆为新计划</Button><Button disabled={disabled || selected.length < 2} loading={busy} onClick={() => { void regroup('merge') }}>组合为新计划</Button></Space>
    </Space>
  </Card>
}
