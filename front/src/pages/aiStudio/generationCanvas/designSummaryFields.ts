/** 紧凑档的类型、核心字段和辅助字段优先级共用同一份定义。 */
export const compactDesignFields: Partial<Record<string, { core: string; auxiliary: readonly string[] }>> = {
  'direction.criterion': { core: 'standard', auxiliary: ['scope', 'condition'] },
  'direction.fact': { core: 'fact', auxiliary: ['source_basis', 'source'] },
  'direction.dialogue': { core: 'content', auxiliary: ['language_pronunciation', 'audiovisual_relation'] },
  'direction.event': { core: 'action_change', auxiliary: ['source'] },
  'direction.performance_rule': { core: 'applicability', auxiliary: ['scope', 'condition'] },
}

/** 结构化档按卡片职责选择关键字段，与目录中的表单字段顺序无关。 */
export const structuredDesignFields: Partial<Record<string, readonly string[]>> = {
  'direction.creative_control': ['keep', 'allowed_range', 'freedom'],
  'direction.guidance': ['priority', 'prohibitions', 'reference_requirements'],
  'direction.narrative': ['information_change', 'relationship_change', 'turning_point'],
  'direction.beat': ['objective', 'obstacle', 'expected_change'],
  'direction.shot': ['visible_result', 'narrative_role', 'estimated_duration'],
  'direction.situation': ['situation', 'relationship'],
  'direction.performance': ['physical_action', 'reaction_order', 'exit_state'],
  'direction.blocking': ['position', 'path', 'transition_reason'],
  'direction.activity': ['task', 'path', 'entry_exit'],
  'direction.environment': ['activity', 'empty_space', 'reason'],
  'direction.anchor': ['position', 'orientation', 'spatial_relation'],
  'direction.sound': ['source_description', 'sound_elements', 'hierarchy'],
  'direction.space_rule': ['shootable_area', 'axis', 'scale'],
  'direction.continuity': ['category', 'continuity_sequence', 'following_constraints'],
}
