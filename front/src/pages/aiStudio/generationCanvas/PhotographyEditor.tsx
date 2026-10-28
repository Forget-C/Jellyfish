import { VisualPresetPicker } from './VisualPresetPicker'
import { applyPreset, photographyPresets } from './visualPresets'
import { inputPorts } from './graphRules'
import { Alert, Input, Select, Space } from 'antd'
import { useState } from 'react'
import type { PhotographyCard, PhotographyFields, PhotographyMediaExample, ObjectReferencePayload } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { DesignFieldEditor } from './DesignFieldEditor'
import { DesignMediaExamples } from './DesignMediaExamples'
import { useCardCandidates } from './useCardCandidates'
import { sourceKey } from './promptRules'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'

export const photographyRegions = {"composition": {"label": "景别与构图", "fields": {"shot_size": "景别", "composition": "构图重心", "frame_position": "画面位置", "depth_layers": "空间层次", "negative_space": "留白", "composition_requirements": "构图要求"}}, "camera": {"label": "机位与视角", "fields": {"viewpoint": "观察视点", "position": "机位位置", "height_angle": "高度与角度", "lens_effect": "焦段与透视意图", "support": "支撑方式"}}, "movement": {"label": "运镜", "fields": {"movement_type": "运动方式", "movement_start": "起始画面", "movement_trigger": "触发条件", "movement_path": "运动路径", "movement_speed": "运动速度", "end_frame": "结束画面"}}, "lighting": {"label": "光影与色彩", "fields": {"light_sources": "光源", "light_direction": "光线方向", "light_regions": "明暗区域", "exposure_color": "曝光与色温", "color_relationship": "色彩关系"}}, "focus": {"label": "焦点与成像", "fields": {"depth_focus": "景深与焦点", "focus_change": "焦点变化", "optical_effects": "光学效果", "motion_texture": "运动质感", "technical_parameters": "技术意图", "adjacent_requirements": "相邻镜头衔接", "prohibitions": "禁止项"}}} as const

