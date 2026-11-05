import type { DesignField, ReferenceDesignField } from '../../../services/generated'

const states = { empty: '未填写', not_applicable: '不适用', absent: '明确没有', undecided: '待确定', proposal: '提议', fact: '事实' }
const purposes = { background: '背景', design: '设计', constraint: '约束' }

const hasContent = (value: ReferenceDesignField & { size?: string | null }) => !!(value.size || (value.document ? value.document.segments?.some(part => part.kind === 'reference' || part.text?.trim()) : value.text?.trim()))

/** An actual edit replaces extraction metadata; reference-only and structured values are populated too. */
export function userDesignField<T extends ReferenceDesignField & { size?: string | null }>(value: T): T {
  return { ...value, authorship: 'user', metadata_fields: undefined, state: hasContent(value) ? 'fact' : 'empty', purpose: 'design', source_locator: '' }
}

/** Legacy defaults are not evidence of extraction; meaningful inactive states remain visible. */
export function designFieldMetadataParts(value?: ReferenceDesignField & { size?: string | null }, defaults?: DesignField): { label: string; text: string }[] {
  if (!value || value.authorship === 'user') return []
  const extracted = value.authorship === 'model'
  const supplied = (key: 'state' | 'purpose' | 'source_locator') => value.metadata_fields?.includes(key) || false
  const inactive = value.state === 'not_applicable' || value.state === 'empty' && hasContent(value)
  return [
    value.state && (extracted ? supplied('state') : value.state !== (defaults?.state || 'empty') || inactive) ? { label: '状态', text: states[value.state] } : null,
    inactive ? { label: '', text: '不参与生成' } : null,
    value.purpose && (extracted ? supplied('purpose') : value.purpose !== (defaults?.purpose || 'design')) ? { label: '用途', text: purposes[value.purpose] } : null,
    value.source_locator?.trim() && (!extracted || supplied('source_locator')) ? { label: '来源', text: value.source_locator } : null,
  ].filter((item): item is { label: string; text: string } => item !== null)
}

/** 预设变更摘要保留原有文案，单行说明仅在专用展示组件中格式化。 */
export function designFieldMetadata(value?: ReferenceDesignField & { size?: string | null }, defaults?: DesignField): string {
  return designFieldMetadataParts(value, defaults).map(item => item.label === '来源' ? `来源：${item.text}` : item.text).join(' · ')
}
