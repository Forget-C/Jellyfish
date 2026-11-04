import { shotSizeLabels } from './photographyDesign'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { useState, useId, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CanvasEditorFooter } from './CanvasCardEditor'
import { WorkbenchDialogActions } from '../directing/ui/WorkbenchModal'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import type { DesignField } from '../../../services/generated'
import { ConfigProvider } from 'antd'
import { DesignEditorActive } from './DesignEditorFrame'
import { DesignPurposeIllustration } from './DesignPurposeIllustration'
import type { VisualPreset } from './visualPresets'
import './visualPresets.css'

/** Process and path diagrams explain performance templates without implying generated footage. */
function PerformancePresetIllustration({ preset }: { preset: VisualPreset }) {
  return <svg viewBox="0 0 480 300" role="img" aria-label={preset.name + '过程示意'} className="performance-preset-illustration">
    <rect width="480" height="300" rx="12" fill="var(--wb-inset)" />
    <g fill="none" stroke="currentColor" opacity=".5" strokeWidth="2">
      <path d={preset.diagram === 'blocking' ? 'M65 180Q180 70 245 150T410 120' : preset.diagram === 'activity' ? 'M80 150H400M400 150L387 138M400 150L387 162M400 190H80M80 190L93 178M80 190L93 202' : 'M80 150H400M400 150L387 138M400 150L387 162'} />
      {preset.diagram === 'environment' && <rect x="170" y="80" width="140" height="130" rx="8" strokeDasharray="6 6" />}
    </g>
    {(preset.steps || []).map((step, index) => <g key={step} transform={`translate(${80 + index * 160}, 150)`}>
      <circle cy="-38" r="13" fill="currentColor" opacity=".6" />
      <path d="M-19 0V-15Q0-32 19-15V0" fill="currentColor" opacity=".4" />
      <text y="60" textAnchor="middle" fill="currentColor" fontSize="15">{step}</text>
      <text y="85" textAnchor="middle" fill="currentColor" opacity=".5" fontSize="12">{index + 1}</text>
    </g>)}
  </svg>
}

