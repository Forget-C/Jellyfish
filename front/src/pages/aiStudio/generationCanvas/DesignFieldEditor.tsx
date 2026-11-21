import { useUiText } from '../../../uiText'
import { DesignMetadataLine } from './DesignMetadataLine'
import { useId, type ReactNode } from 'react'
import { Input, Select, Space } from 'antd'
import type { DesignField } from '../../../services/generated'
import { designFieldMetadataParts, purposes, states, userDesignField } from './designFieldMetadata'

/** Metadata describes retained extraction or legacy values; only the design content is editable. */
export function DesignFieldEditor({ label: sourceLabel, value, purpose = 'design', defaults, metadataId, onChange, editor, labelAction }: { editor?: ReactNode; labelAction?: ReactNode; label: string; value?: DesignField; purpose?: DesignField['purpose']; defaults?: DesignField; metadataId?: string; compact?: boolean; onChange: (field: DesignField) => void }) {
  const uiText = useUiText()
  const label = uiText(sourceLabel)
  const generatedId = useId()
  const descriptionId = metadataId || generatedId
  const metadata = designFieldMetadataParts(value, defaults || { purpose })
  return <section aria-label={label} aria-describedby={metadata.length ? descriptionId : undefined}><strong className={labelAction ? "design-field-label-actions" : undefined}>{label}{labelAction}</strong>
    {editor ?? <Input.TextArea aria-label={uiText("{{label}}内容", { label })} aria-describedby={metadata.length ? descriptionId : undefined} value={value?.text || ''} autoSize={{ minRows: 2, maxRows: 7 }} onChange={event => {
      if (event.target.value !== (value?.text || '')) onChange(userDesignField({ ...value, text: event.target.value }))
    }} />}
    {value?.extraction_context === 'storyboard' && <Space wrap>
      <Select aria-label={uiText("{{label}}状态", { label })} size="small" value={value.state || 'empty'}
        options={Object.entries(states).map(([key, text]) => ({ value: key as DesignField['state'], label: uiText(text) }))}
        onChange={state => onChange(userDesignField({ ...value, state }))} />
      <Select aria-label={uiText("{{label}}用途", { label })} size="small" value={value.purpose || 'design'}
        options={Object.entries(purposes).map(([key, text]) => ({ value: key as DesignField['purpose'], label: uiText(text) }))}
        onChange={purpose => onChange(userDesignField({ ...value, purpose }))} />
    </Space>}
    <DesignMetadataLine id={descriptionId} items={metadata} />
  </section>
}
