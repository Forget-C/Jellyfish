import { useEffect, useState } from 'react'
import type { CanvasPoint } from '../../../components/canvas/geometry'

export const connectionSides = ['top', 'right', 'bottom', 'left'] as const
export type ConnectionSide = typeof connectionSides[number]
export type EdgeSides = { source: ConnectionSide; target: ConnectionSide }
export const sideLabels: Record<ConnectionSide, string> = { top: '上', right: '右', bottom: '下', left: '左' }
export function sidePoint(point: CanvasPoint, width: number, height: number, side: ConnectionSide): CanvasPoint {
  return { x: point.x + (side === 'left' ? 0 : side === 'right' ? width : width / 2), y: point.y + (side === 'top' ? 0 : side === 'bottom' ? height : height / 2) }
}
export function defaultSides(from: CanvasPoint, to: CanvasPoint): EdgeSides {
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
    ? to.x >= from.x ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' }
    : to.y >= from.y ? { source: 'bottom', target: 'top' } : { source: 'top', target: 'bottom' }
}
export function connectionPath(from: CanvasPoint, to: CanvasPoint, source: ConnectionSide, target?: ConnectionSide) {
  const offset = (point: CanvasPoint, side?: ConnectionSide) => ({ x: point.x + (side === 'left' ? -80 : side === 'right' ? 80 : 0), y: point.y + (side === 'top' ? -80 : side === 'bottom' ? 80 : 0) })
  const first = offset(from, source), last = offset(to, target)
  return `M ${from.x} ${from.y} C ${first.x} ${first.y}, ${last.x} ${last.y}, ${to.x} ${to.y}`
}
/** 几何侧别仅存本浏览器布局，不进入业务文档、修订或生成依据；宿主按项目与画布身份重挂载。 */
export function useConnectionSides(key: string, edgeIds: string[]) {
  const read = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, EdgeSides>
      return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value && connectionSides.includes(value.source) && connectionSides.includes(value.target)))
    } catch { return {} }
  }
  const [sides, setSides] = useState<Record<string, EdgeSides>>(read)
  const [error, setError] = useState('')
  const identity = edgeIds.join('|')
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries(sides).filter(([id]) => identity.split('|').includes(id))))) }
    catch { setError('浏览器存储不可用，连接侧边仅在本次会话保留') }
  }, [key, sides, identity])
  return { sides, setSides, error }
}
