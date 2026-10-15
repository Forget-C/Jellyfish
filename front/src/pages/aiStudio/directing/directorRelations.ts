export type DirectorRelationCategory = 'design' | 'evidence' | 'criterion' | 'constraint'

/** 只分类现有绘制关系；压缩路径采用最后一段的真实关系类型。 */
export function directorRelationCategory(label: string): DirectorRelationCategory {
  const parts = label.split(' → '), last = parts[parts.length - 1]
  if (['摄影设计', '调度依据', '节拍表演', '连续性变化'].includes(last || '')) return 'design'
  if (last === '验收依据') return 'criterion'
  if (last === '全场约束') return 'constraint'
  return 'evidence'
}
