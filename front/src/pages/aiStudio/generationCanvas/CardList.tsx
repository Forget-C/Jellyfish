import { useRef, useState } from 'react'
import { Input } from 'antd'
import { AppstoreOutlined, CloseOutlined, IdcardOutlined, ThunderboltOutlined, CameraOutlined, NodeIndexOutlined, VideoCameraOutlined, SoundOutlined, SafetyCertificateOutlined, FileTextOutlined, PictureOutlined, PlaySquareOutlined } from '@ant-design/icons'
import type { CanvasCatalog } from '../../../services/generated'
import { WorkbenchButton, WorkbenchIconButton } from '../directing/ui/WorkbenchButton'

type CardEntry = { type: string; title: string; entry?: string; modality: string }

export const cardDragType = 'application/x-jellyfish-card-type'
export const cardDragEntry = 'application/x-jellyfish-card-entry'
const categories = [
  { title: '基础卡', icon: <AppstoreOutlined /> }, { title: '参考卡', icon: <IdcardOutlined /> },
  { title: '模型生成', icon: <ThunderboltOutlined /> }, { title: '画面设计', icon: <CameraOutlined /> },
  { title: '表演与调度', icon: <NodeIndexOutlined /> }, { title: '叙事与镜头', icon: <VideoCameraOutlined /> },
  { title: '声音设计', icon: <SoundOutlined /> }, { title: '连续性与约束', icon: <SafetyCertificateOutlined /> },
]

/** 八组只组织添加导航；摄影的五入口创建独立设计而非五种内容类型。 */
export function CardList({ catalog, readonly, onAdd, active, onActiveChange: setActive }: { catalog: CanvasCatalog; readonly: boolean; onAdd: (type: string, entry?: string) => void; active?: string; onActiveChange: (category?: string) => void }) {
  const [query, setQuery] = useState('')
  const triggers = useRef<Record<string, HTMLElement | null>>({})
  const close = () => { setActive(undefined); if (active) triggers.current[active]?.focus() }
  const cards = catalog.cards.filter(card => active === '基础卡' ? card.type.startsWith('content.') : active === '参考卡' ? card.type.startsWith('reference.') : active === '模型生成' ? card.group === active : card.category === active)
  const entries = cards.flatMap<CardEntry>(card => card.type === 'direction.photography'
    ? card.entries.map(entry => ({ type: card.type, title: entry.label, entry: entry.id, modality: card.modality }))
    : [{ type: card.type, title: card.title, entry: undefined, modality: card.modality }])
  const visible = entries.filter(entry => entry.title.includes(query.trim()))
  const add = (type: string, entry?: string) => { onAdd(type, entry); setActive(undefined) }
  const renderEntry = (entry: CardEntry) => <WorkbenchButton key={`${entry.type}:${entry.entry || ''}`} variant="quiet" icon={<span aria-hidden>{entry.modality === 'image' ? <PictureOutlined /> : entry.modality === 'video' ? <PlaySquareOutlined /> : entry.modality === 'audio' ? <SoundOutlined /> : <FileTextOutlined />}</span>} disabled={readonly} draggable={!readonly} onDragStart={event => {
    event.dataTransfer.setData(cardDragType, entry.type)
    if (entry.entry) event.dataTransfer.setData(cardDragEntry, entry.entry)
    event.dataTransfer.effectAllowed = 'copy'
  }} onDragEnd={event => { if (event.dataTransfer.dropEffect !== 'none') setActive(undefined) }} onClick={() => add(entry.type, entry.entry)}>{entry.title.replace('内容', '')}</WorkbenchButton>
  return <div className="generation-card-list-host" onKeyDown={event => { if (event.key === 'Escape' && active) { event.stopPropagation(); close() } }}>
    <div className="generation-card-categories" role="toolbar" aria-label="卡片分类">
      {categories.map((category, index) => <WorkbenchIconButton key={category.title} ref={element => { triggers.current[category.title] = element }} variant="quiet" label={category.title} icon={category.icon} className={index === 3 ? 'generation-director-category' : undefined} aria-pressed={active === category.title} aria-expanded={active === category.title} onClick={() => { if (active === category.title) close(); else { setActive(category.title); setQuery('') } }} />)}
    </div>
    {active && <nav className="generation-card-list" aria-label="添加卡片">
      <header><h2>{active}</h2><WorkbenchIconButton label="关闭卡片列表" icon={<CloseOutlined />} onClick={close} /></header>
      <Input autoFocus type="search" aria-label="搜索卡片" placeholder="搜索卡片" value={query} allowClear onChange={event => setQuery(event.target.value)} />
      {active === '基础卡' ? <>{(['text', 'media'] as const).map(section => <section key={section}><h3>{section === 'text' ? '文本描述' : '媒体内容'}</h3>{visible.filter(entry => section === 'text' ? entry.modality === 'text' : entry.modality !== 'text').map(renderEntry)}</section>)}</> : <section>{visible.map(renderEntry)}</section>}
      {!visible.length && <p>没有匹配的卡片</p>}
      {readonly && <p role="status">当前只读，不能添加卡片</p>}
    </nav>}
  </div>
}
