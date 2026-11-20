import { ConfigProvider, Popover } from 'antd'
import { FilterOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import type { DesignScope } from '../../../services/generated'
import { WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'
import { DesignScopeEditor } from './DesignScopeEditor'

/** 整卡限制共用同一入口；只读时仍可查看，编辑继续沿用画布自动保存。 */
export function DesignScopePopover<T extends { scope?: DesignScope; source_locator?: string }>({ card, onChange, disabled, editorOpen, labelPrefix = '设计' }: { card: T; onChange: (card: T) => void; disabled?: boolean; editorOpen?: boolean; labelPrefix?: string }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLElement>(null)
  const count = Object.values(card.scope || {}).filter(value => value?.trim()).length
  useEffect(() => { if (!editorOpen) setOpen(false) }, [editorOpen])
  return <ConfigProvider componentDisabled={false}><Popover trigger="click" placement="bottomRight" open={open} onOpenChange={setOpen} getPopupContainer={node => node.closest<HTMLElement>('.design-preset-editor') || node.parentElement!} content={<div className="design-scope-panel" onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); setOpen(false); trigger.current?.focus() }
  }}>
    <DesignScopeEditor card={card} onChange={onChange} disabled={disabled} labelPrefix={labelPrefix} productionLabel="适用制作环节" />
    <p>描述整张设计卡的适用限制，随整卡传递；不会自动筛选或判断执行条件。</p>
  </div>}>
    <span className="design-scope-trigger"><WorkbenchIconButton ref={trigger} variant="quiet" label={`整卡适用限制${count ? ` · 已填写 ${count} 项` : ''}`} aria-expanded={open} icon={<FilterOutlined />} />{count > 0 && <i aria-hidden="true" />}</span>
  </Popover></ConfigProvider>
}
