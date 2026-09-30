import { Alert, Button, Empty, Select } from 'antd'
import type { SceneDesign_Input } from '../../../services/generated'
import { DesignFields, designAt } from './DesignFields'
import { changeRelation, designObjects, relationBinding, relationOwner, shotGraph } from './designWorkspace'
import type { DesignEdge } from './designWorkspace'

/** 关系编辑写原引用；解除边不删除对象，必填单值引用只能更换。 */
export function DesignRelationEditor({ value, edge, objectKey, disabled, onChange, onSelect, onClose }: { value: SceneDesign_Input; edge?: DesignEdge; objectKey?: string; disabled: boolean; onChange: (value: SceneDesign_Input) => void; onSelect: (key: string) => void; onClose: () => void }) {
  const objects = designObjects(value)
  const object = objects.find(row => row.key === objectKey)
  const binding = edge && relationBinding(value, edge)
  const label = (key: string) => objects.find(row => row.key === key)?.label || '缺失引用'
  const affected = value.direction.shots.filter(shot => shotGraph(value, shot.id).nodes.some(node => node.key === (edge?.from || objectKey)))
  const raw = object ? designAt(value, object.path) : undefined
  const fields = raw && typeof raw === 'object' ? [...new Set([...Object.keys(raw), ...(objectKey?.startsWith('shot:') ? ['participant_ids'] : [])])].filter(key => (key.endsWith('_ids') || key.endsWith('_id')) && !['character_id', 'prop_id', 'location_asset_id', 'style_revision_id'].includes(key)) : []
  return <div className="design-relation-editor"><Button onClick={onClose}>返回对象详情</Button><h2>{edge ? edge.label : `${object?.label || '对象'} · 关联`}</h2>
    {affected.length > 1 && <Alert type="info" message={`共享关联 · 修改影响 ${affected.length} 个镜头`} description={affected.map(shot => `镜头 ${value.direction.shots.indexOf(shot) + 1}`).join('、')} />}
    {edge ? <><p>{label(edge.from)} → {label(edge.to)}</p>{edge.indirect ? <><Alert type="info" message="这是间接关系，请修改原始对象的引用" /><Button onClick={() => { onSelect(relationOwner(edge)); onClose() }}>定位原始关联</Button></> : binding ? <>
      <label>关联对象</label><Select aria-label="更换关联对象" value={binding.target} style={{ width: '100%' }} disabled={disabled} options={objects.filter(row => row.key.startsWith(`${binding.prefix}:`)).map(row => ({ value: row.key.slice(binding.prefix.length + 1), label: row.label }))} onChange={id => { onChange(changeRelation(value, binding, id)); onClose() }} />
      <p>{binding.required ? '必填关联可以更换，不能留空。' : '解除关联只移除当前引用，不删除任何对象。'}</p>
      {!binding.required && <Button disabled={disabled} onClick={() => { onChange(changeRelation(value, binding)); onClose() }}>解除此关联</Button>}
    </> : <Empty description="此关系暂不可编辑，请检查来源对象是否存在" />}</> : object && fields.length ? <DesignFields value={value} path={object.path} fields={fields} disabled={disabled} onChange={onChange} /> : <Empty description="此对象没有可直接编辑的引用，请从关联镜头或连线进入" />}
  </div>
}
