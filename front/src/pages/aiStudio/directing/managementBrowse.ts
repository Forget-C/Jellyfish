/** 本次页面会话中的阅读位置；业务数据与草稿不存入此记录。 */
type Browse = { association?: string; reference?: string; query?: string; focus?: string; kind?: 'all' | 'character' | 'scene' | 'prop'; unprepared?: boolean; history?: boolean; top?: number }
const positions = new Map<string, Browse>()
export const managementBrowseKey = (project: string, chapter: string, scene: string, step: string) => JSON.stringify([project, chapter, scene, step])
export const readManagementBrowse = (key: string): Browse => positions.get(key) ?? {}
export function saveManagementBrowse(key: string, value: Browse) {
  positions.set(key, { ...readManagementBrowse(key), ...value })
}
