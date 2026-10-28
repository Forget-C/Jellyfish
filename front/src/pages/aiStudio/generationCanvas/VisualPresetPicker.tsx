import { useState } from 'react'
import { WorkbenchModal, WorkbenchDialogActions } from '../directing/ui/WorkbenchModal'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import type { VisualPreset } from './visualPresets'
import './visualPresets.css'

/** 原创几何示意展示设计差异，不是可采用的项目素材或模型效果承诺。 */
function PresetIllustration({ preset }: {preset: VisualPreset}) {
  const look = preset.look, mono = look === 'noir', x = look === 'thirds' ? 205 : 150
  return <svg viewBox="0 0 320 180" role="img" aria-label={preset.name+'效果示意'}>
    <defs><filter id={'blur-'+preset.id}><feGaussianBlur stdDeviation="5" /></filter><linearGradient id={'shade-'+preset.id}><stop stopColor="#f6dbaa"/><stop offset="1" stopColor="#503e3c"/></linearGradient></defs>
    <rect width="320" height="180" fill={mono?'#262626':look==='watercolor'?'#dce7d9':'#324651'}/>
    <g filter={look==='shallow'?'url(#blur-'+preset.id+')':undefined} opacity={look==='watercolor'?.65:1}>
      <path d={look==='low'?'M0 180L100 35H230L320 180':'M0 180L80 95H240L320 180'} fill={mono?'#777':'#748b89'}/>
      <rect x="45" y="25" width="55" height="80" rx={look==='animation'?12:0} fill={mono?'#ddd':'#c6d7bf'}/><rect x="245" y="30" width="24" height="90" fill={mono?'#999':'#adbead'}/>
    </g>
    <g transform={look==='close'?'translate(-120,-45) scale(1.8)':look==='wide'?'translate(90,55) scale(.55)':undefined}>
    <ellipse cx={x} cy="65" rx="17" ry="19" fill={mono?'#bbb':look==='side'?'url(#shade-side)':'#e5bb8a'}/>
    <path d={`M${x-22} 95Q${x} 82 ${x+22} 95L${x+26} 145H${x-26}Z`} fill={mono?'#eee':look==='side'?'url(#shade-side)':'#b16f4d'}/>
    <path d={`M${x-14} 145V178M${x+14} 145V178`} stroke={mono?'#aaa':'#263a45'} strokeWidth="13"/>
    </g>
    {look==='thirds'&&<path d="M106 0V180M213 0V180M0 60H320M0 120H320" stroke="#fff" opacity=".5" strokeDasharray="4 4"/>}
    {look==='center'&&<path d="M160 0V180" stroke="#fff" strokeDasharray="4 4"/>}
    {look==='soft'&&<rect width="320" height="180" fill="#fff0ce" opacity=".18"/>}
    {look==='watercolor'&&<path d="M0 130Q70 100 100 150T320 140" stroke="#b4c6a5" strokeWidth="22" opacity=".4" fill="none"/>}
    {(look==='push'||look==='pan')&&<path d={look==='push'?'M110 145L135 125M135 125H121M135 125V140':'M100 150H230M230 150L215 140M230 150L215 160'} stroke="#fff" strokeWidth="3" fill="none"/>}
  </svg>
}

/** 浏览与对比仅为本地选择；确认后才写入当前内容卡。 */
export function VisualPresetPicker({label,presets,disabled,onApply}:{label:string;presets:VisualPreset[];disabled?:boolean;onApply:(preset:VisualPreset)=>void}) {
  const [open,setOpen]=useState(false),[selected,setSelected]=useState(presets[0]),[compare,setCompare]=useState<VisualPreset>()
  return <><WorkbenchButton disabled={disabled} onClick={()=>{setSelected(presets[0]);setCompare(undefined);setOpen(true)}}>浏览{label}预设</WorkbenchButton>
    <WorkbenchModal open={open} title={label+'预设'} onCancel={()=>setOpen(false)} footer={<WorkbenchDialogActions secondary={<WorkbenchButton onClick={()=>setOpen(false)}>暂不应用</WorkbenchButton>}><WorkbenchButton variant="primary" disabled={disabled} onClick={()=>{onApply(selected);setOpen(false)}}>应用到当前卡片</WorkbenchButton></WorkbenchDialogActions>}>
      <p>原创几何示意，仅解释设计意图；应用后可继续编辑。示例主体和媒体不会进入生成，也不承诺模型严格执行。</p>
      <div className="canvas-preset-gallery">{presets.map(preset=><section key={preset.id}><PresetIllustration preset={preset}/><WorkbenchButton aria-pressed={selected.id===preset.id} onClick={()=>setSelected(preset)}>预览 {preset.name}</WorkbenchButton><WorkbenchButton aria-pressed={compare?.id===preset.id} onClick={()=>setCompare(compare?.id===preset.id?undefined:preset)}>对比 {preset.name}</WorkbenchButton></section>)}</div>
      <div className="canvas-preset-comparison">{[selected,compare].filter((value):value is VisualPreset=>!!value).map(preset=><section key={preset.id}><h3>{preset.name}</h3>{preset.video?<video src={preset.video} controls loop muted playsInline preload="metadata" aria-label={preset.name+'运镜示意'}/>:<PresetIllustration preset={preset}/>}<p>{preset.explanation}</p></section>)}</div>
    </WorkbenchModal></>
}