/** 原创几何示意展示设计差异，不是可采用的项目素材或模型效果承诺。 */
export function PresetIllustration({ preset }: {preset: VisualPreset}) {
  const look=preset.look, mono=look==='noir', painted=look==='watercolor', animated=look==='animation', side=look==='side'
  const id='scene-'+useId().replace(/:/g,'')
  const sky=mono?'#8e9295':painted?'#d9e3d6':animated?'#adcddd':'#aabdc7'
  const wall=mono?'#53585b':painted?'#b6c7b4':animated?'#dfb48c':'#a58d77'
  const coat=mono?'#282b2d':painted?'#a66e53':animated?'#da7950':'#86553e'
  const x=look==='thirds'?320:240
  if (preset.steps) return <PerformancePresetIllustration preset={preset} />
  return <svg viewBox="0 0 480 300" role="img" aria-label={preset.name+'效果示意'}>
    <defs>
      <linearGradient id={id+'-sky'} x2="0" y2="1"><stop stopColor={sky}/><stop offset="1" stopColor={mono?'#d8d8d8':'#eadcc4'}/></linearGradient>
      <linearGradient id={id+'-road'} x2="0" y2="1"><stop stopColor={mono?'#929494':'#999e98'}/><stop offset="1" stopColor={mono?'#313639':'#515e62'}/></linearGradient>
      <linearGradient id={id+'-coat'}><stop stopColor={coat}/><stop offset={side?'.42':'1'} stopColor={mono?'#141719':'#493c37'}/></linearGradient>
      <filter id={id+'-blur'}><feGaussianBlur stdDeviation="4"/></filter>
      <filter id={id+'-paper'}><feTurbulence type="fractalNoise" baseFrequency=".4" numOctaves="3" seed="7"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".16"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter>
    </defs>
    <rect width="480" height="300" fill={'url(#'+id+'-sky)'}/>
    <g filter={look==='shallow'?'url(#'+id+'-blur)':undefined}>
      <path d="M0 0H155V156L0 240Z" fill={wall}/><path d="M480 0H335V159L480 238Z" fill={mono?'#34393c':animated?'#75989e':'#748b8c'}/>
      <path d="M155 52H206V153H155ZM276 65H335V159H276Z" fill={mono?'#7e8588':'#bac3b6'}/><path d="M207 96H276V169H207Z" fill={mono?'#b8bcba':'#cbd1c2'}/>
      <path d="M0 240L227 143H260L480 238V300H0Z" fill={'url(#'+id+'-road)'}/>
      <path d="M0 246L222 155L155 211L113 300H0ZM480 246L269 158L334 219L373 300H480Z" fill={mono?'#8b9090':'#b6b8ab'}/>
      {[0,1,2,3].map(row=><g key={row}>{[0,1,2].map(col=><g key={col}><path d={`M${16+col*43} ${18+row*43}h25v28h-25Z`} fill={mono?'#262d32':animated?'#527782':'#445e69'} rx={animated?5:0}/><path d={`M${17+col*43} ${20+row*43}h11v25h-11Z`} fill={mono?'#c6c2ac':'#d6c5a1'} opacity={side?.85:.45}/><path d={`M${354+col*43} ${12+row*43}h25v30h-25Z`} fill={mono?'#252a2b':'#374f58'}/></g>)}</g>)}
      <path d="M0 61H155M0 106H155M0 150H155M336 56H480M336 101H480M336 147H480" stroke={mono?'#acaaaa':'#d8c9ad'} strokeWidth="3" opacity=".42"/>
      <path d="M7 223L203 160M477 226L281 163M135 300L231 157M351 300L258 156M191 300L240 158M284 300L250 158" stroke={mono?'#c9c8c1':'#d1c8ad'} opacity=".3"/>
      <path d="M72 300L160 222M399 300L324 225M149 260H331M174 224H306M196 195H286M210 176H270" stroke={mono?'#32393a':'#3b5057'} opacity=".45"/>
      <g stroke={mono?'#252b2c':'#37484a'} strokeWidth="4"><path d="M109 207V87Q109 74 123 74H135M375 211V82Q375 68 361 68H351" fill="none"/><path d="M121 75H137M345 69H361" strokeWidth="10"/></g>
      <g fill={mono?'#454e49':painted?'#78946e':'#567d68'}><ellipse cx="319" cy="117" rx="24" ry="30"/><ellipse cx="337" cy="102" rx="20" ry="26"/><ellipse cx="309" cy="99" rx="18" ry="23"/></g><path d="M321 119V171M321 139L335 113" stroke={mono?'#454440':'#655a46'} strokeWidth="5"/>
      <path d="M403 235H448L445 252H400Z" fill={mono?'#363f41':'#546a69'}/><path d="M411 238V219M421 239V212M432 237V219" stroke={mono?'#8a9584':'#74916b'} strokeWidth="5"/>
      <path d="M171 165H192V183H171Z" fill={mono?'#616a6b':'#737f7b'}/><path d="M174 163L176 152H188L190 163Z" fill={mono?'#2a3438':'#54707a'}/>
    </g>
    <g transform={look==='close'?'translate(-112,-70) scale(1.65)':look==='wide'?'translate(86,70) scale(.66)':look==='low'?'translate(-10,-10) scale(1.08)':undefined}>
      <ellipse cx={x+12} cy="284" rx="49" ry="8" fill="#17252a" opacity=".3"/>
      <path d={`M${x-7} 208L${x-15} 278L${x-4} 280L${x+8} 223L${x+21} 274L${x+33} 271L${x+20} 206Z`} fill={mono?'#242b30':'#303e47'}/>
      <path d={`M${x-15} 278L${x-22} 286Q${x-13} 292 ${x-2} 286L${x-4} 279M${x+20} 273L${x+23} 283H${x+45}Q${x+43} 278 ${x+33} 271`} fill={mono?'#14191b':'#202c33'}/>
      <path d={`M${x-21} 151Q${x} 135 ${x+21} 153L${x+30} 216Q${x+4} 224 ${x-25} 213Z`} fill={'url(#'+id+'-coat)'}/>
      <path d={`M${x-19} 153L${x-37} 189L${x-24} 196L${x-8} 164M${x+19} 151L${x+39} 177L${x+30} 185L${x+10} 163`} fill={coat}/>
      <path d={`M${x-34} 188L${x-36} 201M${x+37} 179L${x+43} 186`} stroke={mono?'#b7aea0':'#c99d79'} strokeWidth="8" strokeLinecap="round"/>
      <path d={`M${x-36} 200L${x-22} 200L${x-14} 232L${x-49} 232Z`} fill={mono?'#8e9190':animated?'#efc576':'#bcad88'}/>
      <path d={`M${x-8} 142V130H${x+7}V147Z`} fill={mono?'#b0aca6':'#c79772'}/>
      <ellipse cx={x} cy="119" rx={animated?17:15} ry="20" fill={mono?'#c8c1b3':'#d9b18a'}/>
      <path d={`M${x-15} 121Q${x-23} 93 ${x+1} 96Q${x+22} 94 ${x+16} 122L${x+9} 110L${x-4} 107L${x-11} 124Z`} fill={mono?'#242725':'#403e38'}/>
      <path d={`M${x-7} 149L${x+1} 162L${x+10} 148M${x+1} 163L${x+5} 211M${x-13} 182L${x-10} 202M${x+15} 181L${x+18} 201`} stroke={mono?'#b1aca0':'#c1a282'} strokeWidth="1.5" opacity=".6" fill="none"/>
    </g>
    {look==='thirds'&&<path d="M160 0V300M320 0V300M0 100H480M0 200H480" stroke="#fff" opacity=".55" strokeDasharray="5 5"/>}
    {look==='center'&&<path d="M240 0V300" stroke="#fff" opacity=".55" strokeDasharray="5 5"/>}
    {side&&<path d="M0 0H260L105 300H0Z" fill="#f8d794" opacity=".18"/>}
    {look==='soft'&&<rect width="480" height="300" fill="#fff0ce" opacity=".17"/>}
    {painted&&<rect width="480" height="300" fill="#b9c5a4" opacity=".16" filter={'url(#'+id+'-paper)'}/>}
    {(look==='push'||look==='pan')&&<path d={look==='push'?'M210 270L236 245M236 245H218M236 245V262':'M175 260H305M305 260L289 249M305 260L289 271'} stroke="#fff" strokeWidth="3" fill="none"/>}
  </svg>
}

