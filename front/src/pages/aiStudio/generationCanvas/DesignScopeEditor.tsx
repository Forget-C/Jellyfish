import { useUiText } from '../../../uiText'
import { DesignMetadataLine } from './DesignMetadataLine'
import { AutoComplete, Input } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { DesignScope } from '../../../services/generated'
import { designPhaseLabel } from './designScope'

function ScopeInput({ label, placeholder, options, value, disabled, open, onOpenChange, onChange }: { open: boolean; onOpenChange: (open: boolean) => void; label: string; placeholder: string; options: string[]; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const uiText = useUiText()
  return <div onFocusCapture={() => onOpenChange(true)} onClick={event => { if (event.target instanceof HTMLInputElement) onOpenChange(true) }} onKeyDownCapture={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); onOpenChange(false) }
  }} onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); onOpenChange(false) } }}>
    <AutoComplete transitionName="" classNames={{ popup: { root: "design-scope-dropdown" } }} value={options.includes(value) ? uiText(value) : value} disabled={disabled} open={!disabled && open} onOpenChange={onOpenChange} onBlur={() => onOpenChange(false)} defaultActiveFirstOption={false} allowClear options={options.map(option => ({ value: option, label: uiText(option) }))} onChange={onChange} filterOption={(input, option) => [option?.value, option?.label].some(text => String(text).toLowerCase().includes(input.toLowerCase()))} style={{ width: '100%' }}>
      <Input aria-label={label} placeholder={placeholder} />
    </AutoComplete>
  </div>
}

/** 用户选择或输入才更新限制；默认提示不写入数据，来源只读展示。 */
export function DesignScopeEditor<T extends { scope?: DesignScope; source_locator?: string }>({ card, onChange, disabled, labelPrefix = '设计', productionLabel = '制作阶段' }: { card: T; onChange: (card: T) => void; disabled?: boolean; labelPrefix?: string; productionLabel?: string }) {
  const uiText = useUiText()
  const [active, setActive] = useState<keyof DesignScope>()
  const root = useRef<HTMLElement>(null)
  const changeOpen = (key: keyof DesignScope, open: boolean) => setActive(current => open ? key : current === key ? undefined : current)
  useEffect(() => {
    if (!active) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (root.current?.contains(target)) return
      // 选项弹层通过 portal 挂在范围区外，点击当前菜单仍属于内部操作。
      const listId = root.current?.querySelector('[aria-expanded="true"]')?.getAttribute('aria-controls')
      const popup = listId ? document.getElementById(listId)?.closest('.design-scope-dropdown') : undefined
      if (!popup?.contains(target)) setActive(undefined)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    return () => document.removeEventListener('pointerdown', closeOutside, true)
  }, [active])
  const update = (key: keyof DesignScope, value: string) => onChange({ ...card, scope: { ...card.scope, [key]: key === 'phase' && !value ? null : value } })
  return <section ref={root} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(undefined) }} aria-label={uiText("范围与来源")} className="design-preset-fields static-design-scope">
    <label>{uiText("内容适用范围")}<ScopeInput open={active === 'description'} onOpenChange={open => changeOpen('description', open)} label={uiText("{{labelPrefix}}内容适用范围", { labelPrefix: uiText(labelPrefix) })} placeholder={uiText("不限定范围")} options={['全部内容', '主体内容', '背景内容', '动作过程', '最终结果']} value={card.scope?.description || ''} disabled={disabled} onChange={value => update('description', value)} /></label>
    <label>{uiText(productionLabel)}<ScopeInput open={active === 'phase'} onOpenChange={open => changeOpen('phase', open)} label={uiText("{{prefix}}{{phase}}", { prefix: uiText(labelPrefix), phase: uiText(productionLabel) })} placeholder={uiText("不限定阶段")} options={['画面／视频', '声音', '后期']} value={designPhaseLabel(card.scope?.phase)} disabled={disabled} onChange={value => update('phase', value)} /></label>
    <label>{uiText("适用条件")}<ScopeInput open={active === 'condition'} onOpenChange={open => changeOpen('condition', open)} label={uiText("{{labelPrefix}}适用条件", { labelPrefix: uiText(labelPrefix) })} placeholder={uiText("无额外条件")} options={['全程适用', '对象出现时', '动作发生时', '动作结束后']} value={card.scope?.condition || ''} disabled={disabled} onChange={value => update('condition', value)} /></label>
    {card.source_locator?.trim() && <DesignMetadataLine items={[{ label: uiText("卡片原始来源"), text: card.source_locator }]} />}
  </section>
}
