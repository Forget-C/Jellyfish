import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { chapterCompositionRetired, legacyChapterManagementLocation } from './chapterNavigation'

/** 旧章节场次链接保留场次定位，已停用的章节组合转入工作台管理。 */
export default function ChapterSequencesPage() {
  const { projectId = '', chapterId = '' } = useParams()
  const [params] = useSearchParams()
  return <Navigate replace to={legacyChapterManagementLocation(projectId, chapterId, params)}
    state={params.get('panel') === 'assembly' ? chapterCompositionRetired : undefined} />
}
