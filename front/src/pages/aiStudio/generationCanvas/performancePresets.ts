import type { DesignField } from '../../../services/generated'
import type { VisualPreset } from './visualPresets'

const field = (text: string, purpose: DesignField['purpose'] = 'design'): DesignField => ({ text, state: 'proposal', purpose, source_locator: '' })

/** Templates describe observable intent; object identities and relationships are always chosen explicitly. */
export const performancePresets: Record<string, VisualPreset[]> = {
  situation: [
    { id: 'waiting', name: '等待回应', look: 'performance', diagram: 'situation', steps: ['等待', '观察', '调整'], explanation: '等待对方回应，观察变化，保持当前关系的不确定性。', fields: { situation: field('等待对方回应，留意对方的动作和态度变化', 'background'), relationship: field('双方尚未明确表态，保持试探性的距离', 'background') } },
    { id: 'reunion', name: '久别重逢', look: 'performance', diagram: 'situation', steps: ['辨认', '靠近', '停留'], explanation: '从辨认到靠近，先保留距离，再建立交流。', fields: { situation: field('久别后再次相遇，先辨认对方，再尝试靠近', 'background'), relationship: field('彼此熟悉，但需要重新确认当前关系', 'background') } },
  ],
  performance: [
    { id: 'restrained', name: '克制回应', look: 'performance', diagram: 'performance', steps: ['停顿', '回应', '收住动作'], explanation: '短暂停顿后回应，动作幅度较小，结束时保持稳定。', fields: { reaction_order: field('先短暂停顿，确认对方反应后再回应'), physical_action: field('动作幅度较小，回应后收住动作'), exit_state: field('保持稳定姿态，等待对方下一步反应') } },
    { id: 'leave', name: '转身离开', look: 'performance', diagram: 'performance', steps: ['移开视线', '转身', '离开'], explanation: '先移开视线，再转身离开，动作顺序清楚。', fields: { reaction_order: field('先移开视线，停顿后转身'), physical_action: field('转身后连续走开，不在途中回头'), exit_state: field('离开原来的交流位置') } },
  ],
  performance_rule: [
    { id: 'small', name: '减少多余动作', look: 'performance', diagram: 'performance_rule', steps: ['明确目标', '减少动作', '保留反应'], explanation: '让动作服务当前目标，避免无依据的重复动作。', fields: { applicability: field('动作服务当前目标；减少无依据的手部动作和反复点头，保留对事件的可见反应', 'constraint') } },
    { id: 'listen', name: '保持倾听反应', look: 'performance', diagram: 'performance_rule', steps: ['倾听', '变化', '回应'], explanation: '对方说话时保留注意和反应，避免机械等待。', fields: { applicability: field('对方说话时保持明确注意；反应随接收到的信息变化，避免机械等待轮到自己发言', 'constraint') } },
  ],
  blocking: [
    { id: 'approach', name: '靠近后停下', look: 'performance', diagram: 'blocking', steps: ['起点', '靠近', '停下'], explanation: '沿明确路径靠近目标，在交流距离停下。', fields: { position: field('从当前起点出发，在目标前保留交流距离'), path: field('沿直接路径靠近目标，抵达后停下'), orientation: field('抵达后面向交流目标') } },
    { id: 'pass', name: '横向穿过', look: 'performance', diagram: 'blocking', steps: ['进入', '横穿', '离开'], explanation: '连续横向移动，避免中途停顿和重复折返。', fields: { path: field('沿横向路径连续穿过活动区域'), orientation: field('身体朝向行进方向'), transition_reason: field('抵达目标位置后结束当前移动') } },
  ],
  activity: [
    { id: 'organize', name: '持续整理', look: 'performance', diagram: 'activity', steps: ['整理', '短暂注意', '继续'], explanation: '持续进行手头任务，对主戏短暂反应后继续。', fields: { task: field('持续整理手边物品，动作有先后次序'), main_action_effect: field('提供生活活动背景，不抢占主戏注意'), exit_state: field('完成当前整理步骤后保持工作状态') } },
    { id: 'crossing', name: '背景经过', look: 'performance', diagram: 'activity', steps: ['入画', '经过', '出画'], explanation: '背景人物连续经过，不停留在主戏中心。', fields: { task: field('沿既定方向连续经过'), main_action_effect: field('建立环境活动，不遮挡主戏的关键动作'), entry_exit: field('从一侧入画，经过后从另一侧出画'), exit_state: field('离开当前画面') } },
  ],
  environment: [
    { id: 'subtle', name: '轻微环境活动', look: 'performance', diagram: 'environment', steps: ['局部活动', '保持空间', '延续'], explanation: '仅在局部保留缓慢活动，为主戏留出清晰区域。', fields: { activity: field('局部环境保持轻微、缓慢的活动'), empty_space: field('主戏周围不安排额外穿行'), reason: field('保留主戏的可读性，避免环境活动分散注意') } },
    { id: 'quiet', name: '安静留白', look: 'performance', diagram: 'environment', steps: ['减少活动', '留白', '聚焦'], explanation: '主动减少环境活动，让观众注意人物和事件。', fields: { activity: field('环境保持安静，减少无关活动'), empty_space: field('关键交流区域保留空白'), reason: field('让人物反应和事件变化成为注意中心') } },
  ],
}
