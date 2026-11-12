import { useNavigate } from 'react-router-dom'
import { ChapterSourcePanel } from './ChapterSourcePanel'
import './workspace.css'

/** 管理页保留整章草稿与历史，原文编辑统一返回章节页。 */
export function WorkbenchDivisionStep({ projectId, chapterId, sequenceId, refreshKey, onChanged, targetTask, onCloseTask, actionHost }: {
  projectId: string; chapterId: string; sequenceId?: string; refreshKey: number
  onChanged: (sequenceId: string, count: number) => void
  targetTask: string | null; onCloseTask: () => void
  actionHost?: HTMLDivElement | null
}) {
  const navigate = useNavigate()
  return <section className="management-division" aria-label="整章划分">
    <ChapterSourcePanel key={refreshKey} {...{ projectId, chapterId, sequenceId, onChanged }}
      embedded actionHost={actionHost} refreshKey={0} {...{ targetTask, onCloseTask }}
      onEdit={() => navigate(`/projects/${projectId}?tab=chapters&edit=${encodeURIComponent(chapterId)}`)} />
  </section>
}
