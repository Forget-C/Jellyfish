import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { chapterLocation } from './chapterNavigation'

/** 旧章节场次链接统一进入章节页，保留已知面板与场次定位。 */
export default function ChapterSequencesPage() {
  const { projectId = '', chapterId = '' } = useParams()
  const [params] = useSearchParams()
  const target = new URLSearchParams({ tab: 'chapters', chapter: chapterId })
  const panel = params.get('panel')
  if (panel === 'source' || panel === 'assembly') target.set('panel', panel)
  if (params.get('sequence')) target.set('sequence', params.get('sequence')!)
  return <Navigate replace to={`${chapterLocation(projectId).split('?')[0]}?${target}`} />
}
