import { useUiText } from '../../../../uiText'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiOutlined, CheckOutlined, DownOutlined, FileTextOutlined, PictureOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Dropdown, Input, Menu, Modal, Popover, Select, Typography } from 'antd'
import type { GetRef, InputRef } from 'antd'

export type ExperimentModelOption = { id: string; name: string }
export type ExperimentTemplateOption = { id: string; name: string; version: number; preview?: string; category?: string }
type OptionPanel = 'model' | 'add' | 'template'

type ExperimentOptionBarProps = {
  children: (controls: { modelControl: ReactNode; addControl: ReactNode }) => ReactNode
  referenceAction?: { label: string; onOpen: (trigger: HTMLButtonElement | null) => void }
  models: ExperimentModelOption[]
  templates: ExperimentTemplateOption[]
  modelId?: string
  selectedTemplate?: ExperimentTemplateOption
  modelsLoading?: boolean
  modelsFailed?: boolean
  onRefreshModels?: () => void
  templatesLoading?: boolean
  templatesFailed?: boolean
  disabled?: boolean
  modelLabel?: string
  modelFooter?: ReactNode
  onModelChange: (modelId?: string) => void
  onTemplateChange: (templateId?: string) => void
  onModelOpenChange?: (open: boolean) => void
  onTemplateOpenChange?: (open: boolean) => void
  onRefreshTemplates?: () => void
}

