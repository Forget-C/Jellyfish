import { useEffect, useLayoutEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { create } from 'zustand'
import { StudioChaptersService, StudioProjectsService } from '../services/generated'

const useTitleStore = create<{ pathname: string; title?: string }>(() => ({ pathname: '' }))

/** 发布页面已加载的名称；调用方须核对对象身份，不能将旧对象状态用于新路由。 */
export function usePageTitle(title?: string) {
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    useTitleStore.setState({ pathname, title })
    return () => {
      if (useTitleStore.getState().pathname === pathname) useTitleStore.setState({ pathname: '', title: undefined })
    }
  }, [pathname, title])
}

/** 只补取当前页面没有读取的上级名称，不读取当前实体或改变业务编辑基线。 */
export function useNavigationTitles() {
  const { pathname } = useLocation()
  const current = useTitleStore()
  const [ancestors, setAncestors] = useState<{ pathname: string; project?: string; chapter?: string }>({ pathname: '' })
  useEffect(() => {
    let active = true
    const path = pathname.split('/').filter(Boolean)
    const projectId = path[0] === 'projects' && path.length > 2 ? path[1] : undefined
    const chapterId = path[2] === 'chapters' && path[4] === 'sequences' && path[5] ? path[3] : undefined
    setAncestors({ pathname })
    if (projectId) {
      void StudioProjectsService.getProjectApiV1StudioProjectsProjectIdGet({ projectId }).then(response => {
        if (active) setAncestors(previous => ({ ...previous, project: response.data?.id === projectId ? response.data.name : '项目名称暂不可用' }))
      }).catch(() => { if (active) setAncestors(previous => ({ ...previous, project: '项目名称暂不可用' })) })
    }
    if (chapterId) {
      void StudioChaptersService.getChapterApiV1StudioChaptersChapterIdGet({ chapterId }).then(response => {
        if (active) setAncestors(previous => ({ ...previous, chapter: response.data?.id === chapterId && response.data.project_id === projectId ? response.data.title : '章节名称暂不可用' }))
      }).catch(() => { if (active) setAncestors(previous => ({ ...previous, chapter: '章节名称暂不可用' })) })
    }
    return () => { active = false }
  }, [pathname])
  return { ...(ancestors.pathname === pathname ? ancestors : {}), page: current.pathname === pathname ? current.title : undefined }
}
