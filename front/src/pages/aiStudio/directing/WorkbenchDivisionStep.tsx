import { useState } from 'react'
import { ChapterRawTextEditorModal } from '../chapter/components/ChapterRawTextEditorModal'
import { ChapterSourcePanel } from './ChapterSourcePanel'
import './workspace.css'

/** 管理页复用原文编辑、整章划分草稿和历史版本。 */
export function WorkbenchDivisionStep({ projectId, chapterId, sequenceId, refreshKey, onChanged, onSourceSaved }: {
  projectId: string; chapterId: string; sequenceId?: string; refreshKey: number
  onChanged: (sequenceId: string) => void; onSourceSaved: () => void
}) {
  const [editingSource, setEditingSource] = useState(false)
  const [sourceRevision, setSourceRevision] = useState(0)
  return <section className="management-division" aria-label="整章划分">
    <ChapterSourcePanel key={`${refreshKey}:${sourceRevision}`} {...{ projectId, chapterId, sequenceId, onChanged }}
      embedded refreshKey={0} onEdit={() => setEditingSource(true)} />
    {editingSource && <ChapterRawTextEditorModal open {...{ projectId, chapterId }} onClose={() => setEditingSource(false)}
      onReviewSequences={() => setEditingSource(false)} onSaved={() => {
        setSourceRevision(value => value + 1)
        onSourceSaved()
      }} />}
  </section>
}
