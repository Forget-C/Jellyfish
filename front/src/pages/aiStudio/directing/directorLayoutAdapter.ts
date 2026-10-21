import { arrangeDirector, readDirectorView, upgradeOverviewPositions } from './directorLayout'
import { readStoredGraphView } from './useGraphLayout'
import type { GraphLayoutScope } from './useGraphLayout'

export type DirectorLayoutScope = Omit<GraphLayoutScope, 'arrange' | 'migrate' | 'parseView'>

/** 导演独有排布和旧缓存升级留在适配层，其他画布只复用共同状态管理。 */
export function directorLayoutScope(scope: DirectorLayoutScope): GraphLayoutScope {
  return { ...scope, arrange: arrangeDirector, parseView: readDirectorView,
    migrate: scope.viewId === 'overview' ? (view, nodes, sizes) => {
      if (view.layoutVersion === 4) return
      const positions = upgradeOverviewPositions(view, nodes, sizes)
      const undo = view.layoutVersion !== 3 && Object.keys(view.positions).length
        ? { ...view, layoutVersion: 4, manuallyPlaced: Object.keys(view.positions) } : undefined
      return { view: { ...view, positions, layoutVersion: 4,
        manuallyPlaced: view.layoutVersion !== 3 ? Object.keys(positions) : view.manuallyPlaced }, undo }
    } : undefined }
}

/** 预览读取与实际导演画布相同的缓存，不创建浏览状态。 */
export const readStoredDirectorView = (key: string) => readStoredGraphView(key, readDirectorView)
