import type { EditableRevisionField, ReviewPacket, ReviewRow, RevisionEdit, ReviewRevisionApplication, RevisionFieldTarget } from '../../../services/generated'

/** 范围草稿沿用现有字符串存储；损坏内容阻止提交，不能默认为整体授权。 */
export function readRevisionScope(encoded: string): { scope: RevisionFieldTarget[] | null; invalid: boolean } {
  if (!encoded) return { scope: null, invalid: false }
  try {
    const value = JSON.parse(encoded)
    if (!Array.isArray(value) || !value.length || value.some(item => !item || !['design', 'unit'].includes(item.target) || typeof item.path !== 'string' || !item.path.startsWith('/')) || new Set(value.map(item => `${item.target}:${item.path}`)).size !== value.length) return { scope: null, invalid: true }
    return { scope: value, invalid: false }
  } catch { return { scope: null, invalid: true } }
}

type ReviewSource = { id: string; source_task_id?: string | null; parent_id?: string | null }

/** 问题序号只在不可变检查来源中有效，不借用新检查中相同位置的意见。 */
export const revisionIssueKey = (row: Pick<ReviewRow, 'occurrence_id' | 'role'>, index: number) => JSON.stringify([row.occurrence_id, row.role, index])

export function revisionIssues(packet: ReviewPacket) {
  return packet.rows.filter(row => row.verdict !== 'pass').flatMap(row => (row.findings.length ? row.findings.map((_, index) => index) : [-1]).map(index => ({
    key: revisionIssueKey(row, index), occurrence_id: row.occurrence_id, role: row.role, finding_index: index,
  })))
}

/** 原始保存保留 source_task_id，可延续同一任务草稿；人工取舍派生记录独立。 */
export function reviewDirectionScope(project: string, sequence: string, prompt: string, review?: ReviewSource, taskId?: string) {
  const source = taskId || (!review?.parent_id ? review?.source_task_id : undefined)
  return JSON.stringify(['review-directions', project, sequence, prompt, source ? ['task', source] : ['review', review?.id]])
}

export function revisionDirections(packet: ReviewPacket, values: Record<string, string>) {
  return revisionIssues(packet).map(({ key, ...issue }) => ({ ...issue, direction: values[key] || '' }))
}

/** 比较完整输入而非仅比较请求时间，迟到方案不能覆盖新的处理方向。 */
export function revisionInputIdentity(source: unknown, directions: unknown) { return JSON.stringify([source, directions]) }

/** 人工编辑仅覆盖服务端允许的字段；时长表单以秒显示，固定契约使用毫秒。 */
export function directRevisionEdits(fields: EditableRevisionField[], values: Record<string, string>): RevisionEdit[] {
  return fields.flatMap(field => {
    const value = values[`${field.target}:${field.path}`]
    if (value === undefined) return []
    const note = field.value && typeof field.value === 'object' && 'state' in field.value
    const original = note ? field.value.text || field.value.reason || '' : field.path === '/duration_ms' ? String(field.value / 1000) : String(field.value)
    if (value === original) return []
    const after = note ? { ...field.value, state: 'proposal', text: value, ...(field.value.reason ? { reason: null } : {}) } : field.path === '/duration_ms' ? Number(value) * 1000 : value
    return [{ target: field.target, path: field.path, before: field.value, after }]
  })
}

/** 恢复始终沿原请求继续，按钮说明已经持久化的产物之后还需完成什么。 */
export function revisionRecoveryLabel(application?: ReviewRevisionApplication | null) {
  if (application?.review_task_id) return '查看本次检查'
  if (application?.prompt_revision_id) return '重试检查'
  if (application?.plan_revision_id) return '继续生成指令'
  return application ? '继续保存修改' : '查询上次结果'
}

/** 编译段落可以对应一个对象或具体字段；无映射时不能改为编辑无关的首字段。 */
export function matchingRevisionFields(fields: EditableRevisionField[], paths?: string[]) {
  return paths?.length ? fields.filter(field => paths.some(path => path === field.path || path.startsWith(field.path + '/') || field.path.startsWith(path + '/'))) : fields
}
