import { Input, Space } from 'antd'
import type { CharacterDescriptionCard, PropDescriptionCard, CostumeDescriptionCard, PlaceDescriptionCard } from '../../../services/generated'

export type DescriptionCard = CharacterDescriptionCard | PropDescriptionCard | CostumeDescriptionCard | PlaceDescriptionCard

/** 四类描述共用名称和正文；类别由卡片类型固定，内部稳定身份不作为编辑字段。 */
export function ObjectDescriptionEditor({ card, disabled, onChange }: {
  card: DescriptionCard; disabled?: boolean; onChange: (card: DescriptionCard) => void
}) {
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Input aria-label="对象名称" aria-required="true" placeholder="名称（同类型内唯一）" maxLength={255} value={card.name || ''} disabled={disabled}
      onChange={event => onChange({ ...card, name: event.target.value, object_id: card.object_id || (event.target.value.trim() ? crypto.randomUUID() : null) })} />
    <Input.TextArea aria-label="对象描述正文" placeholder="描述正文" rows={6} value={card.text || ''} disabled={disabled}
      onChange={event => onChange({ ...card, text: event.target.value })} />
  </Space>
}
