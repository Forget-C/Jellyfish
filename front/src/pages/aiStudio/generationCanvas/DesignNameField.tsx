import { useId } from 'react'
import { Input, Typography } from 'antd'

/** 名称跨编辑模式常驻，示例仅为 placeholder；错误状态由业务方提供。 */
export function DesignNameField({ label, placeholder, value, disabled, error, onChange }: { label: string; placeholder: string; value?: string; disabled?: boolean; error?: string; onChange: (value: string) => void }) {
  const id = useId()
  return <section className="design-name-field design-preset-fields static-design-scope"><div>
    <label htmlFor={id}>{label}<Input id={id} disabled={disabled} value={value} placeholder={placeholder} status={error ? 'error' : undefined} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={event => onChange(event.target.value)} /></label>
    {error && <Typography.Text type="danger" id={`${id}-error`} role="alert" className="design-reference-issue">{error}</Typography.Text>}
  </div></section>
}
