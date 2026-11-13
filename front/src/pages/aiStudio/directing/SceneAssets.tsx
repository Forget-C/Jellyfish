import { useWorkspacePreparation } from './useWorkspacePreparation'
import { Fragment, useCallback, useState } from 'react'
import { Alert, Button, Card, Select, Space, Tag, Typography } from 'antd'
import type { AssetSummary, SceneDesign_Input } from '../../../services/generated'
import { ResourceEditorDrawer } from '../assets/components/ResourceEditorDrawer'
import { buildFileDownloadUrl } from '../assets/utils'
import { sceneAssetSummary } from './sceneAssetSummary'

type Kind = AssetSummary['kind']
type AssetRow = { key: string; name: string; kind?: Kind; id?: string | null; participantId?: string }
const kinds = [{ value: 'character', label: '角色' }, { value: 'scene', label: '场所' }, { value: 'prop', label: '道具' }]
const names = { character: '角色', scene: '场所', prop: '道具' }

/** 本场关联与项目建档分开保存；创建返回精确身份，图片仍由用户明确准备。 */
export function SceneAssets({ projectId, sequenceId, design, onChange, assets, loadError, onRetry, onAssetsChange, confirmed = false, dirty = false }: {
  assets?: AssetSummary[]; loadError: string; onRetry: () => void; onAssetsChange: (assets: AssetSummary[]) => void;
  projectId: string; sequenceId: string; design: SceneDesign_Input; onChange: (design: SceneDesign_Input) => void; confirmed?: boolean; dirty?: boolean;
}) {
  const [creating, setCreating] = useState(false)
  const [input, setInput] = useState({kind: 'character' as Kind, name: '', description: '', target: ''})
  const types = useWorkspacePreparation('本场对象分类', `${projectId}:${sequenceId}:asset-types`, { kinds: {} as Record<string, string> })
  const busy = false
  const [created, setCreated] = useState<{ asset: AssetSummary }>()
  const [detail, setDetail] = useState<AssetSummary>()
  const closeDetail = useCallback(() => { setDetail(undefined); onRetry() }, [onRetry])
  const summary = sceneAssetSummary(design, assets)
  const rows: AssetRow[] = [{ key: 'location', name: '本场场所', kind: 'scene', id: design.direction.location_asset_id }]
  for (const person of design.participants) {
    if (person.character_id) rows.push({ key: `${person.id}:character`, name: person.name, kind: 'character', id: person.character_id, participantId: person.id })
    if (person.prop_id) rows.push({ key: `${person.id}:prop`, name: person.name, kind: 'prop', id: person.prop_id, participantId: person.id })
    if (!person.character_id && !person.prop_id) rows.push({ key: person.id, name: person.name, kind: ['character', 'prop'].includes(types.value.kinds[person.id]) ? types.value.kinds[person.id] as Kind : undefined, participantId: person.id })
  }
  const groupOrder = ['character', 'scene', 'prop', undefined]
  rows.sort((left, right) => groupOrder.indexOf(left.kind) - groupOrder.indexOf(right.kind))
  const createdIsLinked = created && rows.some(row => row.kind === created.asset.kind && row.id === created.asset.id)
  const associate = (row: AssetRow, id?: string) => {
    if (row.kind === 'scene') onChange({ ...design, direction: { ...design.direction, location_asset_id: id || null } })
    else if (row.kind && row.participantId) {
      types.update({ kinds: { ...types.value.kinds, [row.participantId]: row.kind } })
      onChange({ ...design, participants: design.participants.map(person => person.id === row.participantId ? { ...person, [row.kind + '_id']: id || null } : person) })
    }
  }
  const beginCreate = (row?: AssetRow) => {
    const target = row?.kind === 'scene' ? 'location' : row?.participantId || ''
    setInput({kind: row?.kind || 'character', name: row?.name || '', description: '', target})
    setCreating(true)
  }
  const selectedTarget = input.target === 'location' ? rows.find(row => row.key === 'location') : rows.find(row => row.participantId === input.target && (!row.kind || row.kind === input.kind))
  return <Card title="本场所需资产" extra={<Space><Select aria-label="新资产类型" value={input.kind} options={kinds} onChange={kind => setInput(current => ({...current,kind}))} /><Button onClick={() => { setInput(current => ({...current,target: '', name: '', description: ''})); setCreating(true) }}>仅创建项目资产</Button></Space>}>
    <Space direction="vertical" className="w-full">
      {loadError ? <Alert type="error" message="资产列表加载失败，关联数量暂未核实" description={loadError} action={<Button onClick={onRetry}>重试加载资产</Button>} /> : !assets ? <Typography.Text>正在核实资产关联…</Typography.Text> : <Typography.Text>已关联 {summary.total} 项 · 角色 {summary.counts.character} · 场所 {summary.counts.scene} · 道具 {summary.counts.prop}</Typography.Text>}
      {!!summary.invalid && <Alert type="warning" message={`${summary.invalid} 项资产引用在当前项目中不可用，请重新关联或清除；未自动更改设计。`} />}
      {confirmed && <Alert type="info" message="此设计已确认；关联修改将保存到新设计草稿，原确认版本保持不变。" />}
      <Typography.Text type="secondary">建档、关联本场、准备图片和选入试拍参考分别处理。这里的选择需保存设计后生效。</Typography.Text>
      {created && <Alert className="scene-asset-result" type="success" message={`${names[created.asset.kind]}档案「${created.asset.name}」已创建${createdIsLinked ? dirty ? '；本场关联待保存' : '；本场已关联' : '；尚未关联本场'}`} description={`保存位置：当前项目 → ${created.asset.kind === 'scene' ? '场景' : names[created.asset.kind]}。`} action={<Button onClick={() => setDetail(created.asset)}>查看新资产</Button>} />}
      {types.error && <Alert type="warning" message={types.error} />}
      <div className="scene-asset-list">{rows.map((row, index) => {
        const asset = assets?.find(item => item.kind === row.kind && item.id === row.id)
        const options = (assets || []).filter(item => item.kind === row.kind).map(item => ({ value: item.id, label: item.name }))
        if (row.id && !asset) options.push({ value: row.id, label: assets ? '关联资产不可用，请重新选择' : '关联资产待核实' })
        return <Fragment key={row.key}>{(index === 0 || rows[index - 1].kind !== row.kind) && <Typography.Title level={5}>{row.kind ? names[row.kind] : '待分类对象'}</Typography.Title>}<section className="scene-asset-row" aria-label={`本场对象 ${row.name}${row.kind ? ` · ${names[row.kind]}` : ''}`}>
          <div><strong>{row.name}</strong>{row.kind && (row.participantId && !row.id ? <Select aria-label={`${row.name}资产类型`} value={row.kind} options={kinds.filter(kind => kind.value !== 'scene')} onChange={kind => types.update({ kinds: { ...types.value.kinds, [row.participantId!]: kind } })} /> : <Tag>{names[row.kind]}</Tag>)}</div>
          {!row.kind ? <Select aria-label={`${row.name}资产类型`} placeholder="先选择角色或道具" options={kinds.filter(kind => kind.value !== 'scene')} onChange={kind => types.update({ kinds: { ...types.value.kinds, [row.participantId!]: kind } })} /> : <>
            <Select aria-label={row.kind === 'scene' ? '本场场所资产' : `${row.name}${names[row.kind]}关联`} allowClear placeholder="关联已有资产" title="更换关联资产" disabled={!assets || busy} options={options} value={row.id} onChange={id => associate(row, id)} />
            {asset && <div className="scene-asset-media">{asset.image_file_ids?.[0] && <img alt={`${asset.name}参考图`} src={buildFileDownloadUrl(asset.image_file_ids[0])} />}<span>{asset.image_file_ids?.length ? `${asset.image_file_ids.length} 张可用图片` : '尚无图片'}{!!asset.unavailable_image_count && ` · ${asset.unavailable_image_count} 项图片不可用`}<small>本场关联不代表已选入试拍参考</small></span></div>}
            <Space wrap>{asset ? <><Button size="small" onClick={() => setDetail(asset)}>查看资产</Button><Button size="small" onClick={() => setDetail(asset)}>准备图片</Button></> : <Button size="small" disabled={!assets || busy} onClick={() => beginCreate(row)}>新建并关联</Button>}</Space>
          </>}
        </section></Fragment>
      })}</div>
    </Space>
    {creating && <ResourceEditorDrawer open kind={input.kind} projectId={projectId} seed={{ name: input.name, description: input.description }} onClose={() => setCreating(false)} onSaved={async resource => {
      const asset: AssetSummary = { id: resource.id, kind: input.kind, name: resource.name, description: resource.description ?? '', image_file_ids: [] }
      onAssetsChange([...(assets || []).filter(item => item.id !== asset.id || item.kind !== asset.kind), asset])
      const target = selectedTarget && { ...selectedTarget, kind: input.kind }
      if (target) associate(target, asset.id)
      setCreated({ asset })
      onRetry()
    }} />}
    {detail && <ResourceEditorDrawer open kind={detail.kind} projectId={projectId} assetId={detail.id} onClose={closeDetail} onSaved={onRetry} />}

  </Card>
}
