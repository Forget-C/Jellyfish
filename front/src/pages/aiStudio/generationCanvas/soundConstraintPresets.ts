import type { DesignField } from '../../../services/generated'
import type { SoundConstraintCard } from './designFieldReferences'
import type { VisualPreset } from './visualPresets'

const field = (text: string, purpose: DesignField['purpose'] = 'constraint'): DesignField => ({ text, state: 'proposal', purpose, source_locator: '' })
/** Only declared generic instructions are applied; factual states and identities remain authored data. */
export function soundConstraintPresets(card: SoundConstraintCard): VisualPreset[] {
  const common = { look: 'performance' as const, diagram: card.type!.split('.')[1] }
  const presets: Record<string, VisualPreset[]> = {
    'direction.sound': [{ ...common, id: 'dialogue-first', name: '对白优先', steps: ['对白', '动作', '环境'], explanation: '保留对白可辨性，控制其他声音的干扰。', fields: { environment: field('环境声保持适度，避免遮盖对白', 'design'), music: field('音乐不遮盖对白和关键动作声') } }, { ...common, id: 'action-first', name: '突出动作声', steps: ['动作', '声音', '结果'], explanation: '用清晰动作声帮助辨认行动。', fields: { action_sound: field('突出关键动作发生及结束时的声音变化', 'design'), music: field('避免音乐掩盖关键动作声') } }],
    'direction.space_rule': [{ ...common, id: 'axis', name: '保持轴线', steps: ['空间关系', '轴线', '方向'], explanation: '保持可辨认的空间与方向关系，不假定具体位置。', fields: { axis: field('保持既定轴线关系，跨越时提供明确的空间交代') } }],
    'direction.continuity': [{ ...common, id: 'continuity-' + ('category' in card ? card.category : 'space'), name: '变化后延续', steps: ['前态', '变化', '后态'], explanation: '由用户填写具体前后态，后续保持所选分类的变化后状态。', fields: { following_constraints: field({ space: '保持已明确的空间位置、方向和尺度变化结果；新的变化须交代空间关系', appearance: '保持已明确的服装、妆发与外观变化结果；避免无依据的造型变化', hands_props: '保持已明确的手部与道具状态、持握和归属变化结果；交代转移过程', environment: '保持已明确的环境变化结果；后续环境变化须有依据', photography: '保持已明确的机位、光线和成像衔接要求；变化须清晰可辨', dialogue_sound: '保持已明确的对白与声音前后状态；衔接须符合已声明的声音变化' }['category' in card ? card.category || 'space' : 'space']) } }],
    'direction.creative_control': [{ ...common, id: 'limited', name: '有限发挥', steps: ['明确要求', '允许发挥', '保持边界'], explanation: '在已明确的要求内发挥。', fields: { freedom: field('在明确要求内有限发挥', 'design'), allowed_range: field('可调整未被明确约束的表达细节', 'design') } }],
    'direction.guidance': [{ ...common, id: 'readable', name: '动作可读优先', steps: ['行动', '变化', '结果'], explanation: '文字指导不会自动改变系统编译规则或素材绑定。', fields: { priority: field('优先清楚呈现关键行动及其结果', 'design'), prohibitions: field('避免遮挡或省略理解行动所必需的变化') } }],
    'direction.criterion': [{ ...common, id: 'observable', name: '动作结果可辨', steps: ['观察', '辨认', '判断'], explanation: '提供可观察标准，不自动作出验收结论。', fields: { standard: field('能够辨认关键动作的发生及结果状态；判断依据应在实际画面中可观察') } }],
  }
  return presets[card.type!] || []
}
