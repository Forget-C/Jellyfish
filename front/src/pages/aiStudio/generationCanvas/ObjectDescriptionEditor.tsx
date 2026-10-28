import { Input, Select, Space } from 'antd'
import type { ObjectDescriptionCard, PlaceDescriptionCard } from '../../../services/generated'

type DescriptionCard = ObjectDescriptionCard | PlaceDescriptionCard

/** 描述与关系独立；名称编辑建立稳定身份，类别始终通过明确字段维护。 */
export function ObjectDescriptionEditor({ card, disabled, onChange }: {
  card: DescriptionCard; disabled?: boolean; onChange: (card: DescriptionCard) => void
}) {
  return <Space direction="vertical" style={{ width: '100%' }}>
    {card.type === 'content.object' && <Select aria-label="对象类别" value={card.category || 'character'} disabled={disabled}
      options={[{ value: 'character', label: '人物' }, { value: 'prop', label: '道具' }, { value: 'costume', label: '服装' }]}
      onChange={category => onChange({ ...card, category })} />}
    <Input aria-label="对象名称" placeholder="对象名称" value={card.name || ''} disabled={disabled}
      onChange={event => onChange({ ...card, name: event.target.value, object_id: card.object_id || (event.target.value.trim() ? crypto.randomUUID() : null) })} />
    <small>{card.object_id ? `对象身份：${card.object_id}` : '未命名对象不提供对象引用'}</small>
    <Input aria-label="描述来源定位" placeholder="描述来源定位（可选）" value={card.source_locator || ''} disabled={disabled}
      onChange={event => onChange({ ...card, source_locator: event.target.value })} />
    <Input.TextArea aria-label="对象描述正文" placeholder="描述正文" rows={6} value={card.text || ''} disabled={disabled}
      onChange={event => onChange({ ...card, text: event.target.value })} />
    <small>正文通过文本出口独立采用；对象引用只提供身份、名称与类别。</small>
  </Space>
}
