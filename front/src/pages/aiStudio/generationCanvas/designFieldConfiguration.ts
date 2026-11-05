import type { ReferenceDesignField, DesignField } from '../../../services/generated'

/** Configuration is relative to the real card schema, not a universal state or purpose default. */
export function isDesignFieldConfigured(field?: ReferenceDesignField | null, defaults?: DesignField | null): boolean {
  if (!field) return false
  const text = field.document ? field.document.segments?.map(part => part.kind === 'text' ? part.text : '@reference').join('') : field.text
  if (field.authorship === 'user') return !!(text?.trim() || 'size' in field && field.size)
  return !!(text?.trim() || field.source_locator?.trim() ||
    (field.state || 'empty') !== (defaults?.state || 'empty') ||
    (field.purpose || 'design') !== (defaults?.purpose || 'design') ||
    'size' in field && field.size || 'target_id' in field && field.target_id || 'state_id' in field && field.state_id)
}