/** 预览会话不写入文档；显式应用仅合并声明字段，由调用方一次记录撤销。 */
export function VisualPresetPicker({ label, presets, disabled, onApply, children, currentName, fields, fieldLabels, editorOpen = true, active = true, currentPreview }: {
  label: string; presets: VisualPreset[]; disabled?: boolean; onApply: (preset: VisualPreset) => void | boolean; children?: ReactNode; currentName?: string;
  fields: Record<string, DesignField | null | undefined>; fieldLabels: Record<string, string>; editorOpen?: boolean; active?: boolean; currentPreview?: ReactNode;
}) {
  const [selected, setSelected] = useState<VisualPreset>(), [compare, setCompare] = useState<VisualPreset>()
  const [gallery, setGallery] = useState(false)
  const footer = useContext(CanvasEditorFooter)
  const designActive = useContext(DesignEditorActive)
  const root = useRef<HTMLElement>(null), scroll = useRef(0)
  const selectedRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { if (!editorOpen) { setGallery(false); setSelected(undefined); setCompare(undefined) } }, [editorOpen])
  useLayoutEffect(() => { const body = root.current?.closest('.wb-details-body'); if (body) body.scrollTop = gallery ? 0 : scroll.current }, [gallery])
  const browse = (open: boolean) => {
    const body = root.current?.closest('.wb-details-body')
    if (body && open) scroll.current = body.scrollTop
    setGallery(open)
    requestAnimationFrame(() => { if (!open) selectedRef.current?.focus({ preventScroll: true }) })
  }
  const changes = selected ? Object.entries(selected.fields).flatMap(([key, value]) => {
    const before = fields[key], after = { ...before, ...value }
    if (JSON.stringify(before || {}) === JSON.stringify(after)) return []
    const populated = !!before && (!!before.state && before.state !== 'empty' || !!before.text?.trim() || !!before.source_locator || before.purpose === 'constraint' || before.purpose === 'background')
    return [{ key, before, after, populated }]
  }) : []
  const conflicts = changes.filter(item => item.populated).length
  const describe = (field?: DesignField | null) => field ? `${field.text || '无正文'} · 状态：${({ empty: '未填写', proposal: '提议', fact: '事实', undecided: '待确定', absent: '明确没有', not_applicable: '不适用' } as Record<string, string>)[field.state || 'empty']} · 用途：${({ background: '背景', design: '设计', constraint: '约束' } as Record<string, string>)[field.purpose || ''] || '未指定'} · 来源：${field.source_locator || '未指定'}${Object.entries(field).filter(([key]) => !['text', 'state', 'purpose', 'source_locator'].includes(key)).map(([key, value]) => ` · ${{ size: '景别', target_id: '目标身份', state_id: '画面状态' }[key] || '附加设置'}：${key === 'size' ? shotSizeLabels[value as keyof typeof shotSizeLabels] || '未指定' : value ?? '未指定'}`).join('')}` : '未填写'
  const actions = <ConfigProvider componentDisabled={false}><WorkbenchDialogActions className="canvas-effect-apply" secondary={<><WorkbenchButton style={{ minHeight: 'var(--design-action-height, var(--wb-control))' }} variant="quiet" onClick={() => browse(false)}>返回参数</WorkbenchButton>{disabled && <span className="canvas-effect-readonly">只读 · 可预览与对比，不能应用</span>}</>}><WorkbenchButton style={{ minHeight: 'var(--design-action-height, var(--wb-control))' }} variant="primary" disabled={disabled || !selected || !changes.length} onClick={() => { if (selected && !disabled) { if (onApply(selected) !== false) browse(false) } }}>{conflicts ? `覆盖 ${conflicts} 项并应用` : '应用此预设'}</WorkbenchButton></WorkbenchDialogActions></ConfigProvider>
  return <section ref={root} className="canvas-effect-editor" aria-label={label + '效果选择'}>
    <div className="canvas-effect-parameters" hidden={gallery}>{children}</div>
    <aside className="canvas-effect-preview" hidden={gallery}>
      <details className="canvas-effect-current" open={window.innerWidth > 700}><summary>设计预览与预设</summary>{currentPreview || <DesignPurposeIllustration kind={label === '风格' ? 'style' : 'composition'} />}<ConfigProvider componentDisabled={false}><CanvasTextPreview text={currentName || '尚未填写设计。'} label="当前设计" lines={4} /></ConfigProvider>
      <ConfigProvider componentDisabled={false}><WorkbenchButton ref={node => { selectedRef.current = node as HTMLButtonElement }} onClick={() => browse(true)}>浏览预设与对比</WorkbenchButton></ConfigProvider>
      </details>
    </aside>
    <div className="canvas-effect-browser" hidden={!gallery}>
      <div><h3>{label}预设</h3><p className="canvas-effect-caption">选择仅为预览，应用才更新卡片。</p><ConfigProvider componentDisabled={false}><div className="canvas-preset-gallery">{presets.map(preset => <section key={preset.id} data-previewed={selected?.id === preset.id}>
        <button type="button" className="canvas-preset-choice" aria-label={'预览 ' + preset.name} aria-pressed={selected?.id === preset.id} onClick={() => setSelected(preset)}><PresetIllustration preset={preset} /><span>{preset.name}</span><span aria-hidden="true">{selected?.id === preset.id ? '✓' : ''}</span></button>
        <WorkbenchButton variant="quiet" aria-label={'对比 ' + preset.name} aria-pressed={compare?.id === preset.id} onClick={() => setCompare(compare?.id === preset.id ? undefined : preset)}>对比</WorkbenchButton>
      </section>)}</div></ConfigProvider></div>
      <div className="canvas-effect-comparison"><h3>{selected ? '待应用方案' : '请选择预设'}</h3><div className="canvas-preset-comparison">{[selected, compare && compare.id !== selected?.id ? compare : undefined].filter((value): value is VisualPreset => !!value).map(preset => <section key={preset.id}>
        {preset.video ? <video src={preset.video} controls loop muted playsInline preload="metadata" aria-label={preset.name + '运镜示意'} /> : <PresetIllustration preset={preset} />}<h4>{preset.name} · 示意</h4><p>{preset.explanation}</p>
        {preset.video && <section className="canvas-motion-endpoints" aria-label="运镜起止对照"><figure><PresetIllustration preset={{ ...preset, look: 'wide' }} /><figcaption>起始示意</figcaption></figure><figure><PresetIllustration preset={{ ...preset, look: preset.look === 'push' ? 'close' : 'thirds' }} /><figcaption>结束示意</figcaption></figure></section>}
      </section>)}</div><p className="canvas-effect-caption">原创示意仅解释设计意图，不代表已采用素材或模型效果。</p>
      {selected && <section aria-label="预设变更清单"><h3>将填写／将覆盖</h3>{!changes.length && <p>当前字段与预设相同，无需应用。</p>}{changes.map(item => <details key={item.key}><summary>{item.populated ? '将覆盖' : '将填写'} · {fieldLabels[item.key] || item.key}</summary><p>原值：{describe(item.before)}</p><p>新值：{describe(item.after)}</p></details>)}</section>}
      </div>
    </div>
    {gallery && editorOpen && active && designActive && (footer ? createPortal(actions, footer) : actions)}
  </section>
}
