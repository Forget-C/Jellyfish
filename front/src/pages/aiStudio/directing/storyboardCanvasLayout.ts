import type { CanvasPoint } from '../../../components/canvas/geometry'
import type { CanvasDocument } from '../../../services/generated'
import type { GenerationCanvasLayoutPolicy } from '../generationCanvas/generationLayout'
import type { GraphSize } from './graphLayout'

const gap = 64
const narrowWidth = 700

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

/** 工作台按镜头关系组织视频，普通入口不使用该策略。 */
export function storyboardCanvasLayout(document: CanvasDocument, beforeApplication?: CanvasDocument): GenerationCanvasLayoutPolicy | undefined {
  if (!document.storyboard || !beforeApplication || beforeApplication.storyboard ||
      beforeApplication.cards?.some(card => card.id !== beforeApplication.fixed_source?.card_id)) return
  const videos = new Set(document.cards?.filter(card => card.type === 'model.video').map(card => card.id))
  const shots = document.storyboard.shots.map(shot => shot.model_card_ids.filter(id => videos.has(id))).filter(row => row.length)
  const anchorId = shots[0]?.[0]
  if (!anchorId) return
  return { initial: {
    anchorId,
    arrange: (nodes, sizes, width) => {
      const positions: Record<string, CanvasPoint> = {}
      const rows = videoRows(shots, sizes, width)
      const mainWidth = Math.max(...rows.map(row => rowWidth(row, sizes)))
      let top = 0
      for (const row of rows) {
        let left = 0
        for (const id of row) {
          positions[id] = { x: left, y: top }
          left += sizes[id].width + gap
        }
        top += Math.max(...row.map(id => sizes[id].height)) + gap
      }
      // 保留所有原卡，在主区外围放置暂未堆叠的辅助内容。
      let leftTop = 0, rightTop = 0
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
    focus: (sizes, width, height) => {
      const card = sizes[anchorId]
      if (width > narrowWidth) {
        const first = videoRows(shots, sizes, width)[0]
        return { left: Math.max(80, (width - rowWidth(first, sizes)) / 2), top: 180, scale: 1 }
      }
      // 窄屏为左侧添加栏、顶部工具栏和底部视图工具保留操作空间。
      const scale = Math.max(.15, Math.min(1, (width - 96) / card.width, (height - 300) / card.height))
      return { left: 80, top: Math.max(150, (height - card.height * scale) / 2), scale }
    },
  } }
}
