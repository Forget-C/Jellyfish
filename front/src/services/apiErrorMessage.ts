/** 从统一错误响应中提取具体业务缺口，供调用方展示。 */
export function apiErrorMessage(error: unknown): string {
  const value = error as { body?: { message?: unknown; detail?: unknown }; message?: string }
  const detail = value?.body?.detail
  if (Array.isArray(detail)) return detail.map(row => `${row.loc?.join('.') || '输入'}：${row.msg || '格式不正确'}`).join('；')
  const message = value?.body?.message || detail || value?.message
  return typeof message === 'string' ? message : '操作失败，请核对输入后重试'
}