/** 五个入口只编辑当前摄影卡；切换区域不新建或同步隐藏对象。 */
export function PhotographyEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled }: CardRendererProps) {
  const card = raw as PhotographyCard
  const [region, setRegion] = useState<keyof typeof photographyRegions>('composition')
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const bindings = card.input_bindings || [], phases = card.phases || []
  const update = (next: PhotographyCard) => onChange(next)
  const fields = card.fields || {}
  return <>
    <p>一张摄影设计 · 五个编辑入口。另一套独立方案请明确新建或复制；所属镜头可选，不自动合并。</p>
    <Space wrap>{Object.entries(photographyRegions).map(([key, value]) => <WorkbenchButton key={key} aria-pressed={region === key} onClick={() => setRegion(key as keyof typeof photographyRegions)}>编辑{value.label}</WorkbenchButton>)}</Space>
    <section aria-label={photographyRegions[region].label}>
      <VisualPresetPicker key={region} label={photographyRegions[region].label} presets={photographyPresets[region]} disabled={disabled} onApply={preset => update({ ...card, fields: applyPreset(fields, preset) })} />
      {Object.entries(photographyRegions[region].fields).map(([key, label]) => <DesignFieldEditor key={key} label={label} value={fields[key as keyof PhotographyFields]} onChange={value => update({ ...card, fields: { ...fields, [key]: { ...fields[key as keyof PhotographyFields], ...value } } })} />)}
      {region === 'composition' && <details><summary>明确景别硬要求</summary><p>只比较同一显式目标和状态的事实要求；开放提议和自由正文保留。</p>
        <Select aria-label="结构化景别" allowClear value={fields.shot_size?.size || undefined} options={[{value:'extreme_close_up',label:'大特写'},{value:'close_up',label:'特写'},{value:'medium',label:'中景'},{value:'full',label:'全景'},{value:'wide',label:'远景'},{value:'extreme_wide',label:'大远景'}]} onChange={size => update({ ...card, fields: { ...fields, shot_size: { ...fields.shot_size, size: size ?? null } } })} />
        <Input aria-label="景别明确目标身份" placeholder="目标身份（可选）" value={fields.shot_size?.target_id} onChange={event => update({ ...card, fields: { ...fields, shot_size: { ...fields.shot_size, target_id: event.target.value } } })} />
        <Select aria-label="景别目标状态" allowClear placeholder="同一静态画面（可选）" value={fields.shot_size?.state_id || undefined} options={[{value:'field:movement_start',label:'起始画面'},{value:'field:end_frame',label:'结束画面'},...phases.map(phase => ({value:'phase:'+phase.id,label:phase.name || phase.id}))]} onChange={state_id => update({ ...card, fields: { ...fields, shot_size: { ...fields.shot_size, state_id: state_id ?? null } } })} />
      </details>}
      {region === 'movement' && <section aria-label="明确运镜阶段"><h3>明确运镜阶段</h3><p>仅明确创建的状态可作为图片目标，普通文字不推断阶段。</p>
        {phases.map((phase, index) => <section key={phase.id}><Input aria-label="阶段名称" value={phase.name} onChange={event => update({ ...card, phases: phases.map(value => value.id === phase.id ? { ...value, name: event.target.value } : value) })} />
          <DesignFieldEditor label="阶段画面" value={phase.frame} onChange={frame => update({ ...card, phases: phases.map(value => value.id === phase.id ? { ...value, frame } : value) })} />
          <WorkbenchButton disabled={disabled || index === 0} onClick={() => { const next = [...phases]; [next[index-1],next[index]] = [next[index],next[index-1]]; update({ ...card, phases: next }) }}>前移阶段</WorkbenchButton>
          <WorkbenchButton disabled={disabled} onClick={() => update({ ...card, phases: phases.filter(value => value.id !== phase.id) })}>删除阶段</WorkbenchButton>
        </section>)}
        <WorkbenchButton disabled={disabled} onClick={() => update({ ...card, phases: [...phases, { id: crypto.randomUUID(), name: '新阶段', frame: {} }] })}>新增明确阶段</WorkbenchButton>
      </section>}
    </section>
    <details><summary>共享对象、范围与来源</summary>
      {resolved.candidates.filter(item => item.payload?.kind === 'object_reference').map(item => <div key={sourceKey(item.source)}><span>{(item.payload as ObjectReferencePayload).name}</span>{(['effect_object','attention_object','focus_object'] as const).map(port => {
        if (!document.edges?.some(edge => edge.target_card === card.id && edge.target_port === port && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)) return null
        const bound = bindings.find(binding => binding.input_port === port && sourceKey(binding.source) === sourceKey(item.source))
        return <WorkbenchButton key={port} disabled={disabled || item.available === false} onClick={() => update({ ...card, input_bindings: bound ? bindings.filter(binding => binding.id !== bound.id) : [...bindings, {id:crypto.randomUUID(),source:item.source,input_port:port}] })}>{bound?'取消':'选择'}{{effect_object:'作用对象',attention_object:'关注对象',focus_object:'焦点对象'}[port]}</WorkbenchButton>
      })}</div>)}
      {bindings.filter(binding => !resolved.candidates.some(item => sourceKey(item.source) === sourceKey(binding.source) && item.available)).map(binding => <div key={binding.id}><Alert type="warning" message="已采用对象缺失，请替换或取消" /><WorkbenchButton disabled={disabled} onClick={() => update({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效对象关系</WorkbenchButton></div>)}
      <Input aria-label="摄影适用范围" value={card.scope?.description} onChange={event => update({ ...card, scope: { ...card.scope, description: event.target.value } })} />
      <Select aria-label="摄影制作阶段" allowClear value={card.scope?.phase || undefined} options={[{value:'video',label:'画面／视频'},{value:'sound',label:'声音'},{value:'postproduction',label:'后期'}]} onChange={phase => update({ ...card, scope: { ...card.scope, phase: phase ?? null } })} />
      <Input aria-label="摄影适用条件" value={card.scope?.condition} onChange={event => update({ ...card, scope: { ...card.scope, condition: event.target.value } })} />
      <Input aria-label="摄影来源" value={card.source_locator} onChange={event => update({ ...card, source_locator: event.target.value })} />
    </details>
    <DesignMediaExamples ports={inputPorts(card)} fieldOptions={Object.values(photographyRegions).flatMap(region => Object.entries(region.fields).map(([value,label]) => ({value:value as NonNullable<PhotographyMediaExample["field_id"]>,label})))} examples={card.examples || []} candidates={resolved.candidates} disabled={disabled} onChange={examples => update({ ...card, examples })} />
    <section aria-label="摄影已保存输出"><h3>已保存摄影设计 · revision {resolved.revision}</h3>{resolved.outputs.map(item => <CanvasTextPreview key={sourceKey(item.source)} text={item.text || ''} label="摄影设计" />)}</section>
  </>
}

export function photographySummary(card: PhotographyCard) {
  return [card.fields?.composition?.text,card.fields?.movement_path?.text,card.fields?.end_frame?.text].filter(Boolean).join(' · ') || '构图、机位、运镜、光影、焦点待编辑'
}
