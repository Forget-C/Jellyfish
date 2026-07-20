/** Form-based rendering of a reusable prompt template's declared variables. */
import { useMemo } from 'react'
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
  onUseFreeInput: (renderedPrompt: string) => void
}

/** Replaces the {{variable}} placeholders in a template using the values of the current experiment. */
export function renderPromptTemplate(content: string, values: Record<string, string>): string {
  return content.replace(/{{\s*([^{}\s]+)\s*}}/g, (_match, variableName: string) => values[variableName] ?? '')
}

/** Creates the initial variable map for one non-persistent template experiment. */
export function createPromptTemplateValues(template: PromptTemplateDefaults): Record<string, string> {
  const defaults = template.variable_defaults ?? {}
  return Array.from(new Set([...(template.variables ?? []), ...Object.keys(defaults)])).reduce<Record<string, string>>(
    (result, variable) => ({ ...result, [variable]: defaults[variable] ?? '' }),
    {},
  )
}

/** Provides a non-destructive form editor for template variables and a final rendered-prompt preview. */
export function PromptTemplateForm({ template, values, disabled = false, onValuesChange, onUseFreeInput }: PromptTemplateFormProps) {
  const variables = useMemo(
    () => Array.from(new Set([...(template.variables ?? []), ...Object.keys(template.variable_defaults ?? {})])),
    [template.variable_defaults, template.variables],
  )
  const renderedPrompt = useMemo(() => renderPromptTemplate(template.content, values), [template.content, values])

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div>
          <Typography.Text strong>{template.name}</Typography.Text>
          <Typography.Text type="secondary" className="ml-2">v{template.version}</Typography.Text>
          {template.preview ? <Typography.Paragraph type="secondary" className="mb-0 mt-1 text-xs">{template.preview}</Typography.Paragraph> : null}
        </div>
        <Button size="small" icon={<EditOutlined />} disabled={disabled} onClick={() => onUseFreeInput(renderedPrompt)}>
          转为自由输入
        </Button>
      </div>
      {variables.length > 0 ? (
        <Form layout="vertical" requiredMark={false}>
          {variables.map((variable) => (
            <Form.Item key={variable} label={variable} className="mb-3">
              <Input.TextArea
                value={values[variable] ?? ''}
                placeholder={`填写 ${variable}`}
                autoSize={{ minRows: 1, maxRows: 4 }}
                disabled={disabled}
                onChange={(event) => onValuesChange({ ...values, [variable]: event.target.value })}
              />
            </Form.Item>
          ))}
        </Form>
      ) : (
        <Typography.Paragraph type="secondary">该模板没有可配置变量，将按下方最终提示词直接发送。</Typography.Paragraph>
      )}
      <Collapse
        size="small"
        items={[{ key: 'rendered', label: '查看最终提示词', children: <Typography.Paragraph className="mb-0 whitespace-pre-wrap">{renderedPrompt || '模板渲染后为空'}</Typography.Paragraph> }]}
      />
    </div>
  )
}
