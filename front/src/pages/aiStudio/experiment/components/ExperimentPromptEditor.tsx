/** Shared template-variable or free-text prompt editor for experiment laboratories. */
import { Input } from 'antd'
import { useSyncExternalStore } from 'react'
import { PromptTemplateForm } from './PromptTemplateForm'
import type { PromptTemplateFormTemplate } from './PromptTemplateForm'

type ExperimentPromptEditorProps = {
  template: PromptTemplateFormTemplate | null
  templateValues: Record<string, string>
  draft: string
  placeholder: string
  label: string
  disabled?: boolean
  submitOnEnter?: boolean
  onDraftChange: (value: string) => void
  onTemplateValuesChange: (values: Record<string, string>) => void
  onUseFreeInput: (prompt: string) => void
  onSubmit?: () => void
}

const compactQuery = '(max-height: 540px)'
const isCompact = () => window.matchMedia(compactQuery).matches
const subscribeToHeight = (update: () => void) => {
  const query = window.matchMedia(compactQuery)
  query.addEventListener('change', update)
  return () => query.removeEventListener('change', update)
}

/** Keeps template rendering and free-text editing visually and behaviorally consistent between labs. */
export function ExperimentPromptEditor({
  template,
  templateValues,
  draft,
  placeholder,
  label,
  disabled = false,
  submitOnEnter = false,
  onDraftChange,
  onTemplateValuesChange,
  onUseFreeInput,
  onSubmit,
}: ExperimentPromptEditorProps) {
  const compact = useSyncExternalStore(subscribeToHeight, isCompact)
  if (template) {
    return <PromptTemplateForm template={template} values={templateValues} disabled={disabled} onValuesChange={onTemplateValuesChange} onUseFreeInput={onUseFreeInput} />
  }
  return (
    <Input.TextArea
      id="experiment-prompt-editor"
      aria-label={label}
      bordered={false}
      value={draft}
      onChange={(event) => onDraftChange(event.target.value)}
      onPressEnter={submitOnEnter ? (event) => {
        if (!event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
          event.preventDefault()
          onSubmit?.()
        }
      } : undefined}
      placeholder={placeholder}
      autoSize={{ minRows: compact ? 2 : 3, maxRows: 6 }}
      disabled={disabled}
      className="experiment-prompt-input"
    />
  )
}
