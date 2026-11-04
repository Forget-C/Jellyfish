import { DesignReferenceContext } from './DesignReferenceEditor'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ConfigProvider, Switch } from 'antd'
import { ArrowLeftOutlined, SettingOutlined, UndoOutlined } from '@ant-design/icons'
import type { DesignField, ReferenceDesignField } from '../../../services/generated'
import { CanvasEditorFooter, CanvasEditorHeader } from './CanvasCardEditor'
import { DesignMetadataVisible } from './DesignEditorFrame'
import { PresetIllustration } from './VisualPresetPicker'
import type { VisualPreset } from './visualPresets'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import { WorkbenchDialogActions } from '../directing/ui/WorkbenchModal'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import './designPresetEditor.css'

type Props = {
  fields: Record<string, DesignField | null | undefined>; labels: Record<string, string>; presets: VisualPreset[];
  children: ReactNode; candidates?: ReactNode; relations?: ReactNode; direct?: boolean; current: string; disabled?: boolean; editorOpen?: boolean;
  onApply: (preset: VisualPreset) => void | boolean; onUndo?: () => void;
}
const states: Record<string, string> = { empty: '未填写', proposal: '提议', fact: '事实', undecided: '待确定', absent: '明确没有', not_applicable: '不适用' }
const purposes: Record<string, string> = { background: '背景', design: '设计', constraint: '约束' }
const describe = (value?: ReferenceDesignField | null) => value ? `${value.text || '无正文'} · 状态：${states[value.state || 'empty']} · 用途：${purposes[value.purpose || ''] || '未指定'} · 来源：${value.source_locator || '未指定'}${value.document?.segments?.some(segment => segment.kind === 'reference') ? ' · 含引用（应用后替换）' : ''}` : '未填写'

