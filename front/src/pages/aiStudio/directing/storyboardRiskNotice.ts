/** Application feedback is consumed once, independently of subsequent canvas edits. */
const pendingKey = (projectId: string, canvasId: string) => 'jellyfish:risk-notice:' + JSON.stringify([projectId, canvasId])

export function queueStoryboardRiskNotice(projectId: string, canvasId: string, taskId: string) {
  try {
    const seen = pendingKey(projectId, canvasId) + ':' + taskId
    if (localStorage.getItem(seen)) return
    sessionStorage.setItem(pendingKey(projectId, canvasId), taskId)
    localStorage.setItem(seen, '1')
  } catch { /* Confirmation succeeded; unavailable feedback storage must not affect application. */ }
}

export function consumeStoryboardRiskNotice(projectId: string, canvasId: string, taskId?: string) {
  try {
    const key = pendingKey(projectId, canvasId)
    if (!taskId || sessionStorage.getItem(key) !== taskId) return false
    sessionStorage.removeItem(key)
    return true
  } catch { return false }
}
