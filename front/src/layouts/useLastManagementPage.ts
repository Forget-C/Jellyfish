import { useEffect, useState } from 'react'
import { managementNavigation, managementPageForPath } from './navigation'

const storageKey = 'jellyfish_last_management_page'

function readLastPage() {
  try {
    const saved = localStorage.getItem(storageKey)
    return managementNavigation.find(({ to }) => to === saved)?.to ?? '/models'
  } catch {
    return '/models'
  }
}

/** 顶部管理入口只记住二级根页面，详情地址与筛选参数继续由当前路由管理。 */
export function useLastManagementPage(pathname: string) {
  const currentPage = managementPageForPath(pathname)?.to
  const [lastPage, setLastPage] = useState(readLastPage)

  useEffect(() => {
    if (!currentPage) return
    setLastPage(currentPage)
    try {
      localStorage.setItem(storageKey, currentPage)
    } catch {
      // 浏览器限制存储时，当前页面仍可使用内存中的选择。
    }
  }, [currentPage])

  return currentPage ?? lastPage
}
