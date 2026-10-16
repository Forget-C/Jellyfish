import type { CanvasPoint, CanvasTransform } from '../../../components/canvas/geometry'
import type { DesignObject } from './designWorkspace'

export type DirectorSize = { width: number; height: number }
export type DirectorBox = CanvasPoint & DirectorSize
export type DirectorLayoutNode = { id: string; group?: string; size?: DirectorSize }
export type DirectorView = { transform: CanvasTransform; positions: Record<string, CanvasPoint>; sizes: Record<string, DirectorSize> }
export const directorGroups: Record<string, string> = { domains: '设计职责', participants: '场景要素与资产', event: '触发事件', camera: '摄影', performance: '表演', situation: '角色情境', blocking: '调度', activity: '镜内活动', continuity: '连续性', continuity_space: '连续性 · 空间', continuity_appearance: '连续性 · 造型', continuity_hands_props: '连续性 · 手部与道具', continuity_environment: '连续性 · 环境', continuity_camera: '连续性 · 摄影', continuity_dialogue_sound: '连续性 · 对白与声音', dialogue: '声音与对白', criterion: '验收要求', shot: '计划镜头', shared: '全场规则', evidence: '关联依据', references: '跨域引用', other: '其他设计', 'scene-global': '全场内容', 'scene-shared': '跨镜共享', 'scene-shots': '镜头设计', 'scene-unlinked': '未关联设计', 'shot-evidence': '节拍、调度与空间', 'shot-left': '场景要素与依据', 'shot-work': '岗位设计', 'shot-shared': '共享引用' }
export const directorGroup = (id: string) => {
  const kind = id.split(':')[0]
  return kind === 'domain' ? 'domains' : /^(participant|location)$/.test(kind) ? 'participants' : /^(beat|anchor)$/.test(kind) ? 'evidence' : directorGroups[kind] ? kind : !id.includes(':') ? 'shared' : 'other'
}
export const shotDesignGroup = (key: string, kind: string, shotId: string) => kind === 'reference' ? 'shot-shared'
  : key === `shot:${shotId}` ? 'shot-center'
    : /^(beat|blocking|anchor):/.test(key) ? 'shot-evidence'
      : /^(participant|event|criterion):/.test(key) ? 'shot-left' : 'shot-work'
const width = 360, gap = 64, sectionGap = 96
export const fixedDirectorSize = (id: string): DirectorSize | undefined => /^(shot|camera|performance|blocking|situation|activity|continuity):/.test(id) ? { width, height: 276 }
  : id === '全场共享' ? { width, height: 340 }
    : /^(performance|staging|sound|prompt)$/.test(id) ? { width, height: 276 }
      : /^(criterion|dialogue):/.test(id) ? { width, height: 184 } : evidenceDirectorSize(id)
export function directorDesignNodeSize(node: DesignObject): DirectorSize {
  if (node.kind === 'summary') return { width: 360, height: 276 }
  if (node.kind === 'reference') return { width: 360, height: 152 }
  if (!node.key.includes(':') || node.key.startsWith('participant:')) return { width: 360, height: 276 }
  if (/^(dialogue|criterion):/.test(node.key)) return { width: 360, height: 232 }
  return fixedDirectorSize(node.key) || { width: 360, height: 216 }
}
const evidenceDirectorSize = (id: string): DirectorSize | undefined => /^(participant|beat):/.test(id) ? { width, height: 216 }
  : id === '原文依据' ? { width, height: 240 }
    : /^(event|anchor|missing):/.test(id) || id.startsWith('location:') ? { width, height: 184 } : undefined
export const intersects = (a: DirectorBox, b: DirectorBox, margin = 0) => a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y

