import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { chapterCompositionRetired, chapterLocation, workbenchManagementLocation } from './chapterNavigation'

/** 旧章节场次链接保留场次定位，已停用的章节组合转入工作台管理。 */
export default function ChapterSequencesPage() {
  const { projectId = '', chapterId = '' } = useParams()
  const [params] = useSearchParams()
  const target = new URLSearchParams({ tab: 'chapters', chapter: chapterId })
  const panel = params.get('panel')
  if (panel === 'assembly') return <Navigate replace to={workbenchManagementLocation(projectId, chapterId, params.get('sequence') || undefined)}
    state={chapterCompositionRetired} />
  if (panel === 'source') target.set('panel', panel)
  if (params.get('sequence')) target.set('sequence', params.get('sequence')!)
  return <Navigate replace to={`${chapterLocation(projectId).split('?')[0]}?${target}`} />
}
