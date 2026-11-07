import type { TooltipRef } from 'antd/es/tooltip'
import { cardCategories } from './CardList'
import { useGraphRules } from './CanvasCatalogContext'
import { sourceKey } from './promptRules'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ConfigProvider, Popover, theme } from 'antd'
import { ArrowLeftOutlined, AuditOutlined, IdcardOutlined, ExclamationCircleOutlined, FileTextOutlined, PictureOutlined, SoundOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { MaterialReferenceButton } from './MaterialReferenceButton'
import { associationIssues, type AssociationSource } from './associationSources'
import './canvasAssociations.css'

export type AssociationEntry = AssociationSource & {
  label: string
  description: string
  used: boolean
  issue?: string
}
export type AssociationDetailContext = { close: (restoreFocus?: boolean) => void }

/** 共用来源导航和浮层会话，采用与解除仍由接收卡提供的操作处理。 */
export function CanvasAssociations({ entries, sourceActions, loading, error, sessionKey, renderDetails, onInspect, expanded, onLocateSource }: {
  entries: AssociationEntry[]
  sourceActions?: ReactNode
  loading?: boolean
  error?: string
  expanded?: boolean
  sessionKey: string
  renderDetails: (entry: AssociationEntry, context: AssociationDetailContext) => ReactNode
  onLocateSource?: (cardId: string, fieldId: string) => void
  onInspect?: () => void
}) {
  const [width, setWidth] = useState(0)
  const [surface, setSurface] = useState<string>()
  const [detail, setDetail] = useState<string>()
  const owner = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLElement>()
  const popupId = useId()
  const activePopover = useRef<TooltipRef>(null)
  const { token } = theme.useToken()
  const { cardDefinitions } = useGraphRules()
  const groups = (['material', 'design'] as const).map(kind => ({ kind, label: kind === 'material' ? '素材' : '设计', entries: entries.filter(entry => entry.kind === kind) })).filter(group => group.entries.length)
  const gap = width < 470 ? 4 : 8
  const slots = groups.map(() => 1)
  const required = () => (sourceActions ? 64 : 0) + groups.length * (8 - gap) + (groups.length > 1 ? 13 : 0) + groups.reduce((size, group, index) => size + slots[index] * (64 + gap) + (slots[index] < group.entries.length ? 32 + gap : 0), 0)
  const summary = required() > width
  if (summary) slots.fill(0)
  else for (const [index, group] of groups.entries()) {
    while (slots[index] < group.entries.length) {
      slots[index]++
      if (required() > width) { slots[index]--; break }
    }
  }
  const visible = groups.flatMap((group, index) => group.entries.slice(0, slots[index]))
  const visibleIds = visible.map(entry => entry.id).join('|')
  const entryIds = entries.map(entry => entry.id).join('|')
  const entriesRef = useRef(entries); entriesRef.current = entries
  const visibleRef = useRef(visible); visibleRef.current = visible
  const current = entries.find(entry => entry.id === detail)
  const close = useCallback((restoreFocus = true) => {
    setSurface(undefined)
    setDetail(undefined)
    if (restoreFocus) requestAnimationFrame(() => {
      const target = trigger.current?.isConnected ? trigger.current : owner.current?.querySelector<HTMLElement>('.generation-material-add button')
      target?.focus({ preventScroll: true })
    })
  }, [])
  useEffect(() => {
    if (!owner.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(owner.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { setSurface(undefined); setDetail(undefined) }, [sessionKey])
  useEffect(() => {
    if (!surface || !detail) return
    const selected = entriesRef.current.find(entry => entry.id === detail)
    if (!selected) { close(); return }
    if (surface === detail && !visibleRef.current.some(entry => entry.id === detail)) {
      setSurface('more:' + selected.kind)
      trigger.current = owner.current?.querySelector<HTMLElement>(`[data-association-more="${selected.kind}"]`) || undefined
    }
  }, [entryIds, visibleIds, detail, surface, close])
  useEffect(() => {
    if (!surface) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      const editor = owner.current?.closest('.generation-card-editor')
      if (editor?.querySelector('[role="combobox"][aria-expanded="true"]') || document.querySelector('.ant-modal-wrap:not([style*="display: none"]), .ant-image-preview-wrap:not([style*="display: none"])')) return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    document.addEventListener('keydown', escape, true)
    return () => document.removeEventListener('keydown', escape, true)
  }, [surface, close])

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => activePopover.current?.forceAlign())
    return () => cancelAnimationFrame(frame)
  }, [width, surface])

  const popover = (id: string, button: ReactNode, content: ReactNode) => <Popover key={id} ref={surface === id ? activePopover : undefined} placement="bottomLeft" trigger="click" destroyTooltipOnHide open={surface === id}
    overlayClassName={`canvas-workbench-dialog design-source-inspect canvas-association-inspect${expanded ? ' design-source-expanded' : ''}`} content={<div id={popupId}>{content}</div>}
    onOpenChange={open => {
      if (!open) { if (surface === id) close(false); return }
      setDetail(entries.some(entry => entry.id === id) ? id : undefined)
      setSurface(id)
      onInspect?.()
    }}>{button}</Popover>
  const sourceIcon = (entry: AssociationEntry) => {
    if (entry.cardType === 'direction.criterion') return <AuditOutlined />
    if (entry.kind === 'design') return cardCategories.find(category => category.title === cardDefinitions[entry.cardType || '']?.category)?.icon || <FileTextOutlined />
    if (entry.outputs[0].payload?.kind === 'object_reference') return <IdcardOutlined />
    const icons = { text: <FileTextOutlined />, image: <PictureOutlined />, video: <VideoCameraOutlined />, audio: <SoundOutlined /> }
    return icons[entry.outputs[0].modality]
  }
  const details = current && <>
    {current.outputs.flatMap(output => associationIssues(output).filter(issue => issue.fieldId).map((issue, index) => <div role="alert" key={`${output.source.card_id}:${issue.fieldId}:${index}`}>
      <p>{issue.message}</p>
      <WorkbenchButton variant="quiet" disabled={!onLocateSource} onClick={() => { close(false); onLocateSource?.(output.source.card_id, issue.fieldId!) }}>查看问题字段</WorkbenchButton>
    </div>))}
    {renderDetails(current, { close })}
  </>

  return <div className="canvas-associations" aria-label="关联来源" role="region" ref={owner} onClickCapture={event => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('button')
      if (button && owner.current?.contains(button)) trigger.current = button
    }} data-tight={gap === 4}>
    <div className="canvas-associations-row">
      {groups.map((group, index) => {
        const shown = group.entries.slice(0, slots[index]), hidden = group.entries.slice(shown.length)
        const hiddenIssue = hidden.some(entry => entry.issue)
        return <div className="canvas-association-group" key={group.kind} aria-label={group.label}>
          {shown.map(entry => <ConfigProvider key={entry.id} componentDisabled={false}>{popover(entry.id,
            <MaterialReferenceButton output={entry.outputs.find(output => output.file_id) || entry.outputs[0]} label={entry.label} selected={entry.used && !entry.issue} selectedLabel="使用中" icon={entry.kind === 'material' && entry.outputs.some(output => output.file_id) ? undefined : sourceIcon(entry)} issue={entry.issue}
              data-association-id={entry.id} data-design-source={sourceKey(entry.outputs[0].source)}
              aria-label={entry.description} aria-expanded={surface === entry.id} aria-controls={surface === entry.id ? popupId : undefined} title={entry.description} onMouseDown={event => event.preventDefault()} />,
            details)}</ConfigProvider>)}
          {!!hidden.length && <ConfigProvider componentDisabled={false}>{popover('more:' + group.kind,
            <WorkbenchButton variant="quiet" className="canvas-association-more" data-association-more={group.kind} data-summary={summary} title={`${group.label}更多 ${hidden.length} 项`}
              aria-label={`${group.label}更多 ${hidden.length}${hiddenIssue ? '，含异常' : ''}`} aria-expanded={surface === 'more:' + group.kind} aria-controls={surface === 'more:' + group.kind ? popupId : undefined}
              icon={hiddenIssue ? <ExclamationCircleOutlined style={{ color: token.colorWarning }} /> : summary ? group.kind === 'material' ? <PictureOutlined /> : <FileTextOutlined /> : undefined}>{summary ? `${group.label} ${hidden.length}` : `+${hidden.length}`}</WorkbenchButton>,
            current ? <><WorkbenchButton variant="quiet" size="small" icon={<ArrowLeftOutlined />} onClick={() => setDetail(undefined)}>返回{group.label}列表</WorkbenchButton>{details}</> : <div className="canvas-association-list"><strong>{group.label} · {group.entries.length}</strong>{group.entries.map(entry => <WorkbenchButton key={entry.id} variant="quiet" className="canvas-association-list-item" aria-label={entry.description} icon={entry.issue ? <ExclamationCircleOutlined style={{ color: token.colorWarning }} /> : sourceIcon(entry)} onClick={() => setDetail(entry.id)}>{entry.label}<small>{entry.issue || (entry.used ? '使用中' : '候选')}</small></WorkbenchButton>)}</div>)}</ConfigProvider>}
        </div>
      })}
      {sourceActions && <div className="generation-material-add">{sourceActions}</div>}
    </div>
    {(loading || error) && <small className="canvas-association-status" role={error ? 'alert' : 'status'}>{error || '正在读取候选来源…'}</small>}
  </div>
}
