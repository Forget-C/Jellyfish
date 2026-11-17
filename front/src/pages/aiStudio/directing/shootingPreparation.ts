import type { ShootingPreparation } from '../../../services/generated'

/** 范围变化保留说明供复核，不自动当作新场次已采用内容。 */
export function reviewShootingPreparation(value?: ShootingPreparation): ShootingPreparation | undefined {
  return value && { ...value, notes: (value.notes || []).map(note => ({ ...note, choice: 'review' })) }
}
