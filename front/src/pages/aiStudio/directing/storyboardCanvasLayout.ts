import type { CanvasPoint } from '../../../components/canvas/geometry'
import type { CanvasDocument, GenerationCanvasGroup } from '../../../services/generated'
import { generationGroupBounds, type GenerationCanvasLayoutPolicy } from '../generationCanvas/generationLayout'
import type { GraphArrange, GraphSize } from './graphLayout'

const gap = 64
const narrowWidth = 700
type Frame = CanvasPoint & GraphSize

function availableY(frame: Frame, occupied: Frame[], clearance = gap) {
  let y = frame.y
  for (const other of [...occupied].sort((a, b) => a.y - b.y)) {
    if (frame.x < other.x + other.width + clearance && frame.x + frame.width + clearance > other.x &&
        y < other.y + other.height + clearance && y + frame.height + clearance > other.y) y = other.y + other.height + gap
  }
  return y
}

const rowWidth = (row: string[], sizes: Record<string, GraphSize>) =>
  row.reduce((width, id) => width + sizes[id].width + gap, 0) - gap

function videoRows(shots: string[][], sizes: Record<string, GraphSize>, width: number) {
  const limit = width <= narrowWidth ? 0 : width - 160
  const rows: string[][] = []
  let row: string[] = []
  const nextRow = () => { if (row.length) rows.push(row); row = [] }
  for (const videos of shots) {
    // 放得下的同镜头片段一起换行，较长镜头仍按顺序分行。
    if (row.length && rowWidth(videos, sizes) <= limit && rowWidth([...row, ...videos], sizes) > limit) nextRow()
    for (const id of videos) {
      if (row.length && rowWidth([...row, id], sizes) > limit) nextRow()
      row.push(id)
    }
  }
  nextRow()
  return rows
}

/** 重提取只为新增卡安排位置，原坐标也是解除堆叠和撤销时的定位依据。 */
function placeStoryboardAdditions(document: CanvasDocument, before: CanvasDocument): NonNullable<GenerationCanvasLayoutPolicy['placeAdditions']> {
  const previousIds = new Set(before.cards?.map(card => card.id))
  const storyboard = document.storyboard!
  const modelIds = new Set(document.cards?.filter(card => card.type === 'model.video').map(card => card.id))
  const videos = storyboard.shots.flatMap(shot => shot.model_card_ids).filter(id => modelIds.has(id))
  return (positions, retained, sizes, width) => {
    const added = new Set(Object.keys(storyboard.origins).filter(id => sizes[id] && !retained[id] && !previousIds.has(id)))
    if (!added.size) return positions
    const next = { ...positions }
    const occupied = Object.entries(retained).flatMap(([id, point]) => sizes[id] ? [{ ...point, ...sizes[id] }] : [])
    const groups = document.groups || []
    for (const group of groups) {
      const members = (group.card_ids || []).filter(id => sizes[id] && retained[id])
      if (members.length) occupied.push(generationGroupBounds(group, members, id => retained[id], sizes))
    }
    const placeRow = (ids: string[], left: number, top: number, cover?: GraphSize) => {
      const height = Math.max(cover?.height || 0, ...ids.map(id => sizes[id].height))
      const firstWidth = Math.max(cover?.width || 0, sizes[ids[0]].width)
      const right = left + rowWidth(ids, sizes) + firstWidth - sizes[ids[0]].width
      const y = availableY({ x: left, y: top, width: right - left, height }, occupied)
      let x = left
      ids.forEach((id, index) => {
        next[id] = { x, y }
        x += (index === 0 ? firstWidth : sizes[id].width) + gap
        added.delete(id)
      })
      occupied.push({ x: left, y, width: right - left, height })
      return y + height + gap
    }

    const knownVideos = videos.filter(id => retained[id])
    const left = knownVideos.length ? retained[knownVideos[0]].x : 0
    let top = knownVideos.length ? Math.max(...knownVideos.map(id => retained[id].y + sizes[id].height)) + gap : 0
    const appended = storyboard.shots.map(shot => shot.model_card_ids.filter(id => modelIds.has(id) && added.has(id))).filter(ids => ids.length)
    for (const row of videoRows(appended, sizes, width)) top = placeRow(row, left, top)
    const beside = (id?: string) => id && next[id] && { x: next[id].x + sizes[id].width + gap, y: next[id].y }
    for (const group of groups) {
      const ids = group.card_ids || []
      if (group.kind !== 'stack' || !ids.length || !ids.every(id => added.has(id))) continue
      const owner = storyboard.shots.find(shot => ids.includes(shot.card_id))
      const anchor = beside(owner?.model_card_ids[0])
      const cover = generationGroupBounds(group, ids, () => ({ x: 0, y: 0 }), sizes)
      placeRow(ids, anchor ? anchor.x : left - cover.width - gap, anchor ? anchor.y : 0, cover)
    }
    for (const id of added) {
      const origin = storyboard.origins[id]
      const shotIds = origin.applicability?.shot_ids
      const owner = storyboard.shots.find(shot => {
        if (shotIds?.length) return shotIds.length === 1 && shotIds[0] === shot.shot_id
        const key = storyboard.origins[shot.card_id]?.semantic_key
        return key && origin.semantic_key.startsWith(key + ':')
      })
      const anchor = beside(owner?.model_card_ids[0])
      placeRow([id], anchor ? anchor.x : left - sizes[id].width - gap, anchor ? anchor.y : 0)
    }
    return next
  }
}

