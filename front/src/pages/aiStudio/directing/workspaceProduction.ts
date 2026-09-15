import type { WorkspaceRead } from '../../../services/generated'

/** 单元身份包含计划版本；展示和执行使用同一范围，不能靠同名动作合并。 */
export function productionRecords(workspace: WorkspaceRead, planId?: string, unitId?: string, promptId?: string) {
  const prompts = workspace.prompts.filter(row => !!planId && !!unitId && row.content.plan_revision_id === planId && row.content.unit_id === unitId)
  const prompt = prompts.find(row => row.id === promptId)
  const reviews = prompt ? workspace.reviews.filter(row => row.content.occurrences.length > 0 && row.content.occurrences.every(item => item.prompt_revision_id === prompt.id && item.plan_revision_id === planId && item.unit_id === unitId)) : []
  const takes = workspace.takes.filter(row => !!planId && !!unitId && row.plan_revision_id === planId && row.unit_id === unitId)
  return { prompts, prompt, reviews, takes }
}

/** 操作响应仅能定位唯一新增对象；并发产生多个版本时留给用户明确选择。 */
export function uniqueNewRecord<T extends { id: string }>(before: T[], after: T[]): T | undefined {
  const ids = new Set(before.map(row => row.id))
  const added = after.filter(row => !ids.has(row.id))
  return added.length === 1 ? added[0] : undefined
}

/** 写入后的人工修改仍保留模型来源；不能因正文不再完全相同就重新宣称建议未处理。 */
export function designResultRecorded(design: WorkspaceRead['designs'][number]['content'], revisions: WorkspaceRead['designs']): boolean {
  const modelSources = (value: unknown): string[] => {
    if (!value || typeof value !== 'object') return []
    if (Array.isArray(value)) return value.flatMap(modelSources)
    const row = value as Record<string, unknown>
    if (row.kind === 'model' && typeof row.reference === 'string' && typeof row.version === 'string') return [JSON.stringify([row.reference, row.version])]
    return Object.values(row).flatMap(modelSources)
  }
  const sources = new Set(modelSources(design))
  return revisions.some(row => JSON.stringify({ ...row.content, sources: design.sources }) === JSON.stringify(design) || modelSources(row.content).some(source => sources.has(source)))
}
