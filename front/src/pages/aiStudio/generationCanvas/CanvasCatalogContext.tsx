import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from 'antd'
import { StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCatalog } from '../../../services/generated'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { createGraphRules } from './graphRules'

const CatalogContext = createContext<ReturnType<typeof createGraphRules> | undefined>(undefined)

/** 目录核实成功后才开放卡片编辑，不以另一份前端端点表静默降级。 */
export function CanvasCatalogProvider({ projectId, canvasId, children }: { projectId: string; canvasId: string; children: ReactNode }) {
  const [catalog, setCatalog] = useState<CanvasCatalog>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError(false); setCatalog(undefined)
    Canvases.canvasCatalog({ projectId, canvasId }).then(response => {
      if (!response.data) throw new Error('empty catalog')
      if (active) setCatalog(response.data)
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [projectId, canvasId, attempt])
  const rules = useMemo(() => catalog && createGraphRules(catalog), [catalog])
  if (error) return <div className="generation-catalog-state"><Alert type="error" message="卡片目录读取失败" description="尚未核实卡片端点，请重试后继续编辑。" action={<WorkbenchButton onClick={() => setAttempt(value => value + 1)}>重试卡片目录</WorkbenchButton>} /></div>
  if (!rules) return <p className="generation-catalog-state" role="status">正在核实卡片目录…</p>
  return <CatalogContext.Provider value={rules}>{children}</CatalogContext.Provider>
}

export function useGraphRules() {
  const rules = useContext(CatalogContext)
  if (!rules) throw new Error('画布编辑器需要已核实的卡片目录')
  return rules
}
