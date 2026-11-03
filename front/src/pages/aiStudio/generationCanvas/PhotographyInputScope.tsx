import { Select } from 'antd'
import type { CanvasResolvedOutput, DesignTextPayload, InputBinding, ImageModelCard, TextModelCard, VideoModelCard } from '../../../services/generated'

/** 图片画面目标只明确时刻，设计始终整卡采用。 */
export function PhotographyInputScope({card, output, binding, onChange, disabled}: {card:ImageModelCard|TextModelCard|VideoModelCard;output:CanvasResolvedOutput;binding?:InputBinding;onChange:(card:ImageModelCard|TextModelCard|VideoModelCard)=>void;disabled?:boolean}) {
  if (!binding) return null
  if (output.payload?.kind !== 'design') return null
  const payload = output.payload as DesignTextPayload
  const image = card as ImageModelCard
  const states = payload.frame_states || []
  const retainedTarget = image.frame_targets?.some(target => target.binding_id === binding.id)
  const showTarget = card.type === 'model.image' && (states.length > 0 || retainedTarget)
  if (!showTarget) return null
  return <section aria-label={`导演输入配置 ${output.token}`}>
    {showTarget && <label>本张图画面目标<Select aria-label={`画面目标 ${output.token}`} allowClear placeholder={states.length > 1 ? '请选择明确状态' : '已有明确状态时可选'} disabled={disabled} style={{width:'100%'}} value={image.frame_targets?.find(target => target.binding_id === binding.id)?.state_id}
      options={states.map(state => ({value:state.id,label:state.label}))} onChange={state_id => onChange({...card,frame_targets:[...(image.frame_targets || []).filter(target => target.binding_id !== binding.id),...(state_id ? [{binding_id:binding.id,state_id}] : [])]})} /></label>}
  </section>
}
