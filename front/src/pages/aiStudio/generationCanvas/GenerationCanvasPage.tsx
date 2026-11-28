import { useUiText } from '../../../uiText'
import { withoutRunTarget } from './navigation'
import { DeleteOutlined, SettingOutlined } from '@ant-design/icons'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import { CanvasSettingsDialog } from './CanvasSettingsDialog'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { GenerationCanvasWorkspace } from './GenerationCanvasWorkspace'
import { CanvasDeletionDialog } from './CanvasDeletionDialog'

/** 独立画布只提供自由编辑入口，不读取项目或分镜数据。 */
export function GenerationCanvasPage() {
  const { canvasId } = useParams()
  return <IndependentCanvasEditor key={canvasId} canvasId={canvasId} />
}

function IndependentCanvasEditor({ canvasId }: { canvasId?: string }) {
  const uiText = useUiText()
  const navigate = useNavigate()
  const { state } = useLocation()
  const [openedAsDraft] = useState(state?.canvasDraft === true)
  const listSearch = typeof state?.canvasListSearch === 'string' ? state.canvasListSearch : ''
  const listLocation = { pathname: '/canvases', search: listSearch }
  const [search, setSearch] = useSearchParams()
  const [deleting, setDeleting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState('')
  return <GenerationCanvasWorkspace projectId="" canvasId={canvasId || null} freeDraft={openedAsDraft}
    onCanvasRead={current => {
      if (state?.canvasDraft && current.revision >= 0) {
        // Update the draft marker without navigating away from the active assistant.
        const entry = window.history.state
        if (entry?.usr?.canvasDraft) {
          window.history.replaceState({ ...entry, usr: { ...entry.usr, canvasDraft: false } }, '')
        }
      }
    }}
    back={{ label: uiText("返回画布列表"), onClick: () => navigate(listLocation) }} hostError={error}
    targetRun={search.get('run')} targetNode={search.get('node')} targetCheck={null} targetReport={null}
    onCloseRunHistory={() => setSearch(withoutRunTarget, { replace: true, state: window.history.state?.usr ?? state })}
    renderCanvasManagement={({ current, document, running, editable, saving, settingsBlocked, settingsPending, settingsDraft, clearSettingsDraft, settingsError, saveSettings, requestLeave, canEdit }, focusMenu) => <>
      <Button variant="quiet" icon={<SettingOutlined />} data-menu-close disabled={!document || !editable || saving || settingsBlocked || settingsPending}
        onClick={() => setSettingsOpen(true)}>{uiText("设置")}</Button>
      <Button variant="danger" icon={<DeleteOutlined />} data-menu-close
        disabled={!current || current.revision < 0 || running || !editable || saving || settingsBlocked || settingsPending} onClick={() => {
          void requestLeave().then(allowed => { if (allowed && canEdit()) setDeleting(true) })
        }}>{uiText("删除画布")}</Button>
      {(settingsOpen || settingsDraft) && document && <CanvasSettingsDialog key={canvasId} document={document} recoveredDraft={settingsDraft}
        blocked={settingsBlocked} pending={settingsPending} disabled={!editable} editorError={settingsError}
        onSave={saveSettings} onClose={() => { setSettingsOpen(false); clearSettingsDraft(); requestAnimationFrame(focusMenu) }} />}
      {deleting && canvasId && <CanvasDeletionDialog projectId="" canvasId={canvasId} workbench
        canDelete={async () => !running && canEdit() && await requestLeave() && canEdit()}
        onClose={() => { setDeleting(false); requestAnimationFrame(focusMenu) }} onFailure={setError} onDeleted={() => navigate(listLocation, { replace: true })} />}
    </>} />
}
