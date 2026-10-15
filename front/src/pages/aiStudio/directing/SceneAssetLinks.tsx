import { useEffect, useState } from 'react'
import { Alert, Button, Select, Space, Spin } from 'antd'
import { Link } from 'react-router-dom'
import { StudioDirectingService } from '../../../services/generated'
import type { AssetSummary, EditableSceneDesign_Output } from '../../../services/generated'
import { directingError } from './common'

const assetDrag = 'application/x-jellyfish-project-asset'
const names = { character: '角色', scene: '场所', prop: '道具' }

/** 只关联项目已有资产；点击和拖入使用同一关联入口，不修改或删除共享资产。 */
export function SceneAssetLinks({ projectId, value, disabled, onChange, assetKind, shotId, participantId, createOnly = false }: {
  assetKind?: AssetSummary['kind']
  shotId?: string
  participantId?: string
  createOnly?: boolean
  projectId: string
  value: EditableSceneDesign_Output
  disabled: boolean
  onChange: (value: EditableSceneDesign_Output) => void
}) {
  const [assets, setAssets] = useState<AssetSummary[]>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void StudioDirectingService.directingAssets({ projectId }).then(response => {
      if (!response.data) throw new Error('资产列表尚未核实')
      if (active) setAssets(response.data)
    }).catch(cause => { if (active) setError(directingError(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, attempt])
  const shot = shotId ? value.direction.shots.find(item => item.id === shotId) : undefined
  const locked = disabled || loading || !!error || !assets || !!shotId && !shot
  const associate = (kind: AssetSummary['kind'], id: string | null, participantId?: string) => {
    if (locked || id && !assets.some(asset => asset.id === id && asset.kind === kind)) return
    if (kind === 'scene') onChange({ ...value, direction: { ...value.direction, location_asset_id: id } })
    else if (participantId && value.participants.some(person => person.id === participantId)) onChange({ ...value,
      participants: value.participants.map(person => person.id === participantId ? { ...person, [kind + '_id']: id } : person) })
  }
  const addParticipant = (asset: AssetSummary) => {
    if (locked || asset.kind === 'scene' || value.participants.some(person => person[asset.kind === 'character' ? 'character_id' : 'prop_id'] === asset.id)) return
    const id = crypto.randomUUID()
    onChange({ ...value, direction: shot ? { ...value.direction, shots: value.direction.shots.map(item => item.id === shot.id ? { ...item, participant_ids: [...(item.participant_ids || []), id] } : item) } : value.direction, participants: [...value.participants, { id, name: asset.name,
      character_id: asset.kind === 'character' ? asset.id : null, prop_id: asset.kind === 'prop' ? asset.id : null }] })
  }
  const drop = (event: React.DragEvent, kind: AssetSummary['kind'], participantId?: string) => {
    event.preventDefault()
    const id = event.dataTransfer.getData(assetDrag)
    if (assets?.some(asset => `${asset.kind}:${asset.id}` === id && asset.kind === kind)) associate(kind, id.slice(kind.length + 1), participantId)
  }
  const selector = (kind: AssetSummary['kind'], id: string | null | undefined, label: string, participantId?: string) => {
    const options = (assets || []).filter(asset => asset.kind === kind).map(asset => ({ value: asset.id, label: asset.name }))
    if (id && !options.some(option => option.value === id)) options.push({ value: id, label: loading || error ? '已有资产待核实' : '原资产不可用，请重新关联' })
    return <div className="design-field" onDragOver={event => { if (!locked) event.preventDefault() }} onDrop={event => drop(event, kind, participantId)}>
      <label>{label}</label>
      <Select aria-label={label} style={{ width: '100%' }} disabled={locked} placeholder={`选择项目${names[kind]}，或拖入下方资产`}
        value={id} options={options} onChange={next => associate(kind, next, participantId)} />
      <Button disabled={locked || !id} onClick={() => associate(kind, null, participantId)}>解除{label}</Button>
    </div>
  }
  return <section aria-label="项目资产关联">
    <p>本场关联随设计保存；解除关联不会删除项目资产。图片参考需在单元中另行选择。</p>
    <Link to={`/projects/${projectId}`}>前往项目工作台管理资产</Link>
    {loading && <p><Spin size="small" /> 正在读取项目资产</p>}
    {error && <Alert type="error" message="项目资产读取失败，已有内容已保留" description={error}
      action={<Button onClick={() => setAttempt(value => value + 1)}>重试读取资产</Button>} />}
    {shotId && !shot && <Alert type="warning" message="原镜头不可用，请重新选择" />}
    {shot && assetKind !== 'scene' && <div className="design-field"><label>当前镜头参与对象</label>
      <Select mode="multiple" aria-label="当前镜头参与对象" style={{ width: '100%' }} disabled={locked}
        value={shot.participant_ids || []} options={value.participants.map(person => ({ value: person.id, label: person.name }))}
        onChange={ids => onChange({ ...value, direction: { ...value.direction, shots: value.direction.shots.map(item => item.id === shot.id ? { ...item, participant_ids: ids } : item) } })} />
    </div>}
    {!createOnly && !participantId && (!assetKind || assetKind === 'scene') && selector('scene', value.direction.location_asset_id, '本场场所资产')}
    {!createOnly && assetKind !== 'scene' && value.participants.filter(person => !participantId || person.id === participantId).map(person => <section key={person.id}>
      <h4>{person.name}</h4>
      {(!assetKind || assetKind === 'character') && selector('character', person.character_id, `${person.name}角色关联`, person.id)}
      {(!assetKind || assetKind === 'prop') && selector('prop', person.prop_id, `${person.name}道具关联`, person.id)}
    </section>)}
    {!loading && !error && assets?.length === 0 && <p>当前项目尚无可关联资产。</p>}
    {!participantId && <><h4>项目已有资产</h4>
    <div className="canvas-asset-drop" aria-label="拖入资产加入本场" onDragOver={event => { if (!locked) event.preventDefault() }}
      onDrop={event => {
        event.preventDefault()
        const asset = assets?.find(item => `${item.kind}:${item.id}` === event.dataTransfer.getData(assetDrag))
        if (asset && (!createOnly || asset.kind !== 'scene') && (!assetKind || asset.kind === assetKind)) { if (asset.kind === 'scene') associate('scene', asset.id); else addParticipant(asset) }
      }}>点击下方资产或拖到此处加入本场{!createOnly && '；场所会替换本场场所关联'}。</div>
    <Space wrap>{assets?.filter(asset => (!createOnly || asset.kind !== 'scene') && (!assetKind || asset.kind === assetKind)).map(asset => <div key={`${asset.kind}:${asset.id}`} draggable={!locked}
      onDragStart={event => { event.dataTransfer.setData(assetDrag, `${asset.kind}:${asset.id}`); event.dataTransfer.effectAllowed = 'link' }}>
      <Button aria-label={`${asset.kind === 'scene' ? '用作本场场所' : '加入本场'}：${asset.name}`} disabled={locked || asset.kind !== 'scene' && value.participants.some(person => person[asset.kind === 'character' ? 'character_id' : 'prop_id'] === asset.id)}
        onClick={() => asset.kind === 'scene' ? associate('scene', asset.id) : addParticipant(asset)}>
        {names[asset.kind]} · {asset.name}
      </Button>
    </div>)}</Space></>}
  </section>
}
