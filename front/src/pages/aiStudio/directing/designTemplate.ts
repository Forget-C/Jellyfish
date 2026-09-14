import type { Note_Input, SceneDesign_Input } from '../../../services/generated'

/** 创建未填写的工作单字段，空白模板不冒充已经判断过的未知。 */
function unsetFields<K extends string>(keys: K[]): Record<K, Note_Input> {
  return Object.fromEntries(keys.map(key => [key, { state: 'unset' }])) as Record<K, Note_Input>
}

/** 人工起稿模板保留所有六岗栏目；人物名称和行动由用户填写。 */
export function emptyDesign(): SceneDesign_Input {
  return {
    style_revision_id: null,
    sources: [{ kind: 'human', reference: 'local-user', version: 'manual-1' }],
    participants: [{ id: 'person1', name: '待命名人物', character_id: null, prop_id: null }],
    events: [{ id: 'event1', description: { state: 'unset' } }],
    criteria: [{ id: 'criterion1', requirement: { state: 'unset' } }],
    direction: {
      ...unsetFields(['viewpoint', 'information_change', 'relationship_change', 'turning_point', 'spatial_basis', 'shootable_area', 'axis', 'scale', 'control_level']),
      location_asset_id: null, immutable_facts: [], open_questions: [], anchors: [{ id: 'anchor1', description: { state: 'unset' } }],
      blocking_states: [{ id: 'state1', participant_id: 'person1', anchor_ids: ['anchor1'], event_id: 'event1', ...unsetFields(['position', 'orientation', 'initiative', 'path', 'transition_reason']) }],
      beats: [{ id: 'beat1', event_ids: ['event1'], ...unsetFields(['objective', 'obstacle', 'expected_change', 'must_show']) }],
      shots: [{ id: 'shot1', beat_ids: ['beat1'], event_ids: ['event1'], blocking_state_ids: ['state1'], criterion_ids: ['criterion1'], ...unsetFields(['narrative_function', 'visible_result']), estimated_duration_ms: 5000 }],
    },
    performance: { applicability: { state: 'unset' }, situations: [{ participant_id: 'person1', ...unsetFields(['situation', 'relationship']) }],
      beats: [{ beat_id: 'beat1', participant_id: 'person1', received_event_ids: ['event1'], dialogue_ids: [], criterion_ids: ['criterion1'],
        ...unsetFields(['objective', 'obstacle', 'subtext', 'attention', 'internal_adjustment', 'physical_action', 'delivery', 'reaction_order', 'exit_state', 'avoid', 'gaze', 'breath', 'weight', 'hands', 'voice']) }] },
    staging: { activities: [{ participant_id: 'person1', anchor_id: 'anchor1', trigger_event_id: 'event1', delay_ms: null,
      ...unsetFields(['depth', 'ongoing_task', 'path', 'attention', 'reaction_delay', 'intensity', 'entrances_exits', 'narrative_support', 'end_state']) }], ...unsetFields(['environment', 'intentional_absence']) },
    cinematography: [{ shot_id: 'shot1', criterion_ids: ['criterion1'], ...unsetFields(['composition', 'depth_layers', 'viewpoint', 'position', 'height_angle', 'lens_effect', 'depth_focus', 'support', 'movement_start', 'movement_trigger', 'movement_path', 'movement_speed', 'end_frame', 'light_sources', 'light_regions', 'exposure_color', 'optical_effects', 'motion_texture', 'technical_parameters', 'adjacent_requirements', 'prohibitions']) }],
    continuity: [{ id: 'continuity1', domain: 'hands_props', participant_id: 'person1', event_id: 'event1', ...unsetFields(['before', 'change', 'after', 'following_constraint']) }],
    sound: { dialogues: [{ id: 'dialogue1', participant_id: 'person1', version: '1', content: { state: 'unset' } }], ...unsetFields(['sources', 'ambience_actions', 'music_constraints']), execution: 'postproduction' },
    prompt: unsetFields(['priorities', 'binding_requirements', 'sound_strategy', 'prohibitions']),
  }
}
