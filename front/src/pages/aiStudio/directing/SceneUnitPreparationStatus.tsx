import { createPortal } from 'react-dom'
import { CanvasToolbarMenu } from './CanvasToolbarMenu'
import { WorkbenchButton } from './ui/WorkbenchButton'
import type { ScenePreparationIssue } from './useSceneUnitPreparation'

/** 准备结论只负责解释与定位；字段编辑和生成操作保留各自入口。 */
export function SceneUnitPreparationStatus({ host, missing, checking, failed, onLocate, onRetry }: {
  host: HTMLElement | null; missing: ScenePreparationIssue[]; checking: boolean; failed: boolean
  onLocate: (issue: ScenePreparationIssue) => void; onRetry: () => void
}) {
  if (!host) return null
  const label = failed ? '准备核实失败' : checking ? '准备核实中' : missing.length ? `待准备 ${missing.length} 项` : '准备齐备'
  return createPortal(<CanvasToolbarMenu label="单元准备状态" caption={<span role="status" aria-live="polite">{label}</span>}>
    <h3>当前单元准备</h3>
    {!missing.length && !checking && !failed && <p>当前单元基础准备已齐备</p>}
    {missing.map((issue, index) => <WorkbenchButton key={`${issue.message}:${index}`} variant="quiet" data-menu-close
      onClick={() => onLocate(issue)}>{issue.message}</WorkbenchButton>)}
    {(checking || failed) && <WorkbenchButton variant="secondary" onClick={onRetry}>重新核实准备状态</WorkbenchButton>}
  </CanvasToolbarMenu>, host)
}
