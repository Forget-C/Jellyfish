import { useRef, useState } from 'react'
import { Input } from 'antd'
import { PlusOutlined, CloseOutlined } from '@ant-design/icons'
import type { CanvasCatalog } from '../../../services/generated'
import { WorkbenchButton, WorkbenchIconButton } from '../directing/ui/WorkbenchButton'

export const cardDragType = 'application/x-jellyfish-card-type'

/** 目录只负责显式建卡，拖放完成前不修改文档或输入关系。 */
export function CardList({ catalog, readonly, onAdd }: { catalog: CanvasCatalog; readonly: boolean; onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const trigger = useRef<HTMLElement>(null)
  const close = () => { setOpen(false); trigger.current?.focus() }
  return <div className="director-canvas-tools generation-card-list-host">
    <WorkbenchIconButton ref={trigger} variant="quiet" label="添加卡片" icon={<PlusOutlined />} aria-expanded={open} onClick={() => setOpen(value => !value)} />
    {open && <nav className="generation-card-list" aria-label="添加卡片" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <header><strong>卡片列表</strong><WorkbenchIconButton label="关闭卡片列表" icon={<CloseOutlined />} onClick={close} /></header>
      <Input type="search" aria-label="搜索卡片" placeholder="搜索卡片" value={query} allowClear onChange={event => setQuery(event.target.value)} />
      {(['基础内容', '模型生成', '导演工具箱'] as const).map(group => {
        const cards = catalog.cards.filter(card => card.group === group && `${card.title} ${card.category || ''}`.includes(query.trim()))
        return cards.length > 0 && <section key={group}><h2>{group}</h2>{cards.map(card => <div key={card.type}>
          {card.category && <small>{card.category}</small>}
          <WorkbenchButton disabled={readonly} draggable={!readonly} onDragStart={event => { event.dataTransfer.setData(cardDragType, card.type); event.dataTransfer.effectAllowed = 'copy' }} onClick={() => onAdd(card.type)}>添加{card.title.replace('内容', '')}</WorkbenchButton>
        </div>)}</section>
      })}
      {!catalog.cards.some(card => `${card.title} ${card.category || ''}`.includes(query.trim())) && <p>没有匹配的卡片</p>}
      {readonly && <p role="status">当前只读，不能添加卡片</p>}
    </nav>}
  </div>
}
