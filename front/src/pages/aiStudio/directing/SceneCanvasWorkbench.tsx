import { useCallback, useEffect, useState } from 'react'
import { Alert, Space, Spin } from 'antd'
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components/layout/PageLayout'
import { ApiError, StudioDirectingService, type CanvasRead, type ImageModelCard, type SceneCanvasesRead, type VideoModelCard } from '../../../services/generated'
import { TaskCenter } from '../components/TaskCenter'
import { GenerationCanvasWorkspace } from '../generationCanvas/GenerationCanvasWorkspace'
import { SceneStoryboardPreparation } from './SceneStoryboardPreparation'
import { saveChapterBrowse, sceneCanvasLocation, workbenchManagementLocation } from './chapterNavigation'
import { directingError } from './common'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import { WorkbenchTheme } from './ui/WorkbenchTheme'
import { storyboardCanvasLayout } from './storyboardCanvasLayout'

type Scope = { projectId: string; chapterId: string; sequenceId: string }

const videoActionLabels: Record<string, string> = {
  queued: '排队中', running: '运行中', failed: '重试生成', succeeded: '再次生成',
}

/** 打开经过场次归属核对的共同画布，返回时带上当前画布和任务。 */
function SceneCanvasHost({ projectId, chapterId, sequenceId, canvasId }: Scope & { canvasId: string }) {
  const [query] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const selectedTaskId = query.get('storyboardTask')
  const [scene, setScene] = useState<SceneCanvasesRead>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setLoadError('')
    const request = StudioDirectingService.directingSceneCanvases({ projectId, chapterId, sequenceId })
    void request.then(response => {
      if (!active) return
      if (!response.data) throw new Error('无法读取本场画布')
      setScene(response.data)
    }).catch(cause => {
      if (!active) return
      setLoadError(directingError(cause))
      if (cause instanceof ApiError && cause.status === 404) setScene(undefined)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; request.cancel() }
  }, [projectId, chapterId, sequenceId, canvasId, refresh])
  useEffect(() => {
    const reload = () => setRefresh(value => value + 1)
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [])
  const rememberOpened = useCallback((canvas: CanvasRead) => {
    if (canvas.scene?.chapter_id === chapterId && canvas.scene.sequence_id === sequenceId) {
      saveChapterBrowse(projectId, chapterId, { managementCanvas: canvas.id })
    }
  }, [projectId, chapterId, sequenceId])
  const retry = <Button disabled={loading} onClick={() => setRefresh(value => value + 1)}>重试读取场次</Button>
  const management = (step: 'division' | 'storyboard' = 'storyboard') => navigate(workbenchManagementLocation(
    projectId, chapterId, sequenceId, step, step === 'storyboard' ? { canvas: canvasId, storyboardTask: selectedTaskId } : undefined),
  { state: location.state })
  if (scene?.canvases.some(canvas => canvas.id === canvasId)) {
    return <GenerationCanvasWorkspace key={canvasId} projectId={projectId} canvasId={canvasId}
      layoutPolicy={storyboardCanvasLayout}
      hostError={loadError} hostErrorAction={loadError ? retry : undefined}
      storyboardTaskId={selectedTaskId} onCanvasRead={rememberOpened}
      back={{ label: '返回工作台管理', onClick: () => management() }}
      renderModelCardAction={({ card, document, runStatus, disabled, checking, precheck }) => {
        if (card.type !== 'model.video') return null
        const shot = document.storyboard?.shots.find(item => item.model_card_ids.includes(card.id))
        if (!shot) return null
        const shotCard = document.cards?.find(item => item.id === shot.card_id)
        const name = shotCard && 'name' in shotCard && shotCard.name || '镜头'
        const label = shot.model_card_ids.length > 1 ? `${name} · 片段 ${shot.model_card_ids.indexOf(card.id) + 1}` : name
        return <><span title={label}>{label}</span>
          <Button size="small" variant="primary" disabled={disabled} loading={checking} onClick={event => precheck(event.currentTarget)}>
            {videoActionLabels[runStatus ?? ''] || '生成视频'}
          </Button></>
      }}
      renderSceneActions={({ current, document, editable, requestLeave }) => {
        if (!current || !document?.fixed_source) return null
        const basis = document.cards?.find(card => card.id === document.fixed_source?.card_id)
        const modelIds = new Set(document.storyboard?.shots.flatMap(shot => shot.model_card_ids))
        const models = document.cards?.filter((card): card is ImageModelCard | VideoModelCard =>
          modelIds.has(card.id) && (card.type === 'model.image' || card.type === 'model.video'))
        const model = models?.find(card => card.model_id) ?? models?.[0]
        return <SceneStoryboardPreparation key={current.id} scope={{ projectId, chapterId, sequenceId }}
          navigationKey={location.key} selectedTaskId={selectedTaskId} editable={editable && !!scene.sequence.is_current}
          target={{ id: current.id, appliedTaskId: current.document.storyboard?.task_id,
            sourceChanged: !!current.source_changed ||
              !!basis && 'text' in basis && basis.text !== scene.sequence.source_text ||
              !!basis && 'selection_start' in basis && (basis.selection_start !== scene.sequence.span?.start ||
                basis.selection_end !== scene.sequence.span?.end),
            sourceReady: !!scene.sequence.is_current && !scene.sequence.source_changed,
            productionModelId: model?.model_id ?? undefined,
            pendingModality: model?.type === 'model.video' ? 'video' : 'image',
            confirmSource: () => void requestLeave().then(allowed => { if (allowed) management('division') }),
          }} onResult={result => {
            if (result.canvas_id === current.id) navigate(sceneCanvasLocation(projectId, chapterId, sequenceId, current.id, result.task_id),
              { replace: true, state: location.state })
          }} />
      }} />
  }
  return <WorkbenchTheme>
    <WorkspaceLayout className="workbench-ui" aria-label="工作台画布">
      <PageToolbar title="工作台画布">
        <Space wrap><Button onClick={() => management()}>返回工作台管理</Button><TaskCenter workbench /></Space>
      </PageToolbar>
      <WorkspaceScrollPanel>
        {loadError ? <Alert type="error" showIcon message={loadError} action={retry} /> : loading
          ? <Spin aria-label="正在读取本场画布" />
          : <Alert type="error" showIcon message="此画布不属于当前场次或已不可用" />}
      </WorkspaceScrollPanel>
    </WorkspaceLayout>
  </WorkbenchTheme>
}

export function SceneCanvasWorkbench() {
  const { projectId, chapterId, sequenceId } = useParams()
  const [query] = useSearchParams()
  const { state } = useLocation()
  if (!projectId || !chapterId || !sequenceId) return null
  const canvasId = query.get('canvas')
  if (canvasId === null) return <Navigate replace state={state}
    to={workbenchManagementLocation(projectId, chapterId, sequenceId, query.has('objectTask') ? 'objects' : 'storyboard',
      { canvas: query.get('selected'), storyboardTask: query.get('storyboardTask'), objectTask: query.get('objectTask') })} />
  return <SceneCanvasHost key={JSON.stringify([projectId, chapterId, sequenceId, canvasId])} {...{ projectId, chapterId, sequenceId, canvasId }} />
}
