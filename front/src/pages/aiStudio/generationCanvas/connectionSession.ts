import type { ConnectionSide } from './connectionGeometry'
import type { GenerationEdge } from './graphRules'

type Source = { card: string; side: ConnectionSide }
type Point = { x: number; y: number }
export type ConnectionState = {
  drag?: Source & Point
  accessibleConnection?: Source
  pendingConnection?: Point & { target: string; side: ConnectionSide }
}
type ConnectionHost = {
  change: (state: ConnectionState) => void
  options: (source: string, target: string) => GenerationEdge[]
  direct: (source: string) => boolean
  issue: (source: string, target: string) => void
  // 提交端按当前文档复核只读、重复连接与兼容性，再写入文档历史。
  commit: (option: GenerationEdge, target: ConnectionSide, source: ConnectionSide) => void
  end: () => void
}

/** 两种连线入口共用目标决策；指针失败结束，会话式选目标失败则保留来源。 */
export function createConnectionSession(host: ConnectionHost) {
  let state: ConnectionState = {}
  let pointer = false
  const change = (next: ConnectionState) => { state = next; host.change(next) }
  const cancel = () => { pointer = false; change({}); host.end() }
  const commit = (option: GenerationEdge, side: ConnectionSide) => {
    const source = state.drag || state.accessibleConnection
    if (!source) return
    host.commit(option, side, source.side)
    cancel()
  }
  return {
    get pointerActive() { return pointer },
    start(source: Source, point?: Point) {
      pointer = !!point
      change(point ? { drag: { ...source, ...point } } : { accessibleConnection: source })
    },
    move(point: Point) {
      if (state.drag && !state.pendingConnection) change({ ...state, drag: { ...state.drag, ...point } })
    },
    choose(target: string, side: ConnectionSide, point: Point) {
      const source = state.drag || state.accessibleConnection
      if (!source) return
      pointer = false
      const options = host.options(source.card, target)
      if (!options.length) {
        host.issue(source.card, target)
        if (state.drag) cancel()
      } else if (options.length === 1 || host.direct(source.card)) commit(options[0], side)
      else change({ ...state, pendingConnection: { target, side, ...point } })
    },
    commit,
    cancel,
  }
}