/** Shared preset-first session; only explicit application changes the caller's saved card. */
export function DesignPresetEditor({ fields, labels, presets, children, candidates, relations, direct = false, current, disabled, editorOpen = true, onApply, onUndo }: Props) {
  const references = useContext(DesignReferenceContext)
  const owner = useRef<HTMLDivElement>(null)
  const header = useContext(CanvasEditorHeader), footer = useContext(CanvasEditorFooter)
  const [advanced, setAdvanced] = useState(direct), [metadata, setMetadata] = useState(false)
  const [selected, setSelected] = useState<VisualPreset>(), [compare, setCompare] = useState<VisualPreset>()
  const [notice, setNotice] = useState('')
  const modeButton = useRef<HTMLElement>(null)
  useEffect(() => { if (!editorOpen) { setAdvanced(direct); setMetadata(false); setSelected(undefined); setCompare(undefined); setNotice('') } }, [editorOpen, direct])
  useEffect(() => {
    if (!references?.targetField || !editorOpen) return
    setAdvanced(true)
    let frame = 0, attempts = 0, settled = 0, scrolled = false
    const focusField = () => {
      const field = owner.current?.querySelector<HTMLElement>(`[data-design-field="${CSS.escape(references.targetField!.fieldId)}"]`)
      if (field && !field.closest('[inert]') && field.getClientRects().length) {
        if (!scrolled) { field.scrollIntoView({ block: 'nearest' }); scrolled = true }
        field.tabIndex = -1
        const input = field.querySelector<HTMLElement>('[role="textbox"]:not([aria-readonly="true"])') || field
        if (document.activeElement === input) settled += 1
        else { input.focus({ preventScroll: true }); settled = 0 }
        if (settled >= 3) return
      }
      if (++attempts < 90) frame = requestAnimationFrame(focusField)
    }
    frame = requestAnimationFrame(focusField)
    return () => cancelAnimationFrame(frame)
  }, [references?.targetField, editorOpen])
  const savedFields = JSON.stringify(fields)
  useEffect(() => { setNotice('') }, [savedFields])
  // Presets own only their declared fields; custom notes outside them do not erase the applied preview.
  const applied = presets.find(preset => Object.entries(preset.fields).every(([key, expected]) => {
    const actual = fields[key] as ReferenceDesignField
    if (actual?.document?.segments?.some(segment => segment.kind === 'reference')) return false
    return Object.entries(expected || {}).every(([name, value]) => (name === 'text' && actual?.document ? actual.document.segments?.map(segment => segment.kind === 'text' ? segment.text : '').join('') || '' : actual?.[name as keyof DesignField]) === value)
  }))
  const preview = selected || applied
  const hasAdditionalConfiguration = applied && Object.keys(labels).some(key => {
    if (applied.fields[key as keyof typeof applied.fields]) return false
    const field = fields[key] as ReferenceDesignField
    return !!field && (!!field.text?.trim() || field.state && field.state !== 'empty' || !!field.source_locator || ['constraint', 'background'].includes(field.purpose || '') || field.document?.segments?.some(segment => segment.kind === 'reference' || segment.text?.trim()))
  })
  const matched = hasAdditionalConfiguration ? undefined : applied
  const changes = preview ? Object.entries(preview.fields).flatMap(([key, value]) => {
    const before = fields[key] as ReferenceDesignField, after = { ...before, ...value, ...(before?.document ? { document: null } : {}) }
    return JSON.stringify(before || {}) === JSON.stringify(after) ? [] : [{ key, before, after, populated: !!before && (!!before.text?.trim() || before.state !== 'empty' && !!before.state || !!before.source_locator || before.purpose === 'constraint' || before.purpose === 'background') }]
  }) : []
  const overwritten = changes.filter(change => change.populated).length
  const mode = <ConfigProvider componentDisabled={false}><Button ref={modeButton} variant="quiet" icon={advanced ? <ArrowLeftOutlined /> : <SettingOutlined />} onClick={() => { setAdvanced(value => !value); references?.changeMode(); requestAnimationFrame(() => modeButton.current?.focus({ preventScroll: true })) }}>{advanced ? '返回预设' : '高级设置'}</Button></ConfigProvider>
  const actions = <ConfigProvider componentDisabled={false}><WorkbenchDialogActions secondary={<><Button variant="quiet" icon={<UndoOutlined />} disabled={disabled || !onUndo} onClick={() => { onUndo?.(); setNotice('已撤销上一次修改') }}>撤销</Button><span role="status" className="design-preset-status">{disabled ? '只读 · 可以预览与对比' : notice || (advanced ? '编辑沿用画布自动保存' : matched ? `已应用 · ${matched.name}` : current ? '自定义配置' : '选择一个预设开始')}</span></>}>
    {!advanced && <Button variant="primary" disabled={disabled || !preview || !changes.length} onClick={() => { if (preview && onApply(preview) !== false) setNotice(`已应用「${preview.name}」`) }}>应用</Button>}
  </WorkbenchDialogActions></ConfigProvider>
  return <div ref={owner} className="design-preset-editor">
    {!direct && (header ? editorOpen && createPortal(mode, header) : mode)}
    {(references || candidates) && <div className="design-preset-candidates">{references ? references.renderCandidates(advanced) : candidates}</div>}
    {relations && <div className="design-preset-relations">{relations}</div>}
    <div className="design-preset-layout" hidden={advanced}>
      <section className="design-preset-library"><h3>选择预设 <small>{presets.length} 个方案</small></h3><ConfigProvider componentDisabled={false}><div className="design-preset-grid">{presets.map(preset => <article key={preset.id} data-selected={preview?.id === preset.id}>
        <button type="button" className="design-preset-choice" aria-label={`预览 ${preset.name}`} aria-pressed={preview?.id === preset.id} onClick={() => { setSelected(preset); if (compare?.id === preset.id) setCompare(undefined); setNotice('') }}><PresetIllustration preset={preset} /><strong>{preset.name}{preview?.id === preset.id && <span aria-hidden="true"> ✓</span>}</strong><small>{preset.explanation}</small></button>
        <Button variant="quiet" size="small" aria-label={`对比 ${preset.name}`} aria-pressed={compare?.id === preset.id} onClick={() => { if (!preview) setSelected(preset); else if (preview.id !== preset.id) setCompare(previous => previous?.id === preset.id ? undefined : preset) }}>{compare?.id === preset.id ? '取消对比' : '加入对比'}</Button>
      </article>)}</div></ConfigProvider></section>
      <aside className="design-preset-detail"><h3>{preview ? '方案预览' : '当前设计'}</h3>{preview ? <>
        <div className="design-preset-preview" data-comparing={!!compare}>{[preview, compare].filter((preset): preset is VisualPreset => !!preset).map(preset => <figure key={preset.id}>{preset.video ? <video src={preset.video} controls muted playsInline loop aria-label={`${preset.name}运镜示意`} /> : <PresetIllustration preset={preset} />}<figcaption><strong>{preset.name}</strong><p>{preset.explanation}</p></figcaption></figure>)}</div>
        <small className="design-preset-disclaimer">用途示意，不代表实际生成效果</small>
        <details className="design-preset-changes" aria-label="预设变更清单"><summary>{changes.length ? `将填写 ${changes.length - overwritten} 项 · 覆盖 ${overwritten} 项` : '与当前参数一致，无需重复应用'}</summary>{changes.map(change => <details key={change.key}><summary>{change.populated ? '将覆盖' : '将填写'} · {labels[change.key]}</summary><p>原值：{describe(change.before)}</p><p>新值：{describe(change.after)}</p></details>)}</details>
      </> : <div className="design-preset-empty"><CanvasTextPreview text={current || '选择一个预设查看效果与详情，或进入高级设置填写参数。'} label="当前设计" lines={4} /></div>}</aside>
    </div>
    <section className="design-preset-advanced" hidden={!advanced}><div className="design-preset-advanced-heading"><h3>设计参数</h3><ConfigProvider componentDisabled={false}><label><Switch size="small" aria-label="显示状态与来源" checked={metadata} onChange={setMetadata} /> 显示状态与来源</label></ConfigProvider></div><DesignMetadataVisible.Provider value={metadata}>{children}</DesignMetadataVisible.Provider></section>
    {footer ? editorOpen && createPortal(actions, footer) : actions}
  </div>
}
