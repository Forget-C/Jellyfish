export const mainNavigation = [
  { key: 'home', to: '/' },
  { key: 'canvases', to: '/canvases' },
  { key: 'projects', to: '/projects' },
  { key: 'management', to: '/models' },
  { key: 'lab', to: '/lab' },
] as const

export const managementNavigation = [
  { to: '/models', label: '模型管理' },
  { to: '/assets', label: '资产库' },
  { to: '/prompts', label: '提示词模板' },
  { to: '/files', label: '文件管理' },
  { to: '/agents', label: 'Agent 管理' },
] as const

export function managementPageForPath(pathname: string) {
  return managementNavigation.find(({ to }) => pathname === to || pathname.startsWith(`${to}/`))
}

export function activeMainNavigation(pathname: string): typeof mainNavigation[number]['key'] | undefined {
  const section = pathname.split('/')[1]
  if (!section) return 'home'
  if (section === 'canvases') return 'canvases'
  if (section === 'projects') return 'projects'
  if (managementPageForPath(pathname)) return 'management'
  if (section === 'lab') return 'lab'
  return undefined
}

export type BreadcrumbItem = { label: string; to?: string; state?: { chapterReturn: string } }
type NavigationTitles = { page?: string; project?: string; chapter?: string }

function chapterReturn(id: string): BreadcrumbItem['state'] {
  try { return { chapterReturn: decodeURIComponent(id) } } catch { return undefined }
}

/** 只连接已存在的业务路由；实体名称由页面或上级读取提供，不显示路径中的 ID。 */
export function pageBreadcrumbs(pathname: string, titles: NavigationTitles = {}): BreadcrumbItem[] {
  const path = pathname.split('/').filter(Boolean)
  if (path[0] === 'projects' && path[1]) {
    const project = `/projects/${path[1]}`
    const items: BreadcrumbItem[] = [{ label: '项目', to: '/projects' }]
    if (path.length === 2) return [...items, { label: titles.page || '项目工作台' }]
    items.push({ label: titles.project || '项目', to: project })
    if (path.length === 5 && path[2] === 'roles' && path[3] && path[4] === 'edit') {
      return [...items, { label: '角色', to: `${project}?tab=roles` }, { label: titles.page || '角色档案' }]
    }
    if (path.length === 5 && path[2] === 'chapters' && path[4] === 'workbench-management') {
      return [...items, { label: '章节', to: `${project}?tab=chapters`, state: chapterReturn(path[3]) }, { label: titles.page || '工作台管理' }]
    }
    if ((path.length === 5 || path.length === 6) && path[2] === 'chapters' && path[3] && path[4] === 'sequences') {
      if (!path[5]) return [...items, { label: titles.page || '章节场次' }]
      return [...items, { label: titles.chapter || '章节', to: `${project}?tab=chapters&chapter=${path[3]}&sequence=${path[5]}` }, { label: titles.page || '场次工作台' }]
    }
    return [{ label: '页面未找到' }]
  }
  const categories: Record<string, { label: string; tab: string }> = {
    actors: { label: '演员', tab: 'actor' }, scenes: { label: '场所', tab: 'scene' },
    props: { label: '道具', tab: 'prop' }, costumes: { label: '服装', tab: 'costume' },
  }
  if (path.length === 4 && path[0] === 'assets' && categories[path[1]] && path[2] && path[3] === 'edit') {
    const category = categories[path[1]]
    return [{ label: '资产', to: '/assets' }, { label: category.label, to: `/assets?tab=${category.tab}` }, { label: titles.page || `${category.label}档案` }]
  }
  if (path.length === 3 && path[0] === 'agents' && path[1] && path[2] === 'edit') return [{ label: 'Agent 管理', to: '/agents' }, { label: titles.page || 'Agent 编辑' }]
  const pageLabels: Record<string, string> = { canvases: '画布', projects: '项目列表', lab: '实验室', settings: '设置' }
  const label = managementPageForPath(pathname)?.label ?? pageLabels[path[0]]
  return [{ label: path.length === 0 ? '首页' : (path.length === 1 && typeof label === 'string' ? label : '页面未找到') }]
}
