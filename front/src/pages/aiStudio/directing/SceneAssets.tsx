import { useWorkspacePreparation } from './useWorkspacePreparation'
import { useEffect, useState } from 'react'
import { Alert, Button, Card, Input, Modal, Select, Space, Typography } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { AssetSummary, AssetCreateRequest, SceneDesign_Input } from '../../../services/generated'
import { directingError } from './common'

const kinds = [{ value: 'character', label: '角色' }, { value: 'scene', label: '场所' }, { value: 'prop', label: '道具' }]

/** 设计中的资产关联只保存身份，本场表演和状态仍由六岗工作单维护。 */
export function SceneAssets({ projectId, sequenceId, design, onChange }: {
  projectId: string; sequenceId: string; design: SceneDesign_Input; onChange: (design: SceneDesign_Input) => void
}) {
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [creating, setCreating] = useState(false)
  const preparation = useWorkspacePreparation('新资产准备', `${projectId}:${sequenceId}:asset`, { kind: 'character' as AssetCreateRequest['kind'], name: '', description: '' })
  const input = preparation.value
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void StudioDirectingService.directingAssets({ projectId }).then(response => setAssets(response.data || [])).catch(cause => setError(directingError(cause)))
  }, [projectId])
  /** 资产类型选项只来自当前项目的服务端列表。 */
  const options = (kind: string) => assets.filter(asset => asset.kind === kind).map(asset => ({ value: asset.id, label: asset.name }))
  return <Card title="本场所需资产" extra={<Button onClick={() => setCreating(true)}>按需创建资产</Button>}>
    <Space direction="vertical" className="w-full">
      {error && <Alert type="error" message={error} />}
      <Typography.Text type="secondary">仅关联本场需要的角色、场所和道具。动作、情绪、道具前后状态请写在导演设计中，不修改全局资产。</Typography.Text>
      <Select aria-label="本场场所资产" allowClear placeholder="关联场所" className="w-full" options={options('scene')} value={design.direction.location_asset_id} onChange={id => onChange({ ...design, direction: { ...design.direction, location_asset_id: id || null } })} />
      {design.participants.map(person => <Space key={person.id} wrap>
        <Typography.Text>{person.name}</Typography.Text>
        {(['character', 'prop'] as const).map(kind => <Select key={kind} aria-label={`${person.name}${kind === 'character' ? '角色' : '道具'}关联`} allowClear placeholder={kind === 'character' ? '关联角色' : '关联道具'} className="min-w-64" options={options(kind)} value={kind === 'character' ? person.character_id : person.prop_id} onChange={id => onChange({ ...design, participants: design.participants.map(row => row.id === person.id ? { ...row, [kind + '_id']: id || null } : row) })} />)}
      </Space>)}
    </Space>
    <Modal title="创建跨场复用资产" open={creating} confirmLoading={busy} onCancel={() => setCreating(false)} onOk={async () => {
      setBusy(true); setError('')
      try { const response = await StudioDirectingService.directingCreateAsset({ projectId, sequenceId, requestBody: input }); setAssets(response.data || []); setCreating(false); preparation.update({ kind: 'character', name: '', description: '' }) }
      catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
    }}>
      {preparation.error && <Alert type="warning" message={preparation.error} />}
      <Typography.Paragraph type="secondary">输入自动暂存在本浏览器会话，确认创建后才写入项目资产。</Typography.Paragraph>
      <Space direction="vertical" className="w-full"><Select aria-label="新资产类型" value={input.kind} options={kinds} onChange={kind => preparation.update({ kind })} />
        <Input aria-label="新资产名称" placeholder="资产名称" value={input.name} onChange={event => preparation.update({ name: event.target.value })} />
        <Input.TextArea aria-label="资产稳定设定" placeholder="只填写跨场稳定设定，不填写本场动作或临时状态" value={input.description} onChange={event => preparation.update({ description: event.target.value })} /></Space>
    </Modal>
  </Card>
}
