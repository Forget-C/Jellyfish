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
  selectedTemplate?: ExperimentTemplateOption
  modelsLoading?: boolean
  templatesLoading?: boolean
  templatesFailed?: boolean
  disabled?: boolean
  modelLabel?: string
  modelPlaceholder?: string
  onModelChange: (modelId?: string) => void
  onTemplateChange: (templateId?: string) => void
  onModelOpenChange?: (open: boolean) => void
  onTemplateOpenChange?: (open: boolean) => void
  onRefreshTemplates?: () => void
}

/** Presents experiment configuration inside popovers so the composer stays focused on input. */
export function ExperimentOptionBar({
  models,
  templates,
  modelId,
  selectedTemplate,
  modelsLoading = false,
  templatesLoading = false,
  templatesFailed = false,
  disabled = false,
  modelLabel = '模型',
  modelPlaceholder = '选择已登记的模型',
  onModelChange,
  onTemplateChange,
  onModelOpenChange,
  onTemplateOpenChange,
  onRefreshTemplates,
}: ExperimentOptionBarProps) {
  const selectedModel = useMemo(() => models.find((model) => model.id === modelId), [modelId, models])
  const templateOptions: { value: string; label: string; disabled?: boolean }[] = templates.map(template => ({
    value: template.id,
    label: `${template.category ?? '提示词模板'} · ${template.name} · v${template.version}`,
  }))
  if (selectedTemplate && !templates.some(template => template.id === selectedTemplate.id)) {
    templateOptions.push({
      value: selectedTemplate.id,
      label: `${selectedTemplate.name} · v${selectedTemplate.version}（本轮已选）`,
      disabled: true,
    })
  }

  return (
    <Space wrap size="small">
      <Popover
        trigger="click"
        onOpenChange={onModelOpenChange}
        content={
          <div className="w-72 max-w-[calc(100vw-64px)]">
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
        <Button icon={<ApiOutlined aria-hidden="true" />} disabled={disabled} title={selectedModel?.name} className="experiment-option-button">
          <span>{selectedModel?.name ?? '选择模型'}</span>
        </Button>
      </Popover>
      <Popover
        trigger="click"
        onOpenChange={onTemplateOpenChange}
        content={
          <div className="w-80 max-w-[calc(100vw-64px)]">
            <div className="flex items-center justify-between gap-2">
              <Typography.Text strong>提示词来源</Typography.Text>
              {onRefreshTemplates && !templatesFailed && (
                <Button type="text" size="small" loading={templatesLoading} onClick={onRefreshTemplates}>刷新模板</Button>
              )}
            </div>
            {templatesFailed && (
              <div className="mt-2 flex items-center justify-between gap-2" role="alert">
                <Typography.Text type="danger">加载提示词模板失败</Typography.Text>
                <Button size="small" onClick={onRefreshTemplates}>重试</Button>
              </div>
            )}
            <Select
              aria-label="提示词模板"
              allowClear
              showSearch
              optionFilterProp="label"
              className="w-full mt-2"
              placeholder="自由输入或选择提示词模板"
              loading={templatesLoading}
              value={selectedTemplate?.id}
              notFoundContent={templatesLoading ? '正在加载提示词模板…' : templatesFailed ? '提示词模板暂不可用' : '暂无提示词模板'}
              onChange={onTemplateChange}
              options={templateOptions}
            />
            {selectedTemplate ? (
              <div className="mt-2 text-xs text-gray-500">
                <Tag>{selectedTemplate.category || '提示词模板'}</Tag>
                {selectedTemplate.preview || '通过编辑变量配置本轮提示词。'}
              </div>
            ) : templatesLoading ? (
              <Typography.Paragraph type="secondary" role="status" className="mt-2 mb-0 text-xs">正在加载提示词模板…</Typography.Paragraph>
            ) : !templatesFailed && templates.length === 0 ? (
              <Typography.Paragraph type="secondary" role="status" className="mt-2 mb-0 text-xs">暂无提示词模板</Typography.Paragraph>
            ) : (
              <Typography.Paragraph type="secondary" className="mt-2 mb-0 text-xs">未选择模板时，可直接自由输入提示词。</Typography.Paragraph>
            )}
          </div>
        }
      >
        <Button icon={<FileTextOutlined aria-hidden="true" />} disabled={disabled} title={selectedTemplate ? `${selectedTemplate.name} · v${selectedTemplate.version}` : undefined} className="experiment-option-button">
          <span>{selectedTemplate ? `${selectedTemplate.name} · v${selectedTemplate.version}` : '自由输入'}</span>
        </Button>
      </Popover>
    </Space>
  )
}
