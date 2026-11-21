import { uiText } from '../../uiText'
/** 当接口无法匹配页面承诺的字段时，显式搜索才逐页检查该集合。 */
export async function searchManagementList<T>(
  readPage: (page: number) => Promise<{ items: T[]; total?: number }>,
  pageSize: number,
  matches: (item: T) => boolean,
  isCurrent: () => boolean,
): Promise<T[] | undefined> {
  const result: T[] = []
  for (let page = 1; isCurrent(); page += 1) {
    const { items, total } = await readPage(page)
    if (!isCurrent()) return
    result.push(...items.filter(matches))
    if (total === undefined ? items.length < pageSize : page * pageSize >= total) return result
    if (!items.length) throw new Error(uiText("列表页与分页总量不一致"))
  }
}