/** 只排浏览坐标：分区按真实类型，组内逐行排列；已有坐标保留，新增对象寻找空位。 */
export function arrangeDirector(nodes: DirectorLayoutNode[], sizes: Record<string, DirectorSize>, viewportWidth: number, anchor: string, retained: Record<string, CanvasPoint> = {}, previousSizes: Record<string, DirectorSize> = {}) {
  // 入口尺寸升级只迁移新产生碰撞的卡；既有手动坐标与原本重叠的布局保持不变。
  const migrated = { ...retained }
  for (const node of nodes) {
    const point = retained[node.id], before = previousSizes[node.id], after = sizes[node.id]
    if (!point || !before || !after || after.height <= before.height) continue
    if (nodes.some(other => {
      const otherPoint = retained[other.id], otherSize = sizes[other.id]
      return other.id !== node.id && otherPoint && otherSize
        && intersects({ ...point, ...after }, { ...otherPoint, ...otherSize })
        && !intersects({ ...point, ...before }, { ...otherPoint, ...(previousSizes[other.id] || otherSize) })
    })) delete migrated[node.id]
  }
  retained = migrated
  const columns = Math.max(1, Math.min(3, Math.floor((viewportWidth - 32 + gap) / (width + gap))))
  const available = columns * (width + gap) - gap
  const height = (id: string) => sizes[id]?.height || 300
  const positions: Record<string, CanvasPoint> = {}
  const sceneGroups = nodes.some(node => node.group?.startsWith('scene-') || node.group?.startsWith('shot-'))
  if (sceneGroups) {
    const center = nodes.find(node => node.id === anchor)
    if (center) positions[center.id] = { x: 0, y: 0 }
    const place = (group: string, startX: number, startY: number) => {
      const members = nodes.filter(node => node.id !== anchor && node.group === group)
      const count = Math.min(columns, members.length)
      let y = startY
      for (let index = 0; index < members.length; index += count) {
        const row = members.slice(index, index + count)
        row.forEach((node, column) => { positions[node.id] = { x: startX + column * (width + gap), y } })
        y += Math.max(...row.map(node => height(node.id))) + gap
      }
    }
    const bottom = () => Math.max(0, ...Object.entries(positions).map(([id, point]) => point.y + height(id)))
    if (columns === 1) {
      let nextY = center ? height(center.id) + sectionGap : 0
      const order = anchor === '原文依据'
        ? ['scene-global', 'scene-shared', 'scene-shots', 'scene-unlinked']
        : ['shot-evidence', 'shot-left', 'shot-work', 'shot-shared']
      order.forEach(group => {
        const members = nodes.filter(node => node.group === group)
        members.forEach(node => {
          positions[node.id] = { x: 0, y: nextY }
          nextY += height(node.id) + gap
        })
        if (members.length) nextY += sectionGap - gap
      })
    } else if (anchor === '原文依据') {
      const topRows = Math.ceil(nodes.filter(node => node.group === 'scene-global').length / columns)
      place('scene-global', 0, -topRows * 340 - sectionGap)
      place('scene-shared', -(Math.min(columns, nodes.filter(node => node.group === 'scene-shared').length) * (width + gap)), 0)
      place('scene-shots', width + gap, 0)
      place('scene-unlinked', 0, bottom() + sectionGap)
    } else {
      place('shot-evidence', 0, -Math.ceil(nodes.filter(node => node.group === 'shot-evidence').length / columns) * 340 - sectionGap)
      place('shot-left', -(Math.min(columns, nodes.filter(node => node.group === 'shot-left').length) * (width + gap)), 0)
      place('shot-work', width + gap, 0)
      place('shot-shared', 0, bottom() + sectionGap)
    }
  } else {
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

export function pruneDirectorView(view: DirectorView, valid: Set<string>, aliases: Record<string, string> = {}): DirectorView {
  const retain = <T,>(items: Record<string, T>) => Object.fromEntries(Object.entries(items)
    .map(([id, value]) => [aliases[id] || id, value] as const).filter(([id]) => valid.has(id)))
  return { ...view, positions: retain(view.positions), sizes: retain(view.sizes) }
}
