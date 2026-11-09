import { useEffect, useState } from 'react'
import { Alert, Empty, Input, Space, Spin } from 'antd'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components/layout/PageLayout'
import { StudioDirectingService } from '../../../services/generated'
import type { SceneCanvasesRead, StoryboardCandidate } from '../../../services/generated'
import { GenerationCanvasWorkspace } from '../generationCanvas/GenerationCanvasWorkspace'
import { CanvasTextPreview } from './CanvasTextPreview'
import { SceneObjectPreparation } from './SceneObjectPreparation'
import { SceneStoryboardPreparation } from './SceneStoryboardPreparation'
import { chapterLocation } from './chapterNavigation'
import { directingError } from './common'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import { WorkbenchDialogActions, WorkbenchModal } from './ui/WorkbenchModal'
import { WorkbenchTheme } from './ui/WorkbenchTheme'
import './sceneCanvasWorkbench.css'

type Scope = { projectId: string; chapterId: string; sequenceId: string }

function defaultCanvasName(date = new Date()) {
  const pair = (number: number) => String(number).padStart(2, '0')
  return `分镜画布-${date.getFullYear()}${pair(date.getMonth() + 1)}${pair(date.getDate())}-${pair(date.getHours())}${pair(date.getMinutes())}${pair(date.getSeconds())}`
}

/** 通过已验证的场次列表打开共同工作区，两个入口使用同一画布身份。 */
function SceneCanvasHost({ projectId, chapterId, sequenceId }: Scope) {
  const [query, setQuery] = useSearchParams()
  const navigate = useNavigate()
  const canvasId = query.get('canvas')
  const selected = query.get('selected')
  const [scene, setScene] = useState<SceneCanvasesRead>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [candidate, setCandidate] = useState<StoryboardCandidate>()
  const [name, setName] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true); setLoadError('')
    const request = StudioDirectingService.directingSceneCanvases({ projectId, chapterId, sequenceId })
    void request.then(response => {
      if (!active) return
      if (!response.data) throw new Error('无法读取场次准备')
      setScene(response.data)
    }).catch(cause => {
      if (active) { setLoadError(directingError(cause)); setScene(undefined) }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; request.cancel() }
  }, [projectId, chapterId, sequenceId, canvasId, refresh])
  const openCanvas = (id: string) => setQuery({ canvas: id })
  const returnToPreparation = () => {
    setCandidate(undefined)
    setQuery(canvasId ? { selected: canvasId } : {})
  }
  const chapter = () => navigate(chapterLocation(projectId, chapterId, sequenceId))
  const create = async () => {
    if (name === undefined || creating) return
    setCreating(true); setCreateError('')
    try {
      const response = await StudioDirectingService.directingSceneCanvasCreate({
        projectId, chapterId, sequenceId, requestBody: { name },
      })
      if (!response.data) throw new Error('创建结果未返回，请刷新画布列表后核实')
      setName(undefined)
      openCanvas(response.data.id)
    } catch (cause) {
      setCreateError(directingError(cause))
    } finally { setCreating(false) }
  }
  if (canvasId && scene?.canvases.some(canvas => canvas.id === canvasId)) {
    return <GenerationCanvasWorkspace projectId={projectId} canvasId={canvasId}
      initialCandidate={candidate?.document.id === canvasId ? candidate : undefined}
      back={{ label: '返回场次准备', onClick: returnToPreparation }}
      renderCanvasManagement={({ nameEditor }) => <span className="scene-canvas-name-editor">{nameEditor}</span>} />
  }

  return <WorkbenchTheme>
    <WorkspaceLayout className="workbench-ui scene-canvas-preparation" aria-label="场次准备">
      <PageToolbar title={scene?.sequence.title || '场次准备'}>
        <Space wrap>
          <Button variant="quiet" onClick={chapter}>返回章节</Button>
          {canvasId && <Button onClick={returnToPreparation}>返回场次准备</Button>}
        </Space>
      </PageToolbar>
      <WorkspaceScrollPanel>
        <div className="scene-canvas-preparation-content">
          {loadError ? <Alert type="error" showIcon message={loadError}
            action={<Button onClick={() => setRefresh(value => value + 1)}>重试</Button>} /> : loading
            ? <Spin aria-label="正在读取场次准备" /> : canvasId
            ? <Alert type="error" showIcon message="此画布不属于当前场次或已不可用" />
            : scene && <>
              <section aria-labelledby="scene-canvas-source-title">
                <h2 id="scene-canvas-source-title">场次原文</h2>
                {scene.sequence.source_changed && <Alert type="warning" showIcon message="章节原文已变化，场次仍保留已确认的摘录。" />}
                <CanvasTextPreview label="场次原文" text={scene.sequence.source_text} lines={4} />
              </section>
              <SceneObjectPreparation {...{ projectId, chapterId, sequenceId }}
                editable={!!scene.sequence.is_current && !!scene.sequence.source_text.trim()} />
              <section aria-labelledby="scene-canvas-list-title">
                <div className="scene-canvas-list-header">
                  <h2 id="scene-canvas-list-title">本场画布</h2>
                  <Space wrap>
                    <Button disabled={!scene.sequence.is_current || !scene.sequence.source_text.trim()}
                      onClick={() => { setCreateError(''); setName(defaultCanvasName()) }}>新建空白画布</Button>
                    <SceneStoryboardPreparation scope={{ projectId, chapterId, sequenceId }} nameForNewCanvas={defaultCanvasName}
                      editable={!!scene.sequence.is_current && !!scene.sequence.source_text.trim()} onCompleted={result => {
                        setCandidate(result.candidate || undefined)
                        openCanvas(result.canvas_id)
                      }} />
                  </Space>
                </div>
                {scene.canvases.length ? <ul className="scene-canvas-list">
                  {scene.canvases.map(canvas => <li key={canvas.id} className={selected === canvas.id ? 'scene-canvas-selected' : undefined}>
                    <Button variant="quiet" onClick={() => openCanvas(canvas.id)}>{canvas.name}</Button>
                    {selected === canvas.id && <small>上次打开</small>}
                    {canvas.source_changed && <small>原文已变化</small>}
                  </li>)}
                </ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本场尚无画布" />}
              </section>
            </>}
        </div>
      </WorkspaceScrollPanel>
      <WorkbenchModal title="新建空白画布" open={name !== undefined} width={480}
        closable={!creating} keyboard={!creating} maskClosable={!creating} onCancel={() => { if (!creating) setName(undefined) }}
        footer={<WorkbenchDialogActions secondary={<Button variant="quiet" disabled={creating} onClick={() => setName(undefined)}>取消</Button>}>
          <Button variant="primary" loading={creating} onClick={() => void create()}>创建画布</Button>
        </WorkbenchDialogActions>}>
        {createError && <Alert type="error" showIcon message={createError} />}
        <label htmlFor="scene-canvas-create-name">画布名称</label>
        <Input id="scene-canvas-create-name" value={name ?? ''} maxLength={255} disabled={creating}
          onChange={event => setName(event.target.value)} onPressEnter={() => void create()} />
      </WorkbenchModal>
    </WorkspaceLayout>
  </WorkbenchTheme>
}

export function SceneCanvasWorkbench() {
  const { projectId, chapterId, sequenceId } = useParams()
  return projectId && chapterId && sequenceId
    ? <SceneCanvasHost key={JSON.stringify([projectId, chapterId, sequenceId])} {...{ projectId, chapterId, sequenceId }} />
    : null
}
