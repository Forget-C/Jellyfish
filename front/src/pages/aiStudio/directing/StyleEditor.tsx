import { useWorkspaceDraft, WorkspaceWriteBoundary } from './WorkspaceDrafts'
import { useEffect, useState } from 'react'
import { Alert, Button, Card, Input, Select, Space, Typography } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { ProjectStyleProfile_Input, ProjectStyleRevision, StyleRule_Input } from '../../../services/generated'
import { directingError, humanNote } from './common'

const roles = [{ value: 'direction', label: '总导演' }, { value: 'performance', label: '表演' }, { value: 'staging', label: '镜内执行' }, { value: 'cinematography', label: '摄影' }, { value: 'continuity', label: '连续性' }, { value: 'prompt', label: '提示词' }]

/** 项目风格候选的编辑、显式确认与设计绑定，保存不会自动更换设计依据。 */
export function StyleEditor({ projectId, sequenceId, value, onChange }: {
  projectId: string; sequenceId: string; value?: string | null; onChange: (id: string | null) => void
}) {
  const [rows, setRows] = useState<ProjectStyleRevision[]>([])
  const [base, setBase] = useState<ProjectStyleRevision>()
  const [draft, setDraft] = useState<ProjectStyleProfile_Input>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void StudioDirectingService.directingStyles({ projectId }).then(response => setRows(response.data || [])).catch(cause => setError(directingError(cause)))
  }, [projectId])
  /** 局部编辑规则时保留稳定身份与其他规则。 */
  const patch = (id: string, changes: Partial<StyleRule_Input>) => {
    if (draft) setDraft({ ...draft, rules: draft.rules.map(rule => rule.id === id ? { ...rule, ...changes } : rule) })
  }
  /** 保存完整快照，已确认版本自动派生而不是覆盖。 */
  const save = async () => {
    if (!draft) return false
    setBusy(true); setError('')
    try {
      const response = await StudioDirectingService.directingSaveStyle({ projectId, requestBody: {
        content: draft, ...(base?.confirmed_at ? { parent_id: base.id } : base ? { revision_id: base.id, expected_version: base.version } : {}),
      } })
      const nextRows = response.data || []
      const next = base && !base.confirmed_at ? nextRows.find(row => row.id === base.id) : nextRows[nextRows.length - 1]
      if (!next) throw new Error('保存风格未返回有效版本')
      setRows(nextRows); setBase(next); setDraft(next.content); return true
    } catch (cause) { setError(directingError(cause)); return false } finally { setBusy(false) }
  }
  const guard = useWorkspaceDraft({ busy, name: '项目风格', dirty: !!draft && JSON.stringify(draft) !== JSON.stringify(base?.content), save, discard: () => setDraft(base?.content ? structuredClone(base.content) : undefined) })
  return <WorkspaceWriteBoundary busy={busy}><Card title="项目风格与适用规则">
    <Space direction="vertical" className="w-full">
      {error && <Alert type="error" message={error} />}
      <Select aria-label="本设计风格依据" allowClear placeholder="本设计不绑定项目风格" className="w-full" value={value} options={rows.filter(row => row.confirmed_at).map(row => ({ value: row.id, label: `${row.content.title} · v${row.version}` }))} onChange={id => onChange(id || null)} />
      <Typography.Text type="secondary">只启用已确认版本中状态为“启用”且范围匹配的规则。候选、弃用规则不会影响生成；修改依据后须保存新设计。</Typography.Text>
      <Space wrap><Select aria-label="编辑风格版本" placeholder="选择版本查看或派生" className="min-w-64" value={base?.id} options={rows.map(row => ({ value: row.id, label: `${row.content.title} · ${row.confirmed_at ? '已确认' : '草稿'} v${row.version}` }))} onChange={id => guard(() => { const row = rows.find(item => item.id === id); setBase(row); setDraft(row?.content) })} />
        <Button onClick={() => guard(() => { setBase(undefined); setDraft({ title: '项目风格', rules: [], sources: humanNote('人工整理').sources || [] }) })}>新建风格候选</Button></Space>
      {draft && <><Input aria-label="风格标题" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
        {draft.rules.map(rule => <Card key={rule.id} size="small" title={roles.find(role => role.value === rule.role)?.label} extra={<Button danger onClick={() => setDraft({ ...draft, rules: draft.rules.filter(row => row.id !== rule.id) })}>移除规则</Button>}>
          <Space direction="vertical" className="w-full">
            <Space wrap><Select aria-label="规则负责部门" options={roles} value={rule.role} onChange={role => patch(rule.id, { role })} />
              <Select aria-label="规则状态" value={rule.status} options={[{ value: 'candidate', label: '候选' }, { value: 'confirmed', label: '启用（版本确认后生效）' }, { value: 'deprecated', label: '弃用' }]} onChange={status => patch(rule.id, { status })} /></Space>
            <Input.TextArea aria-label="可观察规则" placeholder="写出可观察的要求" value={rule.requirement} onChange={event => patch(rule.id, { requirement: event.target.value })} />
            <Input.TextArea aria-label="规则例外" placeholder="适用例外（可留空）" value={rule.exceptions?.text || rule.exceptions?.reason || ''} onChange={event => patch(rule.id, { exceptions: event.target.value ? humanNote(event.target.value) : { state: 'unset' } })} />
            <Select mode="multiple" aria-label="规则适用场次" placeholder="留空适用于全项目" className="w-full" value={rule.sequence_ids} options={[...new Set([sequenceId, ...(rule.sequence_ids || [])])].map(id => ({ value: id, label: id === sequenceId ? '当前场次' : id }))} onChange={sequence_ids => patch(rule.id, { sequence_ids })} />
            <Select mode="tags" aria-label="规则适用模型" placeholder="限定模型名称；留空适用于所有模型" className="w-full" value={rule.model_names} onChange={model_names => patch(rule.id, { model_names })} />
            <Typography.Text type="secondary">来源：{rule.sources.map(source => `${source.kind} · ${source.reference} · ${source.version}`).join('；')}</Typography.Text>
            <Input aria-label="规则来源说明" placeholder="填写反馈、会议或审片依据，保存为人工来源" onBlur={event => { if (event.target.value.trim()) patch(rule.id, { sources: humanNote(event.target.value).sources!.map(source => ({ ...source, reference: event.target.value })) }) }} />
          </Space>
        </Card>)}
        <Space wrap><Button onClick={() => setDraft({ ...draft, rules: [...draft.rules, { id: 'rule-' + crypto.randomUUID().slice(0, 8), role: 'direction', requirement: '', status: 'candidate', exceptions: { state: 'unset' }, sequence_ids: [], model_names: [], sources: humanNote('人工建议').sources || [] }] })}>添加规则</Button>
          <Button loading={busy} onClick={save}>{base?.confirmed_at ? '保存为新风格版本' : '保存风格草稿'}</Button>
          <Button disabled={!base || !!base.confirmed_at || JSON.stringify(base.content) !== JSON.stringify(draft)} loading={busy} onClick={async () => {
            if (!base) return
            setBusy(true); setError('')
            try { const response = await StudioDirectingService.directingConfirmStyle({ projectId, revisionId: base.id, requestBody: { expected_version: base.version } }); const nextRows = response.data || []; const next = nextRows.find(row => row.id === base.id); setRows(nextRows); setBase(next); setDraft(next?.content) }
            catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
          }}>确认此风格版本</Button></Space>
      </>}
    </Space>
  </Card></WorkspaceWriteBoundary>
}
