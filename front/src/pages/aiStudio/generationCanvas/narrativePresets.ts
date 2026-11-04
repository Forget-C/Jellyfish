import type { VisualPreset } from './visualPresets'
import type { DesignField } from '../../../services/generated'

const field = (text: string): DesignField => ({ text, state: 'proposal', purpose: 'design', source_locator: '' })

/** Narrative presets author generic intent without assigning story identities or relationships. */
export const narrativePresets: Record<string, VisualPreset[]> = {
  'direction.narrative': [
    { id: 'gradual', name: '信息逐步揭示', look: 'performance', diagram: 'narrative', steps: ['观察', '发现', '理解'], explanation: '逐步提供可观察的信息，让观众随视点理解变化。', fields: { viewpoint: field('限制在当前观察视点可感知的信息内'), information_change: field('先呈现线索，再逐步揭示其意义') } },
    { id: 'turn', name: '关系转折', look: 'performance', diagram: 'narrative', steps: ['原有关系', '变化', '新状态'], explanation: '让关系变化通过可见行为呈现。', fields: { relationship_change: field('通过行为和回应呈现关系变化'), turning_point: field('突出改变关系判断的关键行动') } },
  ],
  'direction.beat': [
    { id: 'obstacle', name: '目标受阻', look: 'performance', diagram: 'beat', steps: ['目标', '阻碍', '调整'], explanation: '清楚呈现目标如何遇到阻碍及其带来的变化。', fields: { objective: field('让当前行动目标清晰可读'), obstacle: field('呈现阻止目标达成的具体阻碍'), expected_change: field('通过应对阻碍体现行动策略的变化') } },
    { id: 'decision', name: '决定行动', look: 'performance', diagram: 'beat', steps: ['权衡', '决定', '行动'], explanation: '用可见行动表达决定。', fields: { expected_change: field('从犹豫或观察转入明确行动'), audience_must_see: field('让决定落实为可辨认的行动变化') } },
  ],
  'direction.event': [
    { id: 'stimulus', name: '外部刺激', look: 'performance', diagram: 'event', steps: ['刺激', '感知', '变化'], explanation: '交代刺激出现以及可感知的变化。', fields: { action_change: field('清楚呈现外部刺激的出现及其可感知变化，为后续反应提供依据') } },
    { id: 'discovery', name: '发现线索', look: 'performance', diagram: 'event', steps: ['出现', '发现', '认知改变'], explanation: '先让线索可见，再呈现发现。', fields: { action_change: field('先呈现可发现的线索，再明确发现发生的时刻与信息变化') } },
  ],
  'direction.shot': [
    { id: 'reaction', name: '反应揭示', look: 'performance', diagram: 'shot', steps: ['刺激', '反应', '结果'], explanation: '用人物反应揭示刺激的影响。', fields: { narrative_role: field('通过人物反应揭示刺激的影响'), visible_result: field('让反应后的状态变化清晰可见') } },
    { id: 'result', name: '结果确认', look: 'performance', diagram: 'shot', steps: ['行动', '结果', '确认'], explanation: '让行动结果成为清晰的可见依据。', fields: { narrative_role: field('确认前一行动带来的结果'), visible_result: field('清楚呈现结果状态，保留足够的辨认信息') } },
  ],
}
