import type { CanvasPoint, CanvasTransform } from '../../../components/canvas/geometry'

export type DirectorSize = { width: number; height: number }
export type DirectorBox = CanvasPoint & DirectorSize
export type DirectorLayoutNode = { id: string; group?: string }
export type DirectorView = { transform: CanvasTransform; positions: Record<string, CanvasPoint>; sizes: Record<string, DirectorSize> }
export const directorGroups: Record<string, string> = { camera: '摄影', performance: '表演', situation: '角色情境', blocking: '调度', activity: '镜内活动', continuity: '连续性', dialogue: '声音与对白', criterion: '验收要求', shot: '其他镜头', shared: '全场共享工作单', evidence: '关联依据', other: '其他设计' }
export const directorGroup = (id: string) => {
  const kind = id.split(':')[0]
  return /^(participant|beat|event|anchor|location)$/.test(kind) ? 'evidence' : directorGroups[kind] ? kind : !id.includes(':') ? 'shared' : 'other'
}
const width = 360, gap = 64, sectionGap = 96
export const fixedDirectorSize = (id: string): DirectorSize | undefined => /^(shot|camera|performance|blocking|situation|activity|continuity):/.test(id) ? { width, height: 276 }
  : id === '全场共享' ? { width, height: 340 }
    : /^(performance|staging|sound|prompt)$/.test(id) ? { width, height: 276 }
      : /^(criterion|dialogue):/.test(id) ? { width, height: 184 } : evidenceDirectorSize(id)
const evidenceDirectorSize = (id: string): DirectorSize | undefined => /^(participant|beat):/.test(id) ? { width, height: 216 }
  : id === '原文依据' ? { width, height: 240 }
    : /^(event|anchor|missing):/.test(id) || id.startsWith('location:') ? { width, height: 184 } : undefined
export const intersects = (a: DirectorBox, b: DirectorBox, margin = 0) => a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y

/** 只排浏览坐标：分区按真实类型，组内逐行排列；已有坐标保留，新增对象寻找空位。 */
export function arrangeDirector(nodes: DirectorLayoutNode[], sizes: Record<string, DirectorSize>, viewportWidth: number, anchor: string, retained: Record<string, CanvasPoint> = {}) {
  const columns = Math.max(1, Math.min(3, Math.floor((viewportWidth - 32 + gap) / (width + gap))))
  const available = columns * (width + gap) - gap
  const height = (id: string) => sizes[id]?.height || 300
  const positions: Record<string, CanvasPoint> = {}
  const source = nodes.find(node => node.id === '原文依据'), shared = nodes.find(node => node.id === '全场共享')
  if (source) positions[source.id] = { x: 0, y: 0 }
  if (shared) positions[shared.id] = { x: columns > 1 ? width + gap : 0, y: columns > 1 || !source ? 0 : height(source.id) + gap }
  const top = Math.max(0, ...Object.entries(positions).map(([id, point]) => point.y + height(id))) + sectionGap
  const hasAnchor = nodes.some(node => node.id === anchor)
  if (hasAnchor && anchor !== '全场共享') positions[anchor] = { x: 0, y: top }
  let x = hasAnchor && anchor !== '全场共享' ? width + gap : 0, y = top
  let rowBottom = hasAnchor && anchor !== '全场共享' ? top + height(anchor) : top
  const groups = Object.keys(directorGroups).map(group => ({ group, nodes: nodes.filter(node => !positions[node.id] && (node.group || directorGroup(node.id)) === group) })).filter(group => group.nodes.length)
  for (const group of groups) {
    const count = Math.min(columns, group.nodes.length), groupWidth = count * (width + gap) - gap
    if (x && x + groupWidth > available) { x = 0; y = rowBottom + sectionGap }
    let groupY = y, rowHeight = 0
    group.nodes.forEach((node, index) => {
      if (index && index % count === 0) { groupY += rowHeight + gap; rowHeight = 0 }
      positions[node.id] = { x: x + index % count * (width + gap), y: groupY }
      rowHeight = Math.max(rowHeight, height(node.id))
    })
    rowBottom = Math.max(rowBottom, groupY + rowHeight)
    x += groupWidth + gap
  }
  if (!Object.keys(retained).length) return positions
  const occupied = Object.entries(retained).filter(([id]) => sizes[id]).map(([id, point]) => ({ ...point, width, height: height(id) }))
  const result = { ...retained }
  for (const node of nodes) {
    if (result[node.id]) continue
    const group = node.group || directorGroup(node.id)
    const peers = nodes.filter(other => (other.group || directorGroup(other.id)) === group && retained[other.id])
    const start = peers.length ? { x: Math.min(...peers.map(peer => retained[peer.id].x)), y: Math.min(...peers.map(peer => retained[peer.id].y)) } : positions[node.id]
    let point = start, row = 0
    while (occupied.some(box => intersects({ ...point, width, height: height(node.id) }, box, 32))) {
      row++
      point = { x: start.x + row % columns * (width + gap), y: start.y + Math.floor(row / columns) * (Math.max(height(node.id), ...peers.map(peer => height(peer.id))) + gap) }
    }
    result[node.id] = point
    occupied.push({ ...point, width, height: height(node.id) })
  }
  return result
}

/** 浏览器偏好不可信；损坏数据回退到新布局，不影响设计内容或保存。 */
export function readDirectorView(raw: string | null): DirectorView | undefined {
  try {
    const value = JSON.parse(raw || 'null')
    if (!value || value.schema !== 1 || !value.transform || ![value.transform.x, value.transform.y, value.transform.scale].every(Number.isFinite) || value.transform.scale < .15 || value.transform.scale > 2) return
    if (!value.positions || typeof value.positions !== 'object' || Array.isArray(value.positions) || !value.sizes || typeof value.sizes !== 'object' || Array.isArray(value.sizes)) return
    if (!Object.values(value.positions).every((point: any) => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return
    if (!Object.values(value.sizes).every((size: any) => size && size.width === width && Number.isFinite(size.height) && size.height >= 32 && size.height <= 2000)) return
    return { transform: value.transform, positions: value.positions, sizes: value.sizes }
  } catch { return }
}

export function pruneDirectorView(view: DirectorView, valid: Set<string>): DirectorView {
  return { ...view, positions: Object.fromEntries(Object.entries(view.positions).filter(([id]) => valid.has(id))), sizes: Object.fromEntries(Object.entries(view.sizes).filter(([id]) => valid.has(id))) }
}