/** 共享模型列表与添加菜单；由输入框安排入口位置，互斥浮层只在这里管理。 */
export function ExperimentOptionBar({ children, referenceAction, models, templates, modelId, selectedTemplate,
  modelsLoading = false, modelsFailed = false, onRefreshModels, templatesLoading = false, templatesFailed = false,
  disabled = false, modelLabel = '模型', modelFooter, onModelChange, onTemplateChange, onModelOpenChange,
  onTemplateOpenChange, onRefreshTemplates,
}: ExperimentOptionBarProps) {
  const uiText = useUiText()
  const [openPanel, setOpenPanel] = useState<OptionPanel>()
  const [search, setSearch] = useState('')
  const modelTrigger = useRef<HTMLButtonElement>(null)
  const addTrigger = useRef<HTMLButtonElement>(null)
  const modelSearch = useRef<InputRef>(null)
  const modelPanel = useRef<HTMLDivElement>(null)
  const templateSelect = useRef<GetRef<typeof Select>>(null)
  // 列表晚于浮层到达时，仅接管仍停在入口或面板上的焦点，不打断用户的搜索。
  useEffect(() => {
    if (openPanel !== 'model' || modelsLoading) return
    if (document.activeElement !== modelTrigger.current && document.activeElement !== modelPanel.current) return
    if (models.length > 8) modelSearch.current?.focus()
    else modelPanel.current?.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"]')?.focus()
  }, [openPanel, modelsLoading, models.length])
  const selectedModel = useMemo(() => models.find(model => model.id === modelId), [modelId, models])
  const templateOptions = templates.map(template => ({ value: template.id,
    label: `${uiText(template.category ?? '提示词模板')} · ${template.name} · v${template.version}`, disabled: false }))
  if (selectedTemplate && !templates.some(template => template.id === selectedTemplate.id)) {
    templateOptions.push({ value: selectedTemplate.id, label: uiText("{{name}} · v{{version}}（本轮已选）", { name: selectedTemplate.name, version: selectedTemplate.version }), disabled: true })
  }
  const close = (panel: OptionPanel) => {
    setOpenPanel(current => current === panel ? undefined : current)
    if (panel === 'model') onModelOpenChange?.(false)
    if (panel === 'template') onTemplateOpenChange?.(false)
  }
  const open = (panel: OptionPanel) => {
    if (openPanel === 'model') onModelOpenChange?.(false)
    setOpenPanel(panel)
    if (panel === 'model') { setSearch(''); onModelOpenChange?.(true) }
    if (panel === 'template') onTemplateOpenChange?.(true)
  }
  const closeTemplate = () => { close('template'); addTrigger.current?.focus() }
  const modelControl = <Popover trigger="click" placement="topLeft" open={openPanel === 'model'}
    classNames={{ root: "experiment-model-popup" }}
    onOpenChange={visible => visible ? open('model') : close('model')}
    afterOpenChange={visible => {
      if (visible) {
        if (models.length > 8) modelSearch.current?.focus()
        else (modelPanel.current?.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"]') ?? modelPanel.current)?.focus()
      }
    }}
    content={<div ref={modelPanel} tabIndex={-1} className="experiment-model-panel" onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close('model'); modelTrigger.current?.focus() }
    }}>
      <div className="experiment-model-heading"><Typography.Text strong>{uiText(modelLabel)}</Typography.Text>
        {onRefreshModels && !modelsFailed && <Button type="text" size="small" loading={modelsLoading} onClick={onRefreshModels}>{uiText("刷新模型")}</Button>}
      </div>
      {modelsFailed && <Alert type="error" message={uiText("加载模型失败")} action={<Button size="small" onClick={onRefreshModels}>{uiText("重试读取模型")}</Button>} />}
      {modelsLoading && <p role="status">{uiText("正在加载模型…")}</p>}
      {!modelsLoading && !modelsFailed && !models.length && <p role="status">{uiText("暂无可选模型")}</p>}
      {models.length > 8 && <Input ref={modelSearch} aria-label={uiText("搜索模型")} placeholder={uiText("搜索模型")} value={search} onChange={event => setSearch(event.target.value)}
        onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); modelPanel.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus() } }} />}
      <Menu selectable selectedKeys={modelId ? [modelId] : []} aria-label={uiText(modelLabel)}
        items={models.filter(model => model.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(model => ({
          key: model.id, role: 'menuitemradio', 'aria-checked': model.id === modelId,
          label: <span className="experiment-model-row"><span>{model.name}</span>{model.id === modelId && <CheckOutlined aria-hidden="true" />}</span>,
        }))}
        onClick={({ key }) => { onModelChange(key); close('model'); modelTrigger.current?.focus() }} />
      {models.length > 0 && !models.some(model => model.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) && <p role="status">{uiText("没有匹配的模型")}</p>}
      {modelFooter}
    </div>}>
    <Button ref={modelTrigger} type="text" onKeyDown={event => {
      if (event.key === 'Escape' && openPanel === 'model') { event.preventDefault(); event.stopPropagation(); close('model'); modelTrigger.current?.focus() }
    }} aria-expanded={openPanel === 'model'} aria-haspopup="menu"
      icon={<ApiOutlined aria-hidden="true" />} disabled={disabled} title={selectedModel?.name}
      className="experiment-model-trigger"><span>{selectedModel?.name ?? (modelId ? uiText("已选模型") : uiText("选择模型"))}</span><DownOutlined aria-hidden="true" /></Button>
  </Popover>
  const addControl = <Dropdown trigger={['click']} placement="topRight" open={openPanel === 'add'}
    onOpenChange={visible => visible ? open('add') : close('add')} autoFocus
    classNames={{ root: "experiment-add-menu" }}
    menu={{ items: [
      { key: 'template', label: uiText("选择提示词模板"), icon: <FileTextOutlined aria-hidden="true" /> },
      ...(referenceAction ? [{ key: 'references', label: referenceAction.label, icon: <PictureOutlined aria-hidden="true" /> }] : []),
    ], onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close('add'); addTrigger.current?.focus() } },
    onClick: ({ key }) => {
      if (key === 'template') open('template')
      else { close('add'); referenceAction?.onOpen(addTrigger.current) }
    } }}>
    <Button ref={addTrigger} type="text" className="experiment-add-trigger" aria-label={uiText("添加内容")} aria-haspopup="menu"
      aria-expanded={openPanel === 'add'} disabled={disabled} icon={<PlusOutlined aria-hidden="true" />} />
  </Dropdown>
  return <>
    {children({ modelControl, addControl })}
    <Modal title={uiText("选择提示词模板")} open={openPanel === 'template'} onCancel={closeTemplate} footer={null}
      afterOpenChange={visible => { if (visible) templateSelect.current?.focus() }} afterClose={() => addTrigger.current?.focus()}
      width={480} className="experiment-template-picker">
      {templatesFailed && <Alert type="error" message={uiText("加载提示词模板失败")} action={<Button onClick={onRefreshTemplates}>{uiText("重试")}</Button>} />}
      {onRefreshTemplates && !templatesFailed && <Button type="text" loading={templatesLoading} onClick={onRefreshTemplates}>{uiText("刷新模板")}</Button>}
      <Select ref={templateSelect} aria-label={uiText("提示词模板")} allowClear showSearch optionFilterProp="label" className="w-full mt-2"
        placeholder={uiText("自由输入或选择提示词模板")} loading={templatesLoading} value={selectedTemplate?.id}
        notFoundContent={templatesLoading ? uiText("正在加载提示词模板…") : templatesFailed ? uiText("提示词模板暂不可用") : uiText("暂无提示词模板")}
        onChange={value => { onTemplateChange(value); closeTemplate() }} options={templateOptions} />
      {templatesLoading ? <p role="status">{uiText("正在加载提示词模板…")}</p> : !templatesFailed && !templates.length ? <p role="status">{uiText("暂无提示词模板")}</p> :
        <p className="experiment-reference-hint">{selectedTemplate?.preview || uiText("选择模板后可编辑变量；不使用模板时直接自由输入。")}</p>}
    </Modal>
  </>
}
