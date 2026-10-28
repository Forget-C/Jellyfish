import { Alert, Input, InputNumber, Select, Space } from 'antd'
import type { CharacterPerformanceCard, CharacterSituationCard, DesignField, PerformanceRuleCard, ObjectReferencePayload } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { useCardCandidates } from './useCardCandidates'
import { sourceKey } from './promptRules'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { MediaPreview } from './MediaContentEditor'

export type PerformanceCard = CharacterPerformanceCard | CharacterSituationCard | PerformanceRuleCard
const states = [{ value: 'empty', label: '未填写' }, { value: 'not_applicable', label: '不适用' }, { value: 'absent', label: '明确没有' }, { value: 'undecided', label: '待确定' }, { value: 'proposal', label: '提议' }, { value: 'fact', label: '事实' }]

/** 同语义字段共享状态控件；各类设计保留自己的编辑布局。 */
export function FieldEditor({ label, value, purpose = 'design', onChange }: { label: string; value?: DesignField; purpose?: DesignField['purpose']; onChange: (field: DesignField) => void }) {
  const field = value || { state: 'empty', text: '', purpose }
  return <section aria-label={label}><strong>{label}</strong><Space wrap>
    <Select aria-label={`${label}状态`} value={field.state} options={states} style={{ width: 110 }} onChange={state => onChange({ ...field, state })} />
    <Select aria-label={`${label}用途`} value={field.purpose} options={[{ value: 'background', label: '背景' }, { value: 'design', label: '设计' }, { value: 'constraint', label: '约束' }]} style={{ width: 100 }} onChange={next => onChange({ ...field, purpose: next })} />
  </Space><Input.TextArea aria-label={`${label}内容`} value={field.text} autoSize={{ minRows: 2, maxRows: 7 }} onChange={event => onChange({ ...field, text: event.target.value, state: field.state === 'empty' ? 'proposal' : field.state })} />
    <Input aria-label={`${label}来源`} placeholder="来源定位（可选）" value={field.source_locator} onChange={event => onChange({ ...field, source_locator: event.target.value })} />
  </section>
}

function SituationFields({ card, onChange }: { card: CharacterSituationCard; onChange: (card: PerformanceCard) => void }) {
  return <><FieldEditor label="当前处境" purpose="background" value={card.situation} onChange={situation => onChange({ ...card, situation })} />
    <FieldEditor label="人物关系" purpose="background" value={card.relationship} onChange={relationship => onChange({ ...card, relationship })} /></>
}

function PerformanceFields({ card, onChange }: { card: CharacterPerformanceCard; onChange: (card: PerformanceCard) => void }) {
  return <>
    <section aria-label="触发反应动作结束"><h3>触发 → 反应 → 动作 → 结束状态</h3><p>触发事件可在事件来源接入后关联；无节拍也可独立使用。</p>
      <FieldEditor label="反应顺序" value={card.reaction_order} onChange={reaction_order => onChange({ ...card, reaction_order })} />
      <FieldEditor label="身体动作" value={card.physical_action} onChange={physical_action => onChange({ ...card, physical_action })} />
      <FieldEditor label="结束状态" value={card.exit_state} onChange={exit_state => onChange({ ...card, exit_state })} />
    </section>
    <details><summary>背景与注意对象</summary>
      <FieldEditor label="人物目标" purpose="background" value={card.objective} onChange={objective => onChange({ ...card, objective })} />
      <FieldEditor label="阻碍" purpose="background" value={card.obstacle} onChange={obstacle => onChange({ ...card, obstacle })} />
      <FieldEditor label="潜台词" purpose="background" value={card.subtext} onChange={subtext => onChange({ ...card, subtext })} />
      <FieldEditor label="注意对象说明" purpose="background" value={card.attention} onChange={attention => onChange({ ...card, attention })} />
      <FieldEditor label="内在调整" purpose="background" value={card.internal_adjustment} onChange={internal_adjustment => onChange({ ...card, internal_adjustment })} />
    </details>
    <details><summary>表演细节与约束</summary>
      <FieldEditor label="目光" value={card.gaze} onChange={gaze => onChange({ ...card, gaze })} />
      <FieldEditor label="呼吸" value={card.breath} onChange={breath => onChange({ ...card, breath })} />
      <FieldEditor label="重心" value={card.weight} onChange={weight => onChange({ ...card, weight })} />
      <FieldEditor label="手部" value={card.hands} onChange={hands => onChange({ ...card, hands })} />
      <FieldEditor label="声音表现" value={card.voice} onChange={voice => onChange({ ...card, voice })} />
      <FieldEditor label="表达方式" value={card.delivery} onChange={delivery => onChange({ ...card, delivery })} />
      <FieldEditor label="避免的表现" purpose="constraint" value={card.avoid} onChange={avoid => onChange({ ...card, avoid })} />
    </details>
  </>
}

