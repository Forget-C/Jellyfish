import { Select } from 'antd'
import type { CanvasResolvedOutput, DesignTextPayload, PhotographyTextPayload, InputBinding, ImageModelCard, TextModelCard, VideoModelCard } from '../../../services/generated'

/** 范围采用和本张图目标分别保存；后端声明是选择范围的唯一权威。 */
export function PhotographyInputScope({card, output, binding, onChange, disabled}: {card:ImageModelCard|TextModelCard|VideoModelCard;output:CanvasResolvedOutput;binding?:InputBinding;onChange:(card:ImageModelCard|TextModelCard|VideoModelCard)=>void;disabled?:boolean}) {
  if (!binding) return null
  if (output.payload?.kind !== 'photography' && output.payload?.kind !== 'design') return null
  const payload = output.payload as PhotographyTextPayload | DesignTextPayload
  const photography = payload as PhotographyTextPayload
  const isPhotography = payload.kind === 'photography'
  const image = card as ImageModelCard
  const selected = isPhotography ? binding.photography_scope ?? ['whole'] : ['whole']
  const states = (payload.frame_states || []).filter(state => selected.includes('whole') || selected.includes(state.id) || selected.includes('region:movement'))
  return <section aria-label={`摄影采用配置 ${output.token}`}>
    {isPhotography && <label>采用范围<Select aria-label={`摄影采用范围 ${output.token}`} mode="multiple" optionFilterProp="label" value={selected} disabled={disabled} style={{width:'100%'}} options={(photography.adoption_scopes || []).map(scope => ({value:scope.id,label:scope.label}))}
      onChange={photography_scope => onChange({...card,input_bindings:(card.input_bindings || []).map(value => value.id === binding.id ? {...value,photography_scope} : value)})} /></label>}
    {card.type === 'model.image' && <label>本张图画面目标<Select aria-label={`画面目标 ${output.token}`} allowClear placeholder={states.length > 1 ? '请选择明确状态' : '已有明确状态时可选'} disabled={disabled} style={{width:'100%'}} value={image.frame_targets?.find(target => target.binding_id === binding.id)?.state_id}
      options={states.map(state => ({value:state.id,label:state.label}))} onChange={state_id => onChange({...card,frame_targets:[...(image.frame_targets || []).filter(target => target.binding_id !== binding.id),...(state_id ? [{binding_id:binding.id,state_id}] : [])]})} /></label>}
  </section>
}
