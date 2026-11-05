import { designPhaseLabel } from './designScope'
import { ConfigProvider } from 'antd'
import { useEffect, useId, useState } from 'react'
import type { CanvasDocument } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { MediaPreview } from './MediaContentEditor'
import { designFieldMetadata } from './designFieldMetadata'
import './acceptanceBasis.css'

/** 查看选择仅属于当前 Modal 会话；解除关联与断线使用同一画布操作。 */
export function AcceptanceBasisSelector({ card, document, onLocateDesign, disabled, onDisconnect, editorOpen }: { card: GenerationCard; document: CanvasDocument; disabled?: boolean; editorOpen?: boolean; onDisconnect: (edgeId: string) => void; onLocateDesign?: (cardId: string, fieldId: string) => void }) {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState<string>()
  const panelId = useId()
  const sources = document.cards?.filter(source => source.type === 'direction.criterion' && 'input_bindings' in card && card.input_bindings?.some(binding => binding.input_port === 'acceptance_basis' && binding.source.card_id === source.id)) || []
  const current = sources.find(source => source.id === selected) || sources[0]
  const sourceIds = sources.map(source => source.id).join(',')
  useEffect(() => { if (!editorOpen || !sourceIds) { setOpen(false); setSelected(undefined) } }, [editorOpen, sourceIds])
  const selectedExists = sources.some(source => source.id === selected), firstId = sources[0]?.id
  useEffect(() => { if (selected && !selectedExists) setSelected(firstId) }, [selectedExists, firstId, selected])
  if (!sources.length || !current || !('standard' in current)) return null
  const text = current.standard?.document ? current.standard.document.segments?.map(part => part.kind === 'text' ? part.text : '@' + (() => { const source = document.cards?.find(source => source.id === part.source.card_id); return source && 'name' in source && source.name || part.source.card_id })()).join('') : current.standard?.text
  const metadata = designFieldMetadata(current.standard, { purpose: 'constraint' })
  const edge = document.edges?.find(item => item.source_card === current.id && item.target_card === card.id && item.target_port === 'acceptance_basis')
  const objects = current.input_bindings?.filter(binding => binding.input_port === 'effect_object').map(binding => document.cards?.find(source => source.id === binding.source.card_id)).filter(Boolean)
  return <section className="acceptance-basis" aria-label="关联的验收要求">
    <button type="button" className="acceptance-toggle" aria-expanded={open} aria-controls={panelId} aria-label={`${open ? '收起' : '展开'}验收要求`} title={`${open ? '收起' : '展开'}验收要求`} onClick={() => setOpen(value => !value)}><span aria-hidden="true">{open ? '▴' : '▾'}</span></button>
    <div id={panelId} hidden={!open}>
      <h3>关联的验收要求 · {sources.length}</h3>
      <div className="acceptance-thumbnails">{sources.map(source => <button type="button" key={source.id} aria-pressed={source.id === current.id} onClick={() => setSelected(source.id)}><strong>▣ {'name' in source && source.name || '未命名验收要求'}</strong><span>{'standard' in source && source.standard?.text || '标准尚未填写'}</span></button>)}</div>
      <section className="acceptance-detail" aria-label="验收要求详情"><h4>{current.name || '未命名验收要求'}</h4><strong>可观察判断标准</strong><CanvasTextPreview text={text || '标准尚未填写'} label="验收标准" />
        {metadata && <small className="design-field-metadata">{metadata}</small>}
        {!!objects?.length && <p>作用对象：{objects.map(source => source && 'name' in source && source.name || source?.id).join('、')}</p>}
        {current.scope?.description && <p>内容适用范围：{current.scope.description}</p>}
        {current.scope?.phase && <p>制作阶段：{designPhaseLabel(current.scope.phase)}</p>}
        {current.scope?.condition && <p>适用条件：{current.scope.condition}</p>}
        {current.source_locator && <small className="design-field-metadata">卡片原始来源：{current.source_locator}</small>}
        {!!current.examples?.length && <section aria-label="参考示例">{current.examples.map(example => <div key={example.id}><p>{example.purpose === 'negative' ? '反例' : '正向示例'}{example.description && `：${example.description}`}</p><MediaPreview fileId={example.file_id} type={example.source.port_id === 'video' ? 'video' : example.source.port_id === 'audio' ? 'audio' : 'image'} />{example.start_ms !== null && example.start_ms !== undefined && <small>参考区间：{example.start_ms}–{example.end_ms} 毫秒</small>}</div>)}</section>}
        <div className="acceptance-actions"><ConfigProvider componentDisabled={false}><WorkbenchButton variant="quiet" disabled={!onLocateDesign} onClick={() => onLocateDesign?.(current.id, 'standard')}>定位源卡</WorkbenchButton></ConfigProvider><WorkbenchButton variant="quiet" disabled={disabled || !edge} onClick={() => edge && onDisconnect(edge.id)}>解除关联</WorkbenchButton></div>
      </section>
    </div>
  </section>
}