/** 明确对象采用及本卡专用设计字段；正式输出只读取后端保存修订。 */
export function PerformanceDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled }: CardRendererProps) {
  const card = raw as PerformanceCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const bindings = card.input_bindings || [], examples = card.examples || []
  const update = (next: PerformanceCard) => onChange(next)
  const participantIds = new Set(bindings.filter(binding => binding.input_port === 'participant').map(binding => binding.source.object_id))
  const exampleUpdate = (id: string, patch: Partial<(typeof examples)[number]>) => update({ ...card, examples: examples.map(item => item.id === id ? { ...item, ...patch } : item) })
  return <>
    <p>按完整设计采用；背景解释情境，设计表达呈现，约束保留限制。对象关系仅提供身份和名称；描述或图片须在模型端另行直接采用。</p>
    {resolved.error && <Alert type="warning" message={resolved.error} />}
    <section aria-label="对象关系"><h3>对象关系</h3>
      {resolved.candidates.filter(item => item.payload?.kind === 'object_reference').map(item => {
        const object = item.payload as ObjectReferencePayload
        if (object?.kind !== 'object_reference') return null
        return <div key={sourceKey(item.source)}><span>{object.name} · {{ character: '人物', prop: '物件', costume: '服装', place: '场所' }[object.category]}</span>{(['participant', 'effect_object'] as const).map(port => {
          if (port === 'participant' && (card.type === 'direction.performance_rule' || !['character', 'prop'].includes(object.category))) return null
          if (!document.edges?.some(edge => edge.target_card === card.id && edge.target_port === port && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)) return null
          const binding = bindings.find(value => value.input_port === port && sourceKey(value.source) === sourceKey(item.source))
          const label = port === 'participant' ? '参与对象' : '作用对象'
          return <WorkbenchButton key={port} disabled={disabled || !binding && port === 'participant' && participantIds.size > 0 && !participantIds.has(object.object_id)} onClick={() => update({ ...card, input_bindings: binding ? bindings.filter(value => value.id !== binding.id) : [...bindings, { id: crypto.randomUUID(), source: item.source, input_port: port }] })}>{`${binding ? '取消' : '选择'}${label} ${object.name}`}</WorkbenchButton>
        })}</div>
      })}
      {!bindings.length && <small>尚未选择对象。文本分析可完善不完整设计；视觉生成所需主体须明确。</small>}
      {bindings.filter(binding => !resolved.candidates.some(item => sourceKey(item.source) === sourceKey(binding.source) && item.available)).map(binding => <div key={binding.id}><small role="alert">已采用对象缺失，请替换或取消</small><WorkbenchButton disabled={disabled} onClick={() => update({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效对象关系</WorkbenchButton></div>)}
    </section>
    {card.type === 'direction.situation' ? <SituationFields card={card} onChange={update} /> : card.type === 'direction.performance' ? <PerformanceFields card={card} onChange={update} /> : <FieldEditor label="表演适用说明" purpose="constraint" value={(card as PerformanceRuleCard).applicability} onChange={applicability => update({ ...(card as PerformanceRuleCard), applicability })} />}
    <details><summary>适用范围、阶段与来源</summary>
      <Input aria-label="适用范围" value={card.scope?.description} onChange={event => update({ ...card, scope: { ...card.scope, description: event.target.value } })} />
      <Select aria-label="制作阶段" allowClear placeholder="必要制作阶段（可选）" value={card.scope?.phase || undefined} options={[{ value: 'video', label: '画面／视频' }, { value: 'sound', label: '声音' }, { value: 'postproduction', label: '后期' }]} onChange={phase => update({ ...card, scope: { ...card.scope, phase: phase ?? null } })} />
      <Input aria-label="适用条件" value={card.scope?.condition} onChange={event => update({ ...card, scope: { ...card.scope, condition: event.target.value } })} />
      <Input aria-label="设计来源" value={card.source_locator} onChange={event => update({ ...card, source_locator: event.target.value })} />
    </details>
    {card.type !== 'direction.situation' && <details><summary>正向示例与反例</summary><p>示例不随设计文本传给模型；需要时请在模型端直接采用。</p>
      {resolved.candidates.filter(item => ['image', 'video'].includes(item.modality) && item.file_id).map(item => <WorkbenchButton key={sourceKey(item.source)} disabled={disabled || item.available === false} onClick={() => update({ ...card, examples: [...examples, { id: crypto.randomUUID(), source: item.source, file_id: item.file_id!, purpose: 'positive' }] })}>关联示例 {item.token}</WorkbenchButton>)}
      {examples.map(example => <section key={example.id} aria-label={`示例 ${example.id}`}><MediaPreview fileId={example.file_id} type={example.source.port_id === 'video' ? 'video' : 'image'} />
        <Select aria-label="示例用途" value={example.purpose} options={[{ value: 'positive', label: '正向示例' }, { value: 'negative', label: '反例' }]} onChange={purpose => exampleUpdate(example.id, { purpose })} />
        <Input aria-label="示例说明" value={example.description} onChange={event => exampleUpdate(example.id, { description: event.target.value })} />
        {example.source.port_id === 'video' && <Space><InputNumber aria-label="示例起点毫秒" min={0} value={example.start_ms} onChange={start => exampleUpdate(example.id, start === null ? { start_ms: null, end_ms: null } : { start_ms: start, end_ms: Math.max(example.end_ms || 0, start + 1) })} />
          <InputNumber aria-label="示例终点毫秒" min={(example.start_ms || 0) + 1} value={example.end_ms} onChange={end => exampleUpdate(example.id, end === null ? { start_ms: null, end_ms: null } : { start_ms: example.start_ms || 0, end_ms: end })} /></Space>}
        <WorkbenchButton disabled={disabled} onClick={() => update({ ...card, examples: examples.filter(value => value.id !== example.id) })}>取消示例</WorkbenchButton>
      </section>)}
    </details>}
    <section aria-label="完整设计输出"><h3>已保存完整设计 · revision {resolved.revision}</h3>{resolved.outputs.map(item => <CanvasTextPreview key={sourceKey(item.source)} text={item.text || ''} label="完整设计" />)}</section>
  </>
}

export function performanceSummary(card: PerformanceCard) {
  if (card.type === 'direction.situation') { const situation = card as CharacterSituationCard; return `${situation.situation?.text || '未填写处境'} · ${situation.relationship?.text || '未填写关系'}` }
  if (card.type === 'direction.performance_rule') return (card as PerformanceRuleCard).applicability?.text || '未填写表演适用规则'
  const performance = card as CharacterPerformanceCard
  return `触发 → ${performance.reaction_order?.text || '反应待定'} → ${performance.physical_action?.text || '动作待定'} → ${performance.exit_state?.text || '结束状态待定'}`
}
