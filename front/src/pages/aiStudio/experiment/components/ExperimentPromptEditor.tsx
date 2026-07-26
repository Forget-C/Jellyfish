/** Shared template-variable or free-text prompt editor for experiment laboratories. */
import { Input } from 'antd'
import { PromptTemplateForm } from './PromptTemplateForm'
import type { PromptTemplateFormTemplate } from './PromptTemplateForm'

type ExperimentPromptEditorProps = {
  template: PromptTemplateFormTemplate | null
  templateValues: Record<string, string>
  draft: string
  placeholder: string
  minRows: number
  disabled?: boolean
  submitOnEnter?: boolean
  onDraftChange: (value: string) => void
  onTemplateValuesChange: (values: Record<string, string>) => void
  onUseFreeInput: (prompt: string) => void
  onSubmit?: () => void
}

/** Keeps template rendering and free-text editing visually and behaviorally consistent between labs. */
export function ExperimentPromptEditor({
  template,
  templateValues,
  draft,
  placeholder,
  minRows,
  disabled = false,
  submitOnEnter = false,
  onDraftChange,
  onTemplateValuesChange,
  onUseFreeInput,
  onSubmit,
}: ExperimentPromptEditorProps) {
  if (template) {
    return <PromptTemplateForm template={template} values={templateValues} disabled={disabled} onValuesChange={onTemplateValuesChange} onUseFreeInput={onUseFreeInput} />
  }
  return (
    <Input.TextArea
      id="experiment-prompt-editor"
      bordered={false}
      value={draft}
      onChange={(event) => onDraftChange(event.target.value)}
      onPressEnter={submitOnEnter ? (event) => {
        if (!event.shiftKey) {
          event.preventDefault()
          onSubmit?.()
        }
      } : undefined}
      placeholder={placeholder}
      autoSize={{ minRows, maxRows: 10 }}
      disabled={disabled}
      className="resize-none px-0 text-base text-slate-900 placeholder:text-slate-400"
    />
  )
}
