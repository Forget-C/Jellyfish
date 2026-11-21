import { useUiText } from '../../../uiText'
import { DesignParameterTabs } from './DesignParameterTabs'
import { PlayCircleOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { DesignPresetEditor } from './DesignPresetEditor'
import { DesignNameField } from './DesignNameField'
import { DesignScopePopover } from './DesignScopePopover'
import { performancePresets } from './performancePresets'
import { applyPreset } from './visualPresets'
import { designFieldEntries } from './designFieldReferences'
import { designSummary } from './designSummary'
import { InputNumber } from 'antd'
import type { SpatialAnchorCard, BlockingDirectionCard, InFrameActivityCard, EnvironmentActivityCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as FieldEditor } from './DesignReferenceEditor'
import { useGraphRules } from './CanvasCatalogContext'

export type SpatialCard = SpatialAnchorCard | BlockingDirectionCard | InFrameActivityCard | EnvironmentActivityCard

function AnchorFields({ card, onChange }: { card: SpatialAnchorCard; onChange: (card: SpatialCard) => void }) {
  const uiText = useUiText()
  return <div className="design-preset-fields performance-parameters">

    <FieldEditor compact label={uiText("位置")} value={card.position} onChange={position => onChange({ ...card, position })} />
    <FieldEditor compact label={uiText("方位与朝向")} value={card.orientation} onChange={orientation => onChange({ ...card, orientation })} />
    <FieldEditor compact label={uiText("空间关系")} value={card.spatial_relation} onChange={spatial_relation => onChange({ ...card, spatial_relation })} />
    <FieldEditor compact label={uiText("尺度依据")} value={card.scale} onChange={scale => onChange({ ...card, scale })} />
  </div>
}

function BlockingFields({ card, onChange }: { card: BlockingDirectionCard; onChange: (card: SpatialCard) => void }) {
  const uiText = useUiText()
  return <div className="design-preset-fields performance-parameters">

    <FieldEditor compact label={uiText("位置")} value={card.position} onChange={position => onChange({ ...card, position })} />
    <FieldEditor compact label={uiText("路径")} value={card.path} onChange={path => onChange({ ...card, path })} />
    <FieldEditor compact label={uiText("方位与朝向")} value={card.orientation} onChange={orientation => onChange({ ...card, orientation })} />
    <FieldEditor compact label={uiText("主动权")} value={card.initiative} onChange={initiative => onChange({ ...card, initiative })} />
    <FieldEditor compact label={uiText("状态切换原因")} value={card.transition_reason} onChange={transition_reason => onChange({ ...card, transition_reason })} />

  </div>
}

function ActivityFields({ card, onChange, editorOpen }: { card: InFrameActivityCard; onChange: (card: SpatialCard) => void; editorOpen?: boolean }) {
  const uiText = useUiText()
  const field = (key: 'task' | 'main_action_effect' | 'exit_state' | 'intensity' | 'path' | 'entry_exit' | 'depth' | 'attention' | 'delay_basis', label: string, labelAction?: React.ReactNode) => <FieldEditor key={key} compact label={label} labelAction={labelAction} value={card[key]} onChange={value => onChange({ ...card, [key]: value })} />
  return <DesignParameterTabs editorOpen={editorOpen} items={[
    { key: 'activity', fields: ["task", "main_action_effect", "intensity", "exit_state"], label: <><PlayCircleOutlined /> {uiText("活动内容")}</>, children: <div className="design-preset-fields design-preset-fields-compact">
      {field('task', uiText("持续任务"))}{field('main_action_effect', uiText("对主戏的作用"))}{field('intensity', uiText("活动强度"))}{field('exit_state', uiText("结束状态"))}
    </div> },
    { key: 'space', fields: ["path", "entry_exit", "depth", "attention", "delay_basis"], label: <><ClockCircleOutlined /> {uiText("空间与时序")}</>, children: <div className="design-preset-fields design-preset-fields-compact">
      {field('path', uiText("路径"))}{field('entry_exit', uiText("入出画"))}{field('depth', uiText("景深层次"))}{field('attention', uiText("注意对象说明"))}
      {field('delay_basis', uiText("反应延迟依据"), <span className="design-delay-control"><InputNumber size="small" aria-label={uiText("反应延迟毫秒")} min={0} value={card.delay_ms} onChange={delay_ms => onChange({ ...card, delay_ms })} /> ms</span>)}
    </div> },
  ]} />
}

function EnvironmentFields({ card, onChange }: { card: EnvironmentActivityCard; onChange: (card: SpatialCard) => void }) {
  const uiText = useUiText()
  return <div className="design-preset-fields performance-parameters"><FieldEditor compact label={uiText("环境活动")} value={card.activity} onChange={activity => onChange({ ...card, activity })} />
    <FieldEditor compact label={uiText("刻意留白")} value={card.empty_space} onChange={empty_space => onChange({ ...card, empty_space })} />
    <FieldEditor compact label={uiText("留白理由")} value={card.reason} onChange={reason => onChange({ ...card, reason })} />
  </div>
}

/** 四种空间设计复用预设与字段引用；关系仍只采用明确身份。 */
export function SpatialDirectionEditor({ card: raw, onChange, disabled, editorOpen, onUndoDesign }: CardRendererProps) {
  const uiText = useUiText()
  const { cardDefinitions } = useGraphRules()
  const card = raw as SpatialCard
  const update = (next: SpatialCard) => onChange(next)
  const fields = Object.fromEntries(designFieldEntries(card))
  const labels = Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.label]))
  const relations = (card.type === 'direction.anchor' || card.type === 'direction.blocking') && <DesignNameField label={card.type === 'direction.anchor' ? uiText("锚点名称") : uiText("调度名称")} placeholder={card.type === 'direction.anchor' ? uiText("例如：窗边桌角") : uiText("例如：从门口走向窗边")} value={card.name} disabled={disabled} onChange={name => onChange({ ...card, name })} />
  return <DesignPresetEditor scopeTools={<DesignScopePopover card={card} onChange={update} disabled={disabled} editorOpen={editorOpen} />} fields={fields} labels={labels} presets={performancePresets[card.type!.split('.')[1]] || []} current={designSummary([], Object.values(fields))} additionalDesign={'delay_ms' in card && typeof card.delay_ms === 'number'} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} direct={card.type === 'direction.anchor'} relations={card.type === 'direction.environment' ? undefined : relations} onApply={preset => onChange({ ...card, ...applyPreset(fields, preset) } as SpatialCard)}>
    <div ><div>
    {card.type === 'direction.anchor' ? <AnchorFields card={card as SpatialAnchorCard} onChange={update} /> : card.type === 'direction.blocking' ? <BlockingFields card={card as BlockingDirectionCard} onChange={update} /> : card.type === 'direction.activity' ? <ActivityFields card={card as InFrameActivityCard} onChange={update} editorOpen={editorOpen} /> : <EnvironmentFields card={card as EnvironmentActivityCard} onChange={update} />}
    </div></div>

  </DesignPresetEditor>
}

export function spatialSummary(card: SpatialCard) {
  const preferred = card.type === 'direction.anchor' ? [(card as SpatialAnchorCard).position]
    : card.type === 'direction.blocking' ? [(card as BlockingDirectionCard).position, (card as BlockingDirectionCard).path]
    : card.type === 'direction.activity' ? [(card as InFrameActivityCard).task, (card as InFrameActivityCard).exit_state]
    : [(card as EnvironmentActivityCard).activity, (card as EnvironmentActivityCard).empty_space]
  const summary = designSummary(preferred, Object.values(card))
  if (summary) return summary
  return card.type === 'direction.anchor' ? `${card.name || '未命名锚点'} · 位置待定` : card.type === 'direction.blocking' ? `${card.name || '未命名调度'} · 位置待定 → 路径待定` : card.type === 'direction.activity' ? '持续任务待定 → 结束状态待定' : '活动待定 · 留白待定'
}
