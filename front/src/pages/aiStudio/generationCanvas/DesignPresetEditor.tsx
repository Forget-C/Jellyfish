import { isDesignFieldConfigured } from './designFieldConfiguration'
import { useGraphRules } from './CanvasCatalogContext'
import { DesignReferenceContext } from './DesignReferenceEditor'
import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ConfigProvider, theme } from 'antd'
import { ArrowLeftOutlined, SettingOutlined, UndoOutlined } from '@ant-design/icons'
import type { DesignField, ReferenceDesignField } from '../../../services/generated'
import { CanvasEditorFooter, CanvasEditorHeader } from './CanvasCardEditor'
import { designFieldMetadata } from './designFieldMetadata'
import { PresetIllustration } from './PresetIllustration'
import type { VisualPreset } from './visualPresets'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import { WorkbenchDialogActions } from '../../../components/workbench/WorkbenchModal'
import { CanvasTextPreview } from '../../../components/workbench/CanvasTextPreview'
import './designPresetEditor.css'

type Props = {
  fields: Record<string, DesignField | null | undefined>; labels: Record<string, string>; presets: VisualPreset[];
  children: ReactNode; scopeTools?: ReactNode; advancedTitle?: string; candidates?: ReactNode; relations?: ReactNode; direct?: boolean; current: string; disabled?: boolean; editorOpen?: boolean;
  category?: { value: string; labels: Record<string, string> };
  additionalDesign?: boolean;
  onApply: (preset: VisualPreset) => void | boolean; onUndo?: () => void;
}
const describe = (value?: ReferenceDesignField | null, defaults?: DesignField) => value ? [value.text || '无正文', designFieldMetadata(value, defaults), value.document?.segments?.some(segment => segment.kind === 'reference') ? '含引用（应用后替换）' : ''].filter(Boolean).join(' · ') : '未填写'

type PresetField = ReferenceDesignField & { size?: string | null }

/** Compare design values while keeping provenance and structured references distinct from displayed text. */
function matchesPresetField(actual: PresetField | undefined, expected: PresetField) {
  if (!actual || actual.document?.segments?.some(segment => segment.kind === 'reference')) return false
  const text = actual.document ? actual.document.segments?.map(segment => segment.kind === 'text' ? segment.text : '').join('') : actual.text
  return (text || '') === (expected.text || '') && (actual.state || 'empty') === (expected.state || 'empty')
    && (actual.purpose || 'design') === (expected.purpose || 'design') && (actual.size ?? null) === (expected.size ?? null)
}