function placeVideoRows(shots: string[][], sizes: Record<string, GraphSize>, width: number) {
  const positions: Record<string, CanvasPoint> = {}
  const rows = videoRows(shots, sizes, width)
  let top = 0
  for (const row of rows) {
    let left = 0
    for (const id of row) {
      positions[id] = { x: left, y: top }
      left += sizes[id].width + gap
    }
    top += Math.max(...row.map(id => sizes[id].height)) + gap
  }
  return { positions, mainWidth: Math.max(...rows.map(row => rowWidth(row, sizes))) }
}

const designStackId = (shotId?: string) => `storyboard-stack-${shotId || 'shared'}`
const belongsToDesignStack = (id: string, base: string) => id === base ||
  id.startsWith(base + '-') && /^[0-9a-f]{8}$/.test(id.slice(base.length + 1))

/** 仅用分镜来源归组设计，人工堆叠仍由原成员和身份表达。 */
function organizeStoryboardDesigns(document: CanvasDocument) {
  const { storyboard } = document
  if (!storyboard) return
  const groups = document.groups || []
  const stacked = new Set(groups.filter(group => group.kind === 'stack').flatMap(group => group.card_ids || []))
  const shots = storyboard.shots.map(shot => ({ ...shot, key: storyboard.origins[shot.card_id]?.semantic_key }))
  const originalShotGroup = new Map(groups.filter(group => group.kind !== 'stack')
    .flatMap(group => (group.card_ids || []).map(id => [id, group.id] as const)))
  const designBuckets = new Map<string, { id: string; name: string; cardIds: string[] }>()
  const moved = new Set<string>()
  for (const card of document.cards || []) {
    const source = storyboard.origins[card.id]
    if (!card.type?.startsWith('direction.') || !source || stacked.has(card.id)) continue
    const shot = shots.find(item => item.card_id === card.id ||
      item.segments?.some(segment => segment.basis_card_id === card.id) ||
      item.key && source.semantic_key.startsWith(item.key + ':'))
    const sceneDesign = source.semantic_key.startsWith('scene:design:')
    if (!shot && !sceneDesign) continue
    const declared = source.applicability?.shot_ids || []
    const candidates = declared.length ? shots.filter(item => declared.includes(item.shot_id)) : shots
    const occurrences = source.applicability?.occurrence_ids || []
    const matching = occurrences.length
      ? candidates.filter(item => item.segments?.some(segment => segment.occurrence_id && occurrences.includes(segment.occurrence_id)))
      : candidates
    const owner = shot ?? (matching.length === 1 ? matching[0] : !matching.length && occurrences.length
      ? candidates.find(item => item.group_id === originalShotGroup.get(card.id)) : undefined)
    const id = designStackId(owner?.shot_id)
    let bucket = designBuckets.get(id)
    if (!bucket) {
      const title = owner && (groups.find(group => group.id === owner.group_id)?.name ||
        `镜头 ${String(shots.indexOf(owner) + 1).padStart(2, '0')}`)
      const name = title ? `${Array.from(title).slice(0, 250).join('')} · 设计` : '共享设计'
      bucket = { id, name, cardIds: [] }
      designBuckets.set(id, bucket)
    }
    bucket.cardIds.push(card.id)
    moved.add(card.id)
  }
  if (!moved.size) return
  const replaced = new Set<string>()
  const stacks = Array.from(designBuckets.values(), (bucket): GenerationCanvasGroup => {
    const existing = groups.find(group => group.kind === 'stack' && belongsToDesignStack(group.id, bucket.id))
    if (existing) replaced.add(existing.id)
    // 更换收纳后的身份，沿用共同保存的显式解除及新建堆叠规则。
    return { id: `${bucket.id}-${crypto.randomUUID().slice(0, 8)}`, kind: 'stack',
      name: existing?.name ?? bucket.name, card_ids: [...(existing?.card_ids || []), ...bucket.cardIds] }
  })
  const kept = groups.flatMap(group => {
    if (replaced.has(group.id)) return []
    if (!group.card_ids?.some(id => moved.has(id))) return [group]
    const card_ids = group.card_ids.filter(id => !moved.has(id))
    return card_ids.length ? [{ ...group, card_ids }] : []
  })
  return { groups: [...kept, ...stacks], newStacks: new Set(stacks.map(stack => stack.id)) }
}

