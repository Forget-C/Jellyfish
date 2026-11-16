/** Shared template-variable or free-text prompt editor for experiment laboratories. */
import { useExperimentLeaveStatus } from '../ExperimentLeaveGuard'
import { Button, Drawer, Input, Modal } from 'antd'
import { useCallback, useId, useState, useSyncExternalStore } from 'react'
import { focusExperimentPromptEditor } from '../experimentInputSnapshot'
import { getPromptTemplateVariables, PromptTemplateForm, renderPromptTemplate } from './PromptTemplateForm'
import type { PromptTemplateFormTemplate } from './PromptTemplateForm'
import './experiment-template.css'

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
    return <TemplateVariableEditor
      key={template.id}
      template={template}
      values={templateValues}
      disabled={disabled}
      onApply={onTemplateValuesChange}
      onUseFreeInput={onUseFreeInput}
    />
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

type TemplateVariableEditorProps = {
  template: PromptTemplateFormTemplate
  values: Record<string, string>
  disabled: boolean
  onApply: (values: Record<string, string>) => void
  onUseFreeInput: (prompt: string) => void
}

/** Panel edits stay local until the user applies them or confirms conversion. */
function TemplateVariableEditor({ template, values, disabled, onApply, onUseFreeInput }: TemplateVariableEditorProps) {
  const [panelValues, setPanelValues] = useState<Record<string, string> | null>(null)
  const [converting, setConverting] = useState(false)
  useExperimentLeaveStatus(panelValues !== null && getPromptTemplateVariables(template).some(variable => panelValues[variable] !== values[variable]))
  const titleId = useId()
  // The installed Drawer does not forward aria-labelledby to its dialog.
  const labelDialog = useCallback((title: HTMLSpanElement | null) => {
    title?.closest('[role="dialog"]')?.setAttribute('aria-labelledby', titleId)
  }, [titleId])
  const variables = getPromptTemplateVariables(template)
  const filledCount = variables.filter(variable => Boolean(values[variable]?.trim())).length

  const closePanel = () => {
    if (!converting) setPanelValues(null)
  }

  const apply = () => {
    if (disabled || !panelValues) return
    onApply(panelValues)
    closePanel()
  }

  const convert = () => {
    if (disabled || !panelValues) return
    onUseFreeInput(renderPromptTemplate(template.content, panelValues))
    setConverting(false)
    setPanelValues(null)
    focusExperimentPromptEditor()
  }

  return (
    <>
      <div className="experiment-template-summary">
        <div className="experiment-template-summary-text">
          <div className="experiment-template-summary-name" title={template.name}>{template.name}</div>
          <div className="experiment-template-summary-meta">
            <span>v{template.version}</span>
            <span>{variables.length ? `已填 ${filledCount}／共 ${variables.length} 个变量` : '无需填写变量'}</span>
          </div>
        </div>
        <Button disabled={disabled} onClick={() => setPanelValues({ ...values })}>编辑变量</Button>
      </div>
      <Drawer
        title={<span ref={labelDialog} id={titleId}>编辑模板变量</span>}
        rootClassName="experiment-template-drawer app-detail-drawer"
        width="var(--experiment-template-drawer-width)"
        open={panelValues !== null}
        onClose={closePanel}
        keyboard={!converting}
        maskClosable={!converting}
        footer={<div className="experiment-template-drawer-actions">
          <Button onClick={closePanel}>取消</Button>
          <Button type="primary" disabled={disabled} onClick={apply}>应用</Button>
        </div>}
      >
        <PromptTemplateForm
          template={template}
          values={panelValues ?? values}
          disabled={disabled}
          onValuesChange={setPanelValues}
          onUseFreeInput={() => setConverting(true)}
        />
      </Drawer>
      <Modal
        title="转为自由输入？"
        open={converting}
        okText="转换"
        onOk={convert}
        onCancel={() => setConverting(false)}
        okButtonProps={{ disabled }}
      >
        <p>将当前变量渲染成可编辑的提示词，替换当前输入并退出模板模式。</p>
      </Modal>
    </>
  )
}
