import { useUiText } from '../../../uiText'
import { useEffect, useState } from 'react'
import type { CanvasPoint } from '../../../components/canvas/geometry'

export const connectionSides = ['left', 'right'] as const
export type ConnectionSide = typeof connectionSides[number]
export type EdgeSides = { source: ConnectionSide; target: ConnectionSide }
export const sideLabels: Record<ConnectionSide, string> = { right: '右', left: '左' }
export function sidePoint(point: CanvasPoint, width: number, height: number, side: ConnectionSide): CanvasPoint {
  return { x: point.x + (side === 'left' ? 0 : width), y: point.y + height / 2 }
}
export function defaultSides(from: CanvasPoint, to: CanvasPoint): EdgeSides {
  return to.x >= from.x ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' }
}

export function connectionPath(from: CanvasPoint, to: CanvasPoint, source: ConnectionSide, target?: ConnectionSide, lane = 0) {
  const offset = (point: CanvasPoint, side?: ConnectionSide) => ({ x: point.x + (side === 'left' ? -80 : side === 'right' ? 80 : 0), y: point.y })
  const first = offset(from, source), last = offset(to, target)
  // 平行用途只偏移控制点，共享的几何端点仍精确落在卡片侧边。
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
  if (horizontal) { first.y += lane; last.y += lane }
  else { first.x += lane; last.x += lane }
  return `M ${from.x} ${from.y} C ${first.x} ${first.y}, ${last.x} ${last.y}, ${to.x} ${to.y}`
}
/** 几何侧别仅存本浏览器布局，不进入业务文档、修订或生成依据；宿主按项目与画布身份重挂载。 */
export function useConnectionSides(key: string, edgeIds: string[], defaults: Record<string, EdgeSides>) {
  const uiText = useUiText()
  const read = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, EdgeSides>
      return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value).map(([id, value]) => [id, {
        source: connectionSides.includes(value.source) ? value.source : defaults[id]?.source || 'right',
        target: connectionSides.includes(value.target) ? value.target : defaults[id]?.target || 'left',
      }]))
    } catch { return {} }
  }
  const [sides, setSides] = useState<Record<string, EdgeSides>>(read)
  const [error, setError] = useState('')
  const identity = edgeIds.join('|')
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries(sides).filter(([id]) => identity.split('|').includes(id))))) }
    catch { setError(uiText("浏览器存储不可用，连接侧边仅在本次会话保留")) }
  }, [uiText, key, sides, identity])
  return { sides, setSides, error }
}
