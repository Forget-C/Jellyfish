import type { ComponentType } from 'react'
import { Input } from 'antd'
import type { TextContentCard } from '../../../services/generated'

export type ContentRendererProps = { card: TextContentCard; onChange: (card: TextContentCard) => void }

/** 类型入口由实际文本消费者使用；参数和编辑行为留在专属组件。 */
export const rendererRegistry: Record<string, ComponentType<ContentRendererProps>> = {
  'content.text': ({ card, onChange }: ContentRendererProps) => (
    <Input.TextArea aria-label="文本内容" value={card.text} rows={6}
      onChange={event => onChange({ ...card, text: event.target.value })} />
  ),
}
