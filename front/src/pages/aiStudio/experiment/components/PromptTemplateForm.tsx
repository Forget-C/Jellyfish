/** Form-based rendering of a reusable prompt template's declared variables. */
import { useUiText } from '../../../../uiText'
import { useId } from 'react'
import { Button, Collapse, Form, Input, Typography } from 'antd'
import { EditOutlined } from '@ant-design/icons'

export type PromptTemplateFormTemplate = {
  id: string
  name: string
  version: number
  content: string
  preview?: string
  variables?: string[]
  variable_defaults?: Record<string, string>
}

type PromptTemplateDefaults = Pick<PromptTemplateFormTemplate, 'variables' | 'variable_defaults'>

type PromptTemplateFormProps = {
  template: PromptTemplateFormTemplate
  values: Record<string, string>
  disabled?: boolean
  onValuesChange: (values: Record<string, string>) => void
  onUseFreeInput: () => void
}

/** Replaces the {{variable}} placeholders in a template using the values of the current experiment. */
export function renderPromptTemplate(content: string, values: Record<string, string>): string {
  return content.replace(/{{\s*([^{}\s]+)\s*}}/g, (_match, variableName: string) => values[variableName] ?? '')
}

export function getPromptTemplateVariables(template: PromptTemplateDefaults): string[] {
  return Array.from(new Set([...(template.variables ?? []), ...Object.keys(template.variable_defaults ?? {})]))
}

/** Creates the initial variable map for one non-persistent template experiment. */
export function createPromptTemplateValues(template: PromptTemplateDefaults): Record<string, string> {
  const defaults = template.variable_defaults ?? {}
  return Object.fromEntries(getPromptTemplateVariables(template).map(variable => [variable, defaults[variable] ?? '']))
}

/** Provides a non-destructive form editor for template variables and a final rendered-prompt preview. */
export function PromptTemplateForm({ template, values, disabled = false, onValuesChange, onUseFreeInput }: PromptTemplateFormProps) {
  const uiText = useUiText()
  const prefix = useId()
  const variables = getPromptTemplateVariables(template)
  const renderedPrompt = renderPromptTemplate(template.content, values)

  return (
    <div className="experiment-template-form">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div>
          <Typography.Text strong>{template.name}</Typography.Text>
          <Typography.Text type="secondary" className="ml-2">v{template.version}</Typography.Text>
          {template.preview ? <Typography.Paragraph type="secondary" className="mb-0 mt-1 text-xs">{template.preview}</Typography.Paragraph> : null}
        </div>
        <Button icon={<EditOutlined aria-hidden="true" />} disabled={disabled} onClick={onUseFreeInput}>
          {uiText("转为自由输入")}
        </Button>
      </div>
      {variables.length > 0 ? (
        <Form layout="vertical" requiredMark={false}>
          {variables.map((variable, index) => (
            <Form.Item key={variable} label={variable} htmlFor={`${prefix}-${index}`} className="mb-3">
              <Input.TextArea
                id={`${prefix}-${index}`}
                value={values[variable] ?? ''}
                placeholder={uiText("填写 {{variable}}", { variable })}
                autoSize={{ minRows: 1, maxRows: 4 }}
                disabled={disabled}
                onChange={(event) => onValuesChange({ ...values, [variable]: event.target.value })}
              />
            </Form.Item>
          ))}
        </Form>
      ) : (
        <Typography.Paragraph type="secondary">{uiText("该模板没有可配置变量，将按下方最终提示词直接发送。")}</Typography.Paragraph>
      )}
      <Collapse
        size="small"
        items={[{ key: 'rendered', label: uiText("查看最终提示词"), children: <Typography.Paragraph className="mb-0 whitespace-pre-wrap">{renderedPrompt || uiText("模板渲染后为空")}</Typography.Paragraph> }]}
      />
    </div>
  )
}
