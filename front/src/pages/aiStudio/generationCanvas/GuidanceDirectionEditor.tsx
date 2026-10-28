import { Alert, Input, Select } from 'antd'
import type { AcceptanceCriterionCard, CreativeControlCard, GenerationGuidanceCard, DesignField } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { cardTitles, inputPorts } from './graphRules'
import { useCardCandidates } from './useCardCandidates'
import { sourceKey } from './promptRules'
import { DesignFieldEditor } from './DesignFieldEditor'
import { DesignMediaExamples } from './DesignMediaExamples'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'

export type GuidanceCard = AcceptanceCriterionCard | CreativeControlCard | GenerationGuidanceCard

/** 要求正文、明确对象关系、固定示例和只读使用记录分别展示。 */
export function GuidanceDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled }: CardRendererProps) {
  const card = raw as GuidanceCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const bindings = card.input_bindings || []
  const field = (key: string, label: string, purpose: DesignField['purpose'] = 'design') => <DesignFieldEditor key={key} label={label} purpose={purpose} value={(card as unknown as Record<string, DesignField>)[key]} onChange={value => onChange({ ...card, [key]: value })} />
  const users = document.cards?.filter(consumer => 'input_bindings' in consumer && consumer.input_bindings?.some(binding => binding.input_port === 'acceptance_basis' && binding.source.card_id === card.id && binding.source.port_id === 'criterion')) || []
  return <>
    <p>完整采用本卡要求。参考绑定要求不自动选择素材；判断标准不代表生成结果已经通过验收。不对自由正文或图片内容纠错。</p>
    <Input aria-label="要求名称" value={card.name} onChange={event => onChange({ ...card, name: event.target.value })} />
    {card.type === 'direction.creative_control' && <>{field('freedom', '创作控制程度')}{field('allowed_range', '允许发挥范围')}{field('keep', '需要保持', 'constraint')}{field('undecided', '待确定事项')}</>}
    {card.type === 'direction.guidance' && <>{field('priority', '编译优先级')}{field('reference_requirements', '参考绑定要求')}{field('sound_strategy', '声音策略')}{field('prohibitions', '禁止项', 'constraint')}</>}
    {card.type === 'direction.criterion' && <>{field('standard', '可观察判断标准', 'constraint')}<section role="region" aria-label="被使用记录"><h3>被使用记录 · 只读</h3><p>仅列出明确关联本要求的卡片，连接候选不计入；关联不代表素材审查通过。</p>{users.length ? users.map(consumer => <p key={consumer.id}>{'name' in consumer && consumer.name || cardTitles[consumer.type || ''] || consumer.type}</p>) : <small>尚未被采用</small>}</section></>}
    {resolved.error && <Alert type="warning" message={resolved.error} />}
    <details><summary>作用对象</summary><p>只关联直接候选的身份和名称，不读取来源正文。验收要求不反向绑定镜头等使用方。</p>
      {resolved.candidates.filter(item => ['object_reference', 'spatial_reference', 'narrative_reference'].includes(item.payload?.kind || '') && !(card.type === 'direction.criterion' && item.payload?.kind === 'narrative_reference' && 'category' in item.payload && item.payload.category === 'shot')).map(item => {
        const bound = bindings.find(binding => binding.input_port === 'effect_object' && sourceKey(binding.source) === sourceKey(item.source))
        const name = item.payload && 'name' in item.payload ? item.payload.name : ''
        return <WorkbenchButton key={sourceKey(item.source)} disabled={disabled || !item.available} onClick={() => onChange({ ...card, input_bindings: bound ? bindings.filter(value => value.id !== bound.id) : [...bindings, { id: crypto.randomUUID(), input_port: 'effect_object', source: item.source }] })}>{`${bound ? '取消' : '选择'}作用对象 ${name}`}</WorkbenchButton>
      })}
      {bindings.filter(binding => !resolved.candidates.some(item => sourceKey(item.source) === sourceKey(binding.source) && item.available)).map(binding => <div key={binding.id}><small role="alert">已选对象失效</small><WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效对象</WorkbenchButton></div>)}
    </details>
    <DesignMediaExamples ports={inputPorts(card)} examples={card.examples || []} candidates={resolved.candidates} disabled={disabled} onChange={examples => onChange({ ...card, examples })} />
    <details><summary>适用范围与来源</summary><Input aria-label="要求适用范围" value={card.scope?.description} onChange={event => onChange({ ...card, scope: { ...card.scope, description: event.target.value } })} /><Select aria-label="要求制作阶段" allowClear value={card.scope?.phase || undefined} options={[{ value: 'video', label: '画面／视频' }, { value: 'sound', label: '声音' }, { value: 'postproduction', label: '后期' }]} onChange={phase => onChange({ ...card, scope: { ...card.scope, phase: phase ?? null } })} /><Input aria-label="要求适用条件" value={card.scope?.condition} onChange={event => onChange({ ...card, scope: { ...card.scope, condition: event.target.value } })} /><Input aria-label="要求来源" value={card.source_locator} onChange={event => onChange({ ...card, source_locator: event.target.value })} /></details>
    <section aria-label="完整要求输出"><h3>已保存完整要求 · revision {resolved.revision}</h3>{resolved.outputs.filter(item => item.source.port_id === 'text').map(item => <CanvasTextPreview key={sourceKey(item.source)} text={item.text || ''} label="完整要求" />)}</section>
  </>
}

export function guidanceSummary(card: GuidanceCard) {
  const field = card.type === 'direction.criterion' ? card.standard : card.type === 'direction.guidance' ? card.priority : (card as CreativeControlCard).freedom
  return `${card.name || '未命名要求'} · ${field?.text || '内容待定'}`
}
