/** Shared compact selectors for model and prompt-template experiment options. */
import { useMemo } from 'react'
import { ApiOutlined, FileTextOutlined } from '@ant-design/icons'
import { Button, Popover, Select, Space, Tag, Typography } from 'antd'

export type ExperimentModelOption = { id: string; name: string }
export type ExperimentTemplateOption = { id: string; name: string; version: number; preview?: string; category?: string }

type ExperimentOptionBarProps = {
  models: ExperimentModelOption[]
  templates: ExperimentTemplateOption[]
  modelId?: string
  templateId?: string
  modelsLoading?: boolean
  templatesLoading?: boolean
  disabled?: boolean
  modelLabel?: string
  modelPlaceholder?: string
  onModelChange: (modelId?: string) => void
  onTemplateChange: (templateId?: string) => void
  onModelOpenChange?: (open: boolean) => void
  onTemplateOpenChange?: (open: boolean) => void
}

/** Presents experiment configuration inside popovers so the composer stays focused on input. */
export function ExperimentOptionBar({
  models,
  templates,
  modelId,
  templateId,
  modelsLoading = false,
  templatesLoading = false,
  disabled = false,
  modelLabel = '模型',
  modelPlaceholder = '选择已登记的模型',
  onModelChange,
  onTemplateChange,
  onModelOpenChange,
  onTemplateOpenChange,
}: ExperimentOptionBarProps) {
  const selectedModel = useMemo(() => models.find((model) => model.id === modelId), [modelId, models])
  const selectedTemplate = useMemo(() => templates.find((template) => template.id === templateId), [templateId, templates])

  return (
    <Space wrap size="small">
      <Popover
        trigger="click"
        onOpenChange={onModelOpenChange}
        content={
          <div className="w-72">
            <Typography.Text strong>{modelLabel}</Typography.Text>
            <Select
              className="w-full mt-2"
              placeholder={modelPlaceholder}
              loading={modelsLoading}
              value={modelId}
              onChange={onModelChange}
              options={models.map((model) => ({ value: model.id, label: model.name }))}
            />
          </div>
        }
      >
        <Button icon={<ApiOutlined />} disabled={disabled}>
          {selectedModel?.name ?? '选择模型'}
        </Button>
      </Popover>
      <Popover
        trigger="click"
        onOpenChange={onTemplateOpenChange}
        content={
          <div className="w-80">
            <Typography.Text strong>提示词来源</Typography.Text>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              className="w-full mt-2"
              placeholder="自由输入或选择提示词模板"
              loading={templatesLoading}
              value={templateId}
              onChange={onTemplateChange}
              options={templates.map((template) => ({
                value: template.id,
                label: `${template.category ?? '提示词模板'} · ${template.name} · v${template.version}`,
              }))}
            />
            {selectedTemplate ? (
              <div className="mt-2 text-xs text-gray-500">
                <Tag>{selectedTemplate.category || '提示词模板'}</Tag>
                {selectedTemplate.preview || '通过变量表单配置本轮提示词。'}
              </div>
            ) : (
              <Typography.Paragraph type="secondary" className="mt-2 mb-0 text-xs">未选择模板时，可直接自由输入提示词。</Typography.Paragraph>
            )}
          </div>
        }
      >
        <Button icon={<FileTextOutlined />} disabled={disabled}>
          {selectedTemplate ? `${selectedTemplate.name} · v${selectedTemplate.version}` : '自由输入'}
        </Button>
      </Popover>
    </Space>
  )
}
