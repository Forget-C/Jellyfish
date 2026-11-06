import { DesignMetadataLine } from './DesignMetadataLine'
import { useId, type ReactNode } from 'react'
import { Input } from 'antd'
import type { DesignField } from '../../../services/generated'
import { designFieldMetadataParts, userDesignField } from './designFieldMetadata'

/** Metadata describes retained extraction or legacy values; only the design content is editable. */
export function DesignFieldEditor({ label, value, purpose = 'design', defaults, metadataId, onChange, editor, labelAction }: { editor?: ReactNode; labelAction?: ReactNode; label: string; value?: DesignField; purpose?: DesignField['purpose']; defaults?: DesignField; metadataId?: string; compact?: boolean; onChange: (field: DesignField) => void }) {
  const generatedId = useId()
  const descriptionId = metadataId || generatedId
  const metadata = designFieldMetadataParts(value, defaults || { purpose })
  return <section aria-label={label} aria-describedby={metadata.length ? descriptionId : undefined}><strong className={labelAction ? "design-field-label-actions" : undefined}>{label}{labelAction}</strong>
    {editor ?? <Input.TextArea aria-label={`${label}内容`} aria-describedby={metadata.length ? descriptionId : undefined} value={value?.text || ''} autoSize={{ minRows: 2, maxRows: 7 }} onChange={event => {
      if (event.target.value !== (value?.text || '')) onChange(userDesignField({ ...value, text: event.target.value }))
    }} />}
    <DesignMetadataLine id={descriptionId} items={metadata} />
  </section>
}
