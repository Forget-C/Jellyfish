import type { DesignField } from '../../../services/generated'

const stateLabels = { not_applicable: '不适用', absent: '明确没有', undecided: '待确定', proposal: '提议' } as const

/** 卡面只摘要本卡明确设计字段；优先主字段，无内容时回退，保留否定和开放状态。 */
export function designSummary(preferred: (DesignField | undefined)[], values: unknown[]) {
  const describe = (value: unknown) => {
    if (!value || typeof value !== 'object' || !('state' in value) || !('text' in value)) return ''
    const field = value as DesignField
    if (field.state === 'empty') return ''
    const text = field.text?.trim() || ''
    const label = field.state && field.state in stateLabels ? stateLabels[field.state as keyof typeof stateLabels] : ''
    return label ? `${label}${text ? `：${text}` : ''}` : text
  }
  const primary = preferred.map(describe).filter(Boolean)
  return (primary.length ? primary : values.map(describe).filter(Boolean)).slice(0, 3).join(' · ')
}