/** 工作台按镜头关系组织视频，普通入口不使用该策略。 */
export function storyboardCanvasLayout(document: CanvasDocument, beforeApplication?: CanvasDocument): GenerationCanvasLayoutPolicy | undefined {
  const { storyboard } = document
  if (!storyboard) return
  const hidden = new Set(document.groups?.filter(group => group.kind === 'stack' || group.collapsed).flatMap(group => group.card_ids || []))
  const videos = new Set(document.cards?.filter(card => card.type === 'model.video' && !hidden.has(card.id)).map(card => card.id))
  const shots = storyboard.shots.map(shot => shot.model_card_ids.filter(id => videos.has(id))).filter(row => row.length)
  const anchorId = shots[0]?.[0]
  if (!anchorId) return
  const focus = (sizes: Record<string, GraphSize>, width: number, height: number) => {
    const card = sizes[anchorId]
    if (width > narrowWidth) {
      const first = videoRows(shots, sizes, width)[0]
      return { left: Math.max(80, (width - rowWidth(first, sizes)) / 2), top: 180, scale: 1 }
    }
    // 窄屏为左侧添加栏、顶部工具栏和底部视图工具保留操作空间。
    const scale = Math.max(.15, Math.min(1, (width - 96) / card.width, (height - 300) / card.height))
    return { left: 80, top: Math.max(150, (height - card.height * scale) / 2), scale }
  }
  const firstApplication = beforeApplication && !beforeApplication.storyboard &&
    !beforeApplication.cards?.some(card => card.id !== beforeApplication.fixed_source?.card_id)
  const placeAdditions = beforeApplication?.storyboard
    ? placeStoryboardAdditions(document, beforeApplication)
    : (positions: Record<string, CanvasPoint>) => positions
  const arrangeExplicit = (groups: GenerationCanvasGroup[], newStacks?: Set<string>): GraphArrange =>
    (nodes, sizes, width, _anchor, previous = {}) => {
      const { positions: preferred, mainWidth } = placeVideoRows(shots, sizes, width)
      const positions: Record<string, CanvasPoint> = {}
      const live = new Set(nodes.map(node => node.id))
      const groupFor = new Map(groups.flatMap(group => (group.card_ids || []).map(id => [id, group] as const)))
      const shotGroups = new Set(document.storyboard?.shots.map(shot => shot.group_id))
      const shotCards = new Set(document.storyboard?.shots.map(shot => shot.card_id))
      const stackedPoints: Record<string, CanvasPoint> = {}
      for (const group of groups) {
        if (!newStacks?.has(group.id)) continue
        let x = 0
        for (const id of group.card_ids || []) {
          if (!sizes[id]) continue
          stackedPoints[id] = { x, y: 0 }
          x += (x === 0 ? Math.max(sizes[id].width, 400) : sizes[id].width) + gap
        }
      }
      const point = (id: string) => stackedPoints[id] ?? previous[id] ?? preferred[id] ?? { x: 0, y: 0 }
      const liveMembers = (group: GenerationCanvasGroup) => (group.card_ids || []).filter(id => live.has(id))
      const bounds = (members: string[], group?: GenerationCanvasGroup): Frame => {
        const frames = members.map(id => ({ ...point(id), ...sizes[id] }))
        if (group) frames.push(generationGroupBounds(group, members, point, sizes))
        const x = Math.min(...frames.map(frame => frame.x))
        const y = Math.min(...frames.map(frame => frame.y))
        return {
          x, y, width: Math.max(...frames.map(frame => frame.x + frame.width)) - x,
          height: Math.max(...frames.map(frame => frame.y + frame.height)) - y,
        }
      }
      const translate = (members: string[], dx: number, dy: number) => {
        for (const id of members) positions[id] = { x: point(id).x + dx, y: point(id).y + dy }
      }
      // 视频仍是主区锚点，含视频的编组按原成员相对位置整体移动。
      const main: Frame[] = []
      for (const id of shots.flat()) {
        if (positions[id]) continue
        const group = groupFor.get(id)
        const members = group ? liveMembers(group) : [id]
        const frame = bounds(members, group)
        const dx = preferred[id].x - point(id).x
        const target = { ...frame, x: frame.x + dx, y: frame.y + preferred[id].y - point(id).y }
        const y = availableY(target, main, 0)
        translate(members, dx, y - frame.y)
        main.push({ ...target, y })
      }
      const leftEdge = Math.min(0, ...main.map(frame => frame.x))
      const rightEdge = Math.max(mainWidth, ...main.map(frame => frame.x + frame.width))
      let leftTop = 0, rightTop = 0
      const place = (members: string[], right: boolean, group?: GenerationCanvasGroup) => {
        const frame = bounds(members, group)
        const x = right ? rightEdge + gap : leftEdge - frame.width - gap
        const y = right ? rightTop : leftTop
        translate(members, x - frame.x, y - frame.y)
        if (right) rightTop += frame.height + gap
        else leftTop += frame.height + gap
      }
      const shotStacks = storyboard.shots.map(shot => designStackId(shot.shot_id))
      for (const group of groups) {
        const members = liveMembers(group)
        if (members.length && !members.some(id => positions[id])) {
          place(members, shotGroups.has(group.id) || members.some(id => shotCards.has(id)) ||
            group.kind === 'stack' && shotStacks.some(id => belongsToDesignStack(group.id, id)), group)
        }
      }
      for (const { id } of nodes) if (!positions[id]) place([id], false)
      return positions
    }
  return { placeAdditions, initial: firstApplication ? {
    anchorId,
    arrange: (nodes, sizes, width) => {
      const { positions, mainWidth } = placeVideoRows(shots, sizes, width)
      const stacks = document.groups?.filter(group => group.kind === 'stack') || []
      let leftTop = 0, rightTop = 0
      for (const stack of stacks) {
        const members = (stack.card_ids || []).filter(id => sizes[id])
        if (!members.length) continue
        const shot = document.storyboard?.shots.find(item => members.includes(item.card_id))
        const cover = generationGroupBounds(stack, members, () => ({ x: 0, y: 0 }), sizes)
        const anchor = shot && positions[shot.model_card_ids[0]]
        const y = shot ? Math.max(rightTop, anchor?.y || 0) : leftTop
        const firstWidth = Math.max(cover.width, sizes[members[0]].width)
        let x = shot ? mainWidth + gap : -firstWidth - gap
        // 堆叠成员解除后在外围展开，封面和隐藏成员都不占用视频主区。
        members.forEach((id, index) => {
          if (!shot && index > 0) x -= sizes[id].width + gap
          positions[id] = { x, y }
          if (shot) x += (index === 0 ? firstWidth : sizes[id].width) + gap
        })
        const bottom = y + Math.max(cover.height, ...members.map(id => sizes[id].height)) + gap
        if (shot) rightTop = bottom
        else leftTop = bottom
      }
      const shotGroups = new Set(document.storyboard?.shots.map(shot => shot.group_id))
      const shotCards = new Set(document.groups?.filter(group => shotGroups.has(group.id)).flatMap(group => group.card_ids || []))
      for (const { id } of nodes) {
        if (positions[id]) continue
        if (shotCards.has(id)) {
          positions[id] = { x: mainWidth + gap, y: rightTop }
          rightTop += sizes[id].height + gap
        } else {
          positions[id] = { x: -sizes[id].width - gap, y: leftTop }
          leftTop += sizes[id].height + gap
        }
      }
      return positions
    },
    focus,
  } : undefined, explicit: {
    anchorId,
    focus,
    arrange: arrangeExplicit(document.groups || []),
    organize: () => {
      const organized = organizeStoryboardDesigns(document)
      if (organized) return { groups: organized.groups, arrange: arrangeExplicit(organized.groups, organized.newStacks) }
    },
  } }
}
