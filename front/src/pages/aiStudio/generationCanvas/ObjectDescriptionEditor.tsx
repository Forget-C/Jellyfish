import { useId } from 'react'
import { EditorAttribute } from './EditorAttribute'
import { Input } from 'antd'
import type { DescriptionCardData } from './DescriptionCard'
import { CardComposer } from './CardComposer'
import './descriptionCard.css'

/** 四类描述共用名称和正文；类别由卡片类型固定，内部稳定身份不作为编辑字段。 */
export function ObjectDescriptionEditor({ card, disabled, onChange }: {
  card: DescriptionCardData; disabled?: boolean; onChange: (card: DescriptionCardData) => void
}) {
  const id = useId()
  const kind = ({ character: '人物', place: '场所', costume: '服装', prop: '道具' } as Record<string,string>)[(card.type || '').split('.')[1]] || '对象'
  const parameters = <EditorAttribute id={id} label="名称" required value={card.name || ''} help="同类型内唯一"><Input id={id} aria-describedby={`${id}-hint`} aria-label="对象名称" aria-required="true" placeholder={`输入${kind}名称`} maxLength={255} value={card.name || ''} disabled={disabled}
      onChange={event => onChange({ ...card, name: event.target.value, object_id: card.object_id || (event.target.value.trim() ? crypto.randomUUID() : null) })} /></EditorAttribute>
  return <div className="generation-description-editor"><CardComposer parametersPosition="top" parameters={parameters}
    status={<span>{disabled && '只读 · '}{card.text?.length || 0} 字</span>}>
    <textarea className="generation-description-input" aria-label="对象描述正文" placeholder="描述正文" value={card.text || ''} readOnly={disabled}
      onChange={event => onChange({ ...card, text: event.target.value })} />
  </CardComposer></div>
}
