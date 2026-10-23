import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { Alert, Button, Input, Select, Space } from 'antd'
import { StudioGenerationCanvasesService as Canvases, LlmService } from '../../../services/generated'
import type { CanvasDocument, CanvasModelCapability, ModelRead } from '../../../services/generated'
import { CanvasDragHandle, CanvasEdge, useCanvasViewport } from '../../../components/canvas/Canvas'
import { useGraphLayout } from '../directing/useGraphLayout'
import type { GraphArrange, GraphSize } from '../directing/graphLayout'
import { referenceProtection } from './promptRules'
import { CardShell } from './CardShell'
import { rendererRegistry } from './rendererRegistry'
import { cardTitles, connect, connectionReason, disconnect, inputPorts, outputPorts, portLabels } from './graphRules'
import type { GenerationCard, GenerationEdge } from './graphRules'
import './generationCanvas.css'

const arrange: GraphArrange = (nodes, _sizes, _width, _anchor, retained = {}) => Object.fromEntries(nodes.map((node, index) =>
  [node.id, retained[node.id] || { x: index % 3 * 440, y: Math.floor(index / 3) * 560 }]))

/** 独立画布编辑适配：候选关系与文档持久化，几何沿用公共布局缓存。 */
export function GenerationCanvasGraph({ document, onChange, readonly = false }: { document: CanvasDocument; onChange: (next: CanvasDocument) => void; readonly?: boolean }) {
  const cards = document.cards || [], edges = document.edges || [], groups = document.groups || []
  const [selected, setSelected] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [storageError, setStorageError] = useState('')
  const [models, setModels] = useState<ModelRead[]>([])
  const [capabilities, setCapabilities] = useState<Record<string, CanvasModelCapability>>({})
  const [capabilityErrors, setCapabilityErrors] = useState<Record<string, string>>({})
  const [measured, setMeasured] = useState<Record<string, GraphSize>>({})
  const [drag, setDrag] = useState<{ card: string; port: string; x: number; y: number }>()
  const latest = useRef(document); latest.current = document
  const container = useRef<HTMLDivElement>(null)
  const hidden = new Set(groups.filter(group => group.collapsed).flatMap(group => group.card_ids || []))
  const hiddenIdentity = [...hidden].join('|')
  // 折叠成员在新浏览器没有本地测量；保留几何占位，不能让整个布局永远等待隐藏 DOM。
  const layoutMeasurements = useMemo(() => ({ ...Object.fromEntries([...hidden].map(id => [id, { width: 400, height: 350 }])), ...measured }), [measured, hiddenIdentity])
  const nodes = useMemo(() => cards.map(card => ({ id: card.id })), [cards.map(card => card.id).join('|')])
  const layout = useGraphLayout({ storageKey: `jellyfish:generation-layout:${document.project_id}:${document.id}`, viewId: 'canvas',
    initialTop: 104, anchorId: cards[0]?.id || '', validIds: [...cards.map(card => card.id), ...groups.map(group => group.id)], arrange,
    onStorageError: setStorageError }, nodes, layoutMeasurements, container.current?.clientWidth || 1200)
  const transform = layout.view.transform
  const viewport = useCanvasViewport(document.id, transform, update => layout.setView(previous => ({ ...previous,
    transform: typeof update === 'function' ? update(previous.transform) : update })), { x: 2000, y: 1800 })
  const modelIds = cards.filter(card => 'model_id' in card).map(card => 'model_id' in card ? card.model_id : '').filter(Boolean).join('|')
  useEffect(() => {
    let active = true
    LlmService.listModelsApiV1LlmModelsGet({ pageSize: 100 }).then(response => { if (active) setModels(response.data?.items || []) }).catch(() => { if (active) setReason('模型列表读取失败，请刷新后重试') })
    return () => { active = false }
  }, [document.id])
  useEffect(() => {
    let active = true
    setCapabilities({}); setCapabilityErrors({})
    for (const modelId of new Set(modelIds.split('|').filter(Boolean))) {
      Canvases.canvasModelCapability({ projectId: document.project_id, canvasId: document.id, modelId }).then(response => {
        if (active && response.data) setCapabilities(previous => ({ ...previous, [modelId]: response.data! }))
      }).catch(() => { if (active) setCapabilityErrors(previous => ({ ...previous, [modelId]: '模型能力读取失败，原配置和连接已保留' })) })
    }
    return () => { active = false }
  }, [document.id, modelIds])
  useEffect(() => {
    const root = container.current
    if (!root) return
    const observer = new ResizeObserver(entries => setMeasured(previous => {
      const next = { ...previous }; let changed = false
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.cardId!
        const width = (entry.target as HTMLElement).offsetWidth, height = (entry.target as HTMLElement).offsetHeight
        if (id && (next[id]?.width !== width || next[id]?.height !== height)) { next[id] = { width, height }; changed = true }
      }
      return changed ? next : previous
    }))
    root.querySelectorAll('[data-card-id]').forEach(card => observer.observe(card))
    return () => observer.disconnect()
  }, [cards.map(card => card.id).join('|'), groups.map(group => `${group.id}:${group.collapsed}`).join('|')])
  const edit = (next: CanvasDocument) => { if (!readonly) onChange(next) }
  const updateCard = (next: GenerationCard) => edit({ ...latest.current, cards: latest.current.cards?.map(card => card.id === next.id ? next : card) })
  const showProtection = (protection: NonNullable<ReturnType<typeof referenceProtection>>) => {
    setReason(protection.message)
    const card = window.document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(protection.cardId)}"]`)
    const segment = card?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(protection.segmentId)}"]`)
    if (segment) { segment.tabIndex = -1; segment.focus(); segment.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
  }
  const removeCard = (id: string) => {
    const protection = referenceProtection(latest.current, id)
    if (protection) { showProtection(protection); return }
    let next = latest.current
    for (const edge of next.edges || []) if (edge.source_card === id || edge.target_card === id) next = disconnect(next, edge.id)
    const order = { ...next.input_order }; delete order[id]
    edit({ ...next, cards: next.cards?.filter(card => card.id !== id), input_order: order,
      groups: next.groups?.map(group => ({ ...group, card_ids: group.card_ids?.filter(card => card !== id) })) })
  }
  const add = (type: string) => {
    const card = type === 'content.text' ? { id: crypto.randomUUID(), type, type_version: 1, text: '' }
      : type.startsWith('model.') ? { id: crypto.randomUUID(), type, type_version: 1, model_id: null, prompt: { segments: [] }, config: {} }
      : { id: crypto.randomUUID(), type, type_version: 1, file_id: null, uploading: false }
    edit({ ...latest.current, cards: [...(latest.current.cards || []), card] })
  }
  const capability = (card: GenerationCard) => 'model_id' in card && card.model_id ? capabilities[card.model_id] : undefined
  const check = (edge: GenerationEdge) => {
    const target = cards.find(card => card.id === edge.target_card)
    if (target && 'model_id' in target && target.model_id && !capability(target)) return '模型能力尚未核实，暂不能新建连接'
    return connectionReason(latest.current, edge, target ? capability(target) : undefined)
  }
  const finishDrag = (event: PointerEvent) => {
    if (!drag) return
    const target = window.document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-input-port]')
    if (target) {
      const edge = { id: crypto.randomUUID(), source_card: drag.card, source_port: drag.port, target_card: target.dataset.card!, target_port: target.dataset.inputPort! }
      const issue = check(edge)
      if (issue) setReason(issue)
      else { edit(connect(latest.current, edge)); setReason('已连接候选输入；正文或用途配置决定实际使用') }
    } else setReason('请拖到接收卡的输入端口')
    setDrag(undefined)
  }
  const port = (card: GenerationCard, name: string, input: boolean) => {
    const issue = input && drag ? check({ id: 'preview', source_card: drag.card, source_port: drag.port, target_card: card.id, target_port: name }) : undefined
    return <button key={name} type="button" disabled={readonly} data-card={card.id} data-input-port={input ? name : undefined} data-output-port={!input ? name : undefined}
      data-compatible={input && drag ? !issue : undefined} title={issue || `${input ? '输入' : '输出'}：${portLabels[name]}`} aria-label={`${input ? '输入' : '输出'}端口 ${name}`}
      onPointerDown={!input ? event => {
        if (readonly || event.button !== 0) return
        event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
        setDrag({ card: card.id, port: name, x: event.clientX, y: event.clientY }); setReason('拖到兼容输入端口；绿色端口可连接')
      } : undefined}
      onPointerMove={!input ? event => { if (drag) setDrag({ ...drag, x: event.clientX, y: event.clientY }) } : undefined}
      onPointerUp={!input ? finishDrag : undefined} onPointerCancel={() => setDrag(undefined)}>
      {input ? '○' : '●'} {portLabels[name]}
    </button>
  }
  const references = (card: GenerationCard) => <>
    <Space wrap><Button disabled={readonly} size="small" onClick={() => {
      const source = { id: crypto.randomUUID(), type: 'content.text' as const, type_version: 1 as const, text: '' }
      const next = { ...latest.current, cards: [...(latest.current.cards || []), source] }
      edit(connect(next, { id: crypto.randomUUID(), source_card: source.id, source_port: 'text', target_card: card.id, target_port: 'text' }))
    }}>添加文本参考</Button>
    <Select<string> aria-label="添加媒体参考" placeholder="添加媒体参考" value={undefined} disabled={readonly} style={{ width: 150 }}
      options={inputPorts(card).filter(port => port !== 'text').map(port => ({ value: port, label: `新建${portLabels[port]}内容卡` }))}
      onChange={targetPort => {
        if (!targetPort) return
        const sourcePort = ['first_frame', 'last_frame', 'key_frame', 'subject_image'].includes(targetPort) ? 'image' : targetPort === 'subject_video' ? 'video' : targetPort
        const source = { id: crypto.randomUUID(), type: `content.${sourcePort}`, type_version: 1, file_id: null, uploading: false }
        edit(connect({ ...latest.current, cards: [...(latest.current.cards || []), source] }, { id: crypto.randomUUID(), source_card: source.id, source_port: sourcePort, target_card: card.id, target_port: targetPort }))
      }} />
    <Select<string> aria-label="连接已有卡" placeholder="选择已有卡" value={undefined} disabled={readonly} style={{ width: 160 }}
      options={cards.flatMap(source => outputPorts(source).flatMap(sourcePort => inputPorts(card).filter(targetPort => !connectionReason(document, { id: 'candidate', source_card: source.id, source_port: sourcePort, target_card: card.id, target_port: targetPort }, capability(card))).map(targetPort => ({ value: `${source.id}|${sourcePort}|${targetPort}`, label: `${source.id.slice(0, 8)} → ${portLabels[targetPort]}` }))))}
      onChange={value => { if (!value) return; const [source_card, source_port, target_port] = value.split('|'); edit(connect(latest.current, { id: crypto.randomUUID(), source_card, source_port, target_card: card.id, target_port })) }} />
    </Space>
    {inputPorts(card).map(name => {
    const order = document.input_order?.[card.id]?.[name] || []
    if (!order.length) return null
    return <div key={name}><strong>{portLabels[name]}</strong><ol>{order.map((id, index) => {
      const edge = edges.find(item => item.id === id)
      if (!edge) return null
      const unsupported = capability(card) && !capability(card)?.input_ports.includes(name)
      return <li key={id} data-edge-id={id}>
        {edge.source_card.slice(0, 8)} {unsupported && <span>当前模型不支持，候选保留</span>}
        <Button size="small" disabled={readonly || index === 0} aria-label={`前移输入 ${id}`} onClick={() => {
          const next = [...order]; [next[index - 1], next[index]] = [next[index], next[index - 1]]
          edit({ ...document, input_order: { ...document.input_order, [card.id]: { ...document.input_order?.[card.id], [name]: next } } })
        }}>↑</Button><Button size="small" disabled={readonly} aria-label={`断开连接 ${id}`} onClick={() => {
          const protection = referenceProtection(latest.current, edge.source_card, edge.target_card, edge.source_port)
          if (protection) { showProtection(protection); return }
          edit(disconnect(latest.current, id))
        }}>断开</Button>
      </li>
    })}</ol></div>
  })}</>
  const point = (id: string) => layout.view.positions[id] || { x: 0, y: 0 }
  return <div className="generation-graph" ref={container}>
    <Space wrap className="generation-toolbar">
      {Object.entries(cardTitles).map(([type, title]) => <Button key={type} disabled={readonly} onClick={() => add(type)}>添加{title.replace('内容', '')}</Button>)}
      <Button disabled={readonly || !selected.length} onClick={() => {
        const members = selected.filter(id => !groups.some(group => group.card_ids?.includes(id)))
        if (!members.length) { setReason('所选卡片已经属于分组'); return }
        edit({ ...document, groups: [...groups, { id: crypto.randomUUID(), name: '新分组', card_ids: members, collapsed: false }] }); setSelected([])
      }}>将所选卡片分组</Button>
      <Button aria-label="放大" onClick={() => viewport.zoom(.1)}>放大</Button><Button aria-label="缩小" onClick={() => viewport.zoom(-.1)}>缩小</Button>
    </Space>
    {storageError && <Alert type="warning" message={`布局本地保存失败：${storageError}`} />}
    <div role="status" className="generation-connection-reason">{reason || '拖动输出端口到接收端口建立候选连接'}</div>
    <div ref={viewport.surface} {...viewport.surfaceProps} className="generation-surface" aria-label="生成画布视口">
      <div className="generation-world" style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
        <svg className="generation-edges" width={12000} height={12000}>
          {edges.filter(edge => !hidden.has(edge.source_card) && !hidden.has(edge.target_card)).map(edge => {
            const from = point(edge.source_card), to = point(edge.target_card), width = layout.view.sizes[edge.source_card]?.width || 400
            return <CanvasEdge key={edge.id} d={`M ${from.x + width} ${from.y + 80} C ${from.x + width + 80} ${from.y + 80}, ${to.x - 80} ${to.y + 80}, ${to.x} ${to.y + 80}`}
              label={`${edge.source_card} → ${edge.target_card} ${portLabels[edge.target_port]}`} />
          })}
        </svg>
        {groups.map(group => {
          const members = (group.card_ids || []).filter(id => cards.some(card => card.id === id))
          const positions = members.map(point)
          const origin = { x: positions.length ? Math.min(...positions.map(pos => pos.x)) - 16 : 0,
            y: positions.length ? Math.min(...positions.map(pos => pos.y)) - 96 : 0 }
          const width = group.collapsed ? 300 : Math.max(400, ...members.map(id => point(id).x + (layout.view.sizes[id]?.width || 400) - origin.x + 16))
          const height = group.collapsed ? 110 : Math.max(140, ...members.map(id => point(id).y + (layout.view.sizes[id]?.height || 350) - origin.y + 16))
          return <section key={group.id} data-group-id={group.id} className="generation-group" style={{ left: origin.x, top: origin.y, width, height }}>
            <div className="generation-group-header"><CanvasDragHandle contextKey={document.id} label={`分组 ${group.name}`} offset={origin} scale={transform.scale} onMove={next => {
              const delta = { x: next.x - origin.x, y: next.y - origin.y }
              layout.setView(previous => ({ ...previous, positions: { ...previous.positions, ...Object.fromEntries(members.map(id => [id,
                { x: (previous.positions[id]?.x || 0) + delta.x, y: (previous.positions[id]?.y || 0) + delta.y }])) } }))
            }} /><Input aria-label="分组名称" value={group.name} disabled={readonly} onChange={event => edit({ ...document, groups: groups.map(item => item.id === group.id ? { ...item, name: event.target.value } : item) })} />
              <Button size="small" disabled={readonly} onClick={() => edit({ ...document, groups: groups.map(item => item.id === group.id ? { ...item, collapsed: !item.collapsed } : item) })}>{group.collapsed ? '展开组' : '折叠组'}</Button>
              <Button size="small" disabled={readonly} onClick={() => edit({ ...document, groups: groups.filter(item => item.id !== group.id) })}>解散组</Button>
              <Select aria-label={`分组成员 ${group.name}`} mode="multiple" value={members} disabled={readonly} style={{ width: 180 }}
                options={cards.filter(card => members.includes(card.id) || !groups.some(item => item.card_ids?.includes(card.id))).map(card => ({ value: card.id, label: `${cardTitles[card.type || '']} ${card.id.slice(0, 4)}` }))}
                onChange={ids => edit({ ...document, groups: groups.map(item => item.id === group.id ? { ...item, card_ids: ids } : item) })} />
            </div>
            {group.collapsed && <span>{members.length} 张独立卡片 · 无集合输出</span>}
          </section>
        })}
        {cards.filter(card => !hidden.has(card.id)).map(card => {
          const Renderer = rendererRegistry[card.type || 'content.text']
          const size = layout.view.sizes[card.id]
          return <CardShell key={`${document.id}:${card.id}`} id={card.id} title={cardTitles[card.type || 'content.text']} contextKey={document.id} point={point(card.id)}
            scale={transform.scale} width={size?.width || 400} height={size?.height} selected={selected.includes(card.id)} readonly={readonly}
            onSelect={checked => setSelected(previous => checked ? [...previous, card.id] : previous.filter(id => id !== card.id))}
            onMove={position => layout.move(card.id, position)} onResize={(width, height) => {
              if (Math.abs(width - (size?.width || 400)) > 2 || Math.abs(height - (size?.height || measured[card.id]?.height || height)) > 2)
                layout.setView(previous => ({ ...previous, sizes: { ...previous.sizes, [card.id]: { width, height } } }))
            }} onRemove={() => removeCard(card.id)} inputs={inputPorts(card).map(name => port(card, name, true))} outputs={outputPorts(card).map(name => port(card, name, false))}>
            {Renderer ? <Renderer card={card} document={document} projectId={document.project_id} onChange={updateCard} models={models} capability={capability(card)}
              capabilityError={'model_id' in card && card.model_id ? capabilityErrors[card.model_id] : undefined} references={references(card)} disabled={readonly} /> : <Alert type="error" message="卡片编辑器尚未接入" />}
          </CardShell>
        })}
      </div>
      {drag && <div className="generation-drag-hint" style={{ left: drag.x - (viewport.surface.current?.getBoundingClientRect().left || 0) + 12, top: drag.y - (viewport.surface.current?.getBoundingClientRect().top || 0) }}>正在连接{portLabels[drag.port]}</div>}
    </div>
  </div>
}