/** Choose the initial mode from the effective design, then retain the mode for this open session. */
export function DesignPresetEditor({ fields, labels, presets, children, advancedTitle = '设计参数', scopeTools, candidates, relations, direct = false, current, disabled, editorOpen = true, category, additionalDesign = false, onApply, onUndo }: Props) {
  const { token } = theme.useToken()
  const references = useContext(DesignReferenceContext)
  const { cardDefinitions } = useGraphRules()
  const defaults = Object.fromEntries((references ? cardDefinitions[references.card.type!].fields : []).map(field => [field.id, field.default_value]))
  const owner = useRef<HTMLDivElement>(null)
  const header = useContext(CanvasEditorHeader), footer = useContext(CanvasEditorFooter)
  const [sessionMode, setSessionMode] = useState<boolean>()
  const [selected, setSelected] = useState<VisualPreset>(), [compare, setCompare] = useState<VisualPreset>()
  const [notice, setNotice] = useState('')
  const modeButton = useRef<HTMLElement>(null)
  const configuredFields = Object.entries(fields).filter(([key, field]) => field && isDesignFieldConfigured({ ...field, source_locator: '' }, defaults[key]))
  const matchingPresets = presets.filter(preset => (!category || preset.category === category.value) && Object.entries(preset.fields)
    .every(([key, expected]) => !expected || matchesPresetField(fields[key] || undefined, expected)))
  // Additional design keeps the partial preset preview available for comparison, but starts in parameters.
  const matched = !additionalDesign ? matchingPresets.find(preset => configuredFields.every(([key]) => !!preset.fields[key])) : undefined
  const configured = additionalDesign || !!configuredFields.length || !!category && category.value !== 'space'
  const initialAdvanced = direct || !presets.length || configured && !matched
  const advanced = sessionMode ?? initialAdvanced
  useEffect(() => {
    if (editorOpen) setSessionMode(mode => mode ?? initialAdvanced)
    else { setSessionMode(undefined); setSelected(undefined); setCompare(undefined); setNotice('') }
  }, [editorOpen, initialAdvanced])
  const targetFieldId = references?.targetField?.fieldId
  const targetSegmentId = references?.targetField?.segmentId
  const targetSerial = references?.targetField?.serial
  useEffect(() => {
    if (!targetFieldId || !editorOpen) return
    setSessionMode(true)
    let frame = 0, attempts = 0, settled = 0, scrolled = false
    const focusField = () => {
      const field = owner.current?.querySelector<HTMLElement>(`[data-design-field="${CSS.escape(targetFieldId)}"]`)
      if (field && !field.closest('[inert]') && field.getClientRects().length) {
        const input = targetSegmentId ? field.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(targetSegmentId)}"]`) : field.querySelector<HTMLElement>('[role="textbox"]') || field
        if (input) {
          if (!scrolled) { input.scrollIntoView({ block: 'nearest', inline: 'nearest' }); scrolled = true }
          if (!input.isContentEditable && input.tabIndex < 0) input.tabIndex = -1
          if (document.activeElement === input) settled += 1
          else { input.focus({ preventScroll: true }); settled = 0 }
          if (settled >= 3) return
        }
      }
      if (++attempts < 90) frame = requestAnimationFrame(focusField)
    }
    frame = requestAnimationFrame(focusField)
    return () => cancelAnimationFrame(frame)
  }, [targetFieldId, targetSegmentId, targetSerial, editorOpen])
  const savedFields = JSON.stringify([fields, category?.value])
  useEffect(() => { setNotice('') }, [savedFields])
  const availableSelected = presets.find(preset => preset.id === selected?.id)
  const availableCompare = presets.find(preset => preset.id === compare?.id)
  const preview = availableSelected || matched || matchingPresets[0]
  const changes = preview ? Object.entries(preview.fields).flatMap(([key, value]) => {
    const before = fields[key] as ReferenceDesignField, after = { ...before, ...value, ...(before?.document ? { document: null } : {}) }
    return JSON.stringify(before || {}) === JSON.stringify(after) ? [] : [{ key, populated: isDesignFieldConfigured(before, defaults[key]), label: labels[key], beforeText: describe(before, defaults[key]), afterText: describe(after, defaults[key]) }]
  }) : []
  if (preview?.category && category && preview.category !== category.value) changes.push({ key: 'category', populated: true, label: '连续性分类', beforeText: category.labels[category.value] || category.value, afterText: category.labels[preview.category] || preview.category })
  const overwritten = changes.filter(change => change.populated).length
  const mode = <ConfigProvider componentDisabled={false}><Button ref={modeButton} variant="quiet" icon={advanced ? <ArrowLeftOutlined /> : <SettingOutlined />} onClick={() => { setSessionMode(!advanced); references?.changeMode(); modeButton.current?.focus({ preventScroll: true }) }}>{advanced ? '返回预设' : '高级设置'}</Button></ConfigProvider>
  const actions = <ConfigProvider componentDisabled={false}><WorkbenchDialogActions className="design-preset-actions" secondary={<><Button variant="quiet" icon={<UndoOutlined />} disabled={disabled || !onUndo} onClick={() => { onUndo?.(); setNotice('已撤销上一次修改') }}>撤销</Button><span role="status" className="design-preset-status">{disabled ? '只读 · 可以预览与对比' : notice || (advanced ? '编辑沿用画布自动保存' : matched ? `匹配预设 · ${matched.name}` : configured ? '自定义配置' : '选择一个预设开始')}</span></>}>
    {references?.savedRevision !== undefined && <small className="design-preset-revision">revision {references.savedRevision}</small>}
    {!advanced && <Button variant="primary" disabled={disabled || !preview || !changes.length} onClick={() => { if (preview && onApply(preview) !== false) setNotice(`已应用「${preview.name}」`) }}>应用</Button>}
  </WorkbenchDialogActions></ConfigProvider>
  return <div ref={owner} className="design-preset-editor" style={{ '--design-input-font': token.fontFamily } as CSSProperties}>
    {!direct && (header ? editorOpen && createPortal(mode, header) : mode)}
    {(references || candidates) && <div className="design-preset-candidates">{references ? references.renderCandidates(advanced) : candidates}</div>}
    {relations && <div className="design-preset-relations">{relations}</div>}
    <div className="design-preset-layout" hidden={advanced}>
      <section className="design-preset-library"><h3>选择预设 <small>{presets.length} 个方案</small></h3><ConfigProvider componentDisabled={false}><div className="design-preset-grid">{presets.map(preset => <article key={preset.id} data-selected={preview?.id === preset.id}>
        <button type="button" className="design-preset-choice" aria-label={`预览 ${preset.name}`} aria-pressed={preview?.id === preset.id} onClick={() => { setSelected(preset); if (compare?.id === preset.id) setCompare(undefined); setNotice('') }}><PresetIllustration preset={preset} /><strong>{preset.name}{preview?.id === preset.id && <span aria-hidden="true"> ✓</span>}</strong><small>{preset.explanation}</small></button>
        <Button variant="quiet" size="small" aria-label={`对比 ${preset.name}`} aria-pressed={compare?.id === preset.id} onClick={() => { if (!preview) setSelected(preset); else if (preview.id !== preset.id) setCompare(previous => previous?.id === preset.id ? undefined : preset) }}>{compare?.id === preset.id ? '取消对比' : '加入对比'}</Button>
      </article>)}</div></ConfigProvider></section>
      <aside className="design-preset-detail"><h3>{preview ? '方案预览' : '当前设计'}</h3>{preview ? <>
        <div className="design-preset-preview" data-comparing={!!compare}>{[preview, availableCompare].filter((preset): preset is VisualPreset => !!preset).map(preset => <figure key={preset.id}>{preset.video ? <video src={preset.video} controls muted playsInline loop aria-label={`${preset.name}运镜示意`} /> : <PresetIllustration preset={preset} />}<figcaption><strong>{preset.name}</strong><p>{preset.explanation}</p></figcaption></figure>)}</div>
        <small className="design-preset-disclaimer">用途示意，不代表实际生成效果</small>
        <details className="design-preset-changes" aria-label="预设变更清单"><summary>{changes.length ? `将填写 ${changes.length - overwritten} 项 · 覆盖 ${overwritten} 项` : '与当前参数一致，无需重复应用'}</summary>{changes.map(change => <details key={change.key}><summary>{change.populated ? '将覆盖' : '将填写'} · {change.label}</summary><p>原值：{change.beforeText}</p><p>新值：{change.afterText}</p></details>)}</details>
      </> : <div className="design-preset-empty"><CanvasTextPreview text={current || '选择一个预设查看效果与详情，或进入高级设置填写参数。'} label="当前设计" lines={4} /></div>}</aside>
    </div>
    {advancedTitle && <div className="design-preset-advanced-heading" hidden={!advanced}><h3>{advancedTitle}</h3>{scopeTools}</div>}
    <section className="design-preset-advanced" hidden={!advanced}>{children}</section>
    {footer ? editorOpen && createPortal(actions, footer) : actions}
  </div>
}
