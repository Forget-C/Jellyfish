import { withoutRunTarget } from './navigation'
import { Button } from 'antd'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { GenerationCanvasWorkspace } from './GenerationCanvasWorkspace'
import { CanvasDeletionDialog } from './CanvasDeletionDialog'

/** 独立画布只提供自由编辑入口，不读取项目或分镜数据。 */
export function GenerationCanvasPage() {
  const { canvasId } = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  return <GenerationCanvasWorkspace projectId="" canvasId={canvasId || null}
    back={{ label: '返回画布列表', onClick: () => navigate('/canvases') }} hostError={error}
    targetRun={search.get('run')} targetNode={search.get('node')} targetCheck={null} targetReport={null}
    onCloseRunHistory={() => setSearch(withoutRunTarget, { replace: true })}
    renderCanvasManagement={({ current, running, editable, saving, nameEditor, requestLeave, canEdit }) => <>
      {nameEditor}
      <Button danger disabled={!current || running || !editable || saving} onClick={() => {
        void requestLeave().then(allowed => { if (allowed && canEdit()) setDeleting(true) })
      }}>删除画布</Button>
      {deleting && canvasId && <CanvasDeletionDialog projectId="" canvasId={canvasId} workbench
        canDelete={async () => !running && canEdit() && await requestLeave() && canEdit()}
        onClose={() => setDeleting(false)} onFailure={setError} onDeleted={() => navigate('/canvases', { replace: true })} />}
    </>} />
}
