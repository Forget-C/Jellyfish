import { Select } from 'antd'
import type { CanvasResolvedOutput, DesignTextPayload, InputBinding, ImageModelCard, TextModelCard, VideoModelCard } from '../../../services/generated'

/** 图片目标仅定位时刻，不改变整卡采用。 */
export function PhotographyInputScope({card, output, binding, onChange, disabled}: {card:ImageModelCard|TextModelCard|VideoModelCard;output:CanvasResolvedOutput;binding?:InputBinding;onChange:(card:ImageModelCard|TextModelCard|VideoModelCard)=>void;disabled?:boolean}) {
  if (!binding) return null
  const payload = output.payload as DesignTextPayload | undefined
  const image = card as ImageModelCard
  const states = payload?.kind === 'design' ? payload.frame_states || [] : []
  const retainedTarget = image.frame_targets?.find(target => target.binding_id === binding.id)
  const missingTarget = retainedTarget && !states.some(state => state.id === retainedTarget.state_id)
  const showTarget = card.type === 'model.image' && (states.length > 0 || retainedTarget)
  if (!showTarget) return null
  return <section aria-label={`导演输入配置 ${output.token}`}>
    {showTarget && <label>本张图画面目标<Select aria-label={`画面目标 ${output.token}`} allowClear placeholder={states.length > 1 ? '请选择明确状态' : '已有明确状态时可选'} disabled={disabled} style={{width:'100%'}} value={retainedTarget?.state_id}
      options={[...states.map(state => ({value:state.id,label:state.label})), ...(missingTarget ? [{ value: retainedTarget.state_id, label: `失效画面 · ${retainedTarget.state_id}`, disabled: true }] : [])]} onChange={state_id => onChange({...card,frame_targets:[...(image.frame_targets || []).filter(target => target.binding_id !== binding.id),...(state_id ? [{binding_id:binding.id,state_id}] : [])]})} /></label>}
  </section>
}
