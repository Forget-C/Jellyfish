/** 结构化档按卡片职责选择关键字段，与目录中的表单字段顺序无关。 */
export const structuredDesignFields: Partial<Record<string, readonly string[]>> = {
  'direction.creative_control': ['keep', 'allowed_range', 'freedom'],
  'direction.guidance': ['priority', 'prohibitions', 'reference_requirements'],
  'direction.narrative': ['information_change', 'relationship_change', 'turning_point'],
  'direction.beat': ['objective', 'obstacle', 'expected_change'],
  'direction.shot': ['visible_result', 'narrative_role', 'estimated_duration'],
  'direction.anchor': ['position', 'orientation', 'spatial_relation'],
  'direction.sound': ['source_description', 'sound_elements', 'hierarchy'],
  'direction.space_rule': ['shootable_area', 'axis', 'scale'],
  'direction.continuity': ['category', 'continuity_sequence', 'following_constraints'],
}
