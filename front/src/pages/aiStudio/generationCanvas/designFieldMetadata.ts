import type { DesignField, ReferenceDesignField } from '../../../services/generated'

const states = { empty: '未填写', not_applicable: '不适用', absent: '明确没有', undecided: '待确定', proposal: '提议', fact: '事实' }
const purposes = { background: '背景', design: '设计', constraint: '约束' }

const hasContent = (value: ReferenceDesignField & { size?: string | null }) => !!(value.size || (value.document ? value.document.segments?.some(part => part.kind === 'reference' || part.text?.trim()) : value.text?.trim()))

/** An actual edit replaces extraction metadata; reference-only and structured values are populated too. */
export function userDesignField<T extends ReferenceDesignField & { size?: string | null }>(value: T): T {
  return { ...value, authorship: 'user', metadata_fields: undefined, state: hasContent(value) ? 'fact' : 'empty', purpose: 'design', source_locator: '' }
}

/** Legacy defaults are not evidence of extraction; meaningful inactive states remain visible. */
export function designFieldMetadata(value?: ReferenceDesignField & { size?: string | null }, defaults?: DesignField): string {
  if (!value || value.authorship === 'user') return ''
  const extracted = value.authorship === 'model'
  const supplied = (key: 'state' | 'purpose' | 'source_locator') => value.metadata_fields?.includes(key) || false
  const inactive = value.state === 'not_applicable' || value.state === 'empty' && hasContent(value)
  return [
    value.state && (extracted ? supplied('state') : value.state !== (defaults?.state || 'empty') || inactive) ? states[value.state] : '',
    inactive ? '不参与生成' : '',
    value.purpose && (extracted ? supplied('purpose') : value.purpose !== (defaults?.purpose || 'design')) ? purposes[value.purpose] : '',
    value.source_locator?.trim() && (!extracted || supplied('source_locator')) ? `来源：${value.source_locator}` : '',
  ].filter(Boolean).join(' · ')
}
