import { useEffect, useRef, useState } from 'react'
import { Alert, Empty, Input, Popconfirm, Select, Space } from 'antd'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasRead, TextContentCard, ImageContentCard, VideoContentCard } from '../../../services/generated'
import { useGenerationCanvasEditor } from './useGenerationCanvasEditor'
import { GenerationCanvasGraph } from './GenerationCanvasGraph'
import { useGenerationCanvasRuntime } from './useGenerationCanvasRuntime'
import { RunPreview } from './RunPreview'
import { RunHistory } from './RunHistory'
import { WorkbenchTheme } from '../directing/ui/WorkbenchTheme'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import { WorkbenchDetailsProvider } from '../directing/ui/WorkbenchDetails'
import { WorkbenchModal } from '../directing/ui/WorkbenchModal'
import { useGraphBrowse } from '../directing/useGraphBrowse'
import { CanvasToolbarMenu } from '../directing/CanvasToolbarMenu'
import { WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { ArrowLeftOutlined, ArrowRightOutlined, DownOutlined, SaveOutlined, MoreOutlined, UndoOutlined, RedoOutlined } from '@ant-design/icons'
import '../directing/canvasWorkbench.css'
import { TaskCenter } from '../components/TaskCenter'
import './generationCanvas.css'

type InspectTarget = { cardId: string; serial: number; segmentId?: string }

/** 浏览仅限同一画布的真实位置，不使用业务内容撤销记录。 */
function CanvasHistoryControls({ storageKey, requestLeave }: { storageKey: string; requestLeave: () => Promise<boolean> }) {
  const { canBrowse } = useGraphBrowse(storageKey)
  const navigate = useNavigate()
  const browse = async (offset: -1 | 1) => { if (canBrowse(offset) && await requestLeave()) navigate(offset) }
  return <nav className="canvas-browse-history" aria-label="画布浏览历史">
    <WorkbenchIconButton label="后退" variant="quiet" icon={<ArrowLeftOutlined />} disabled={!canBrowse(-1)} onClick={() => void browse(-1)} />
    <WorkbenchIconButton label="前进" variant="quiet" icon={<ArrowRightOutlined />} disabled={!canBrowse(1)} onClick={() => void browse(1)} />
  </nav>
}

/** 项目级文档编辑；运行、结果和浏览器布局有独立生命周期。 */
export function GenerationCanvasPage({ projectId }: { projectId: string }) {
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()
  const [primaryHost, setPrimaryHost] = useState<HTMLDivElement | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [inspectTarget, setInspectTarget] = useState<InspectTarget>()
  const pendingInspect = useRef<InspectTarget>()
  const canvasId = search.get('canvas')
  const [canvases, setCanvases] = useState<CanvasRead[]>([])
  const editor = useGenerationCanvasEditor(projectId, canvasId)
  const { current, document, edit, save, saving, dirty, ownership } = editor
  const runtime = useGenerationCanvasRuntime(projectId, canvasId, save, ownership.canEdit, current?.revision)
  useEffect(() => { if (runtime.preview) setPreviewOpen(true) }, [runtime.preview])
  const change: typeof edit = next => { runtime.invalidate(); edit(next) }
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deletePending, setDeletePending] = useState<string>()
  const scope = `${projectId}:${canvasId}`, latestScope = useRef(scope); latestScope.current = scope
  const retainedCopies = useRef(new Map<string, TextContentCard | ImageContentCard | VideoContentCard>())

  const fail = (reason: unknown) => {
    const detail = reason instanceof ApiError ? reason.body?.data : undefined
    setError(detail?.code ? `${detail.code}: ${detail.message}` : reason instanceof ApiError ? reason.body?.message || '操作失败，请重试' : '操作失败，请重试')
  }
  const refreshList = () => Canvases.canvasList({ projectId }).then(response => setCanvases(response.data || []))
  const select = (id?: string) => setSearch(previous => {
    const next = new URLSearchParams(previous)
    next.delete('run'); next.delete('node')
    if (id) next.set('canvas', id)
    else next.delete('canvas')
    return next
  })
  useEffect(() => {
    let active = true
    Canvases.canvasList({ projectId }).then(response => { if (active) setCanvases(response.data || []) }).catch(fail)
    return () => { active = false }
  }, [projectId])
  const create = async () => {
    if (!await editor.requestLeave()) return
    try {
      const response = await Canvases.canvasCreate({ projectId, requestBody: { name: '未命名画布' } })
      await refreshList()
      if (response.data) select(response.data.id)
    } catch (reason) { fail(reason) }
  }
  useEffect(() => { if (current) setCanvases(previous => previous.map(item => item.id === current.id ? current : item)) }, [current])
  const remove = async () => {
    if (!current || runtime.busyCards.size || !ownership.canEdit() || !await editor.requestLeave()) return
    setDeleting(true); setError('')
    try {
      await Canvases.canvasDelete({ projectId, canvasId: current.id })
      select(); await refreshList().catch(fail)
    } catch (reason) {
      if (reason instanceof ApiError && reason.status < 500) fail(reason)
      else { setDeletePending(current.id); setError('删除结果未确认，请核实画布状态后重试') }
    } finally { setDeleting(false) }
  }
  const verifyDeletion = async () => {
    if (!deletePending) return
    setDeleting(true)
    try {
      await Canvases.canvasGet({ projectId, canvasId: deletePending })
      setDeletePending(undefined); setError('画布仍存在；删除尚未完成，可重试')
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) {
        setDeletePending(undefined); setError(''); select(); await refreshList().catch(fail)
      } else setError('画布状态核实失败，删除结果仍未确认，请重试核实')
    } finally { setDeleting(false) }
  }

  const saveOutput = async (node: { id: string; run_id: string }, position: number) => {
    if (!canvasId || !ownership.canEdit() || editor.recovery || editor.conflict) return false
    const targetScope = scope, key = `${scope}:${node.id}:${position}`
    let card = retainedCopies.current.get(key)
    if (!card) {
      const response = await Canvases.canvasOutputContent({ projectId, canvasId, runId: node.run_id, nodeId: node.id, position })
      if (!response.data) throw new Error('missing content receipt')
      card = response.data; retainedCopies.current.set(key, card)
    }
    if (latestScope.current !== targetScope || !ownership.canEdit()) return false
    const copy = card
    // Functional insertion preserves edits made while the historical DTO loads.
    // Failed saves keep this same card identity for an explicit retry.
    change(previous => ({ ...previous, cards: previous.cards?.some(item => item.id === copy.id) ? previous.cards : [...(previous.cards || []), copy] }))
    const saved = await save()
    if (saved) retainedCopies.current.delete(key)
    return saved
  }

  return <WorkbenchTheme><WorkbenchDetailsProvider><section className="canvas-workbench generation-workbench" aria-label="生成画布工作台">
    <header className="canvas-workbench-toolbar generation-workbench-header">
      <div className="canvas-toolbar-identity">
        <WorkbenchIconButton label="返回项目" variant="quiet" icon={<ArrowLeftOutlined />} onClick={async () => { if (await editor.requestLeave()) navigate(`/projects/${encodeURIComponent(projectId)}`) }} />
        <strong className="canvas-sequence-name">{document?.name || '画布生成'}</strong>
        <CanvasToolbarMenu label="画布管理" caption={<span className="canvas-menu-caption">画布<DownOutlined className="canvas-menu-chevron" /></span>}>
          <Select aria-label="选择画布" placeholder="选择画布" value={canvasId || undefined}
            disabled={saving || deleting || !!deletePending} options={canvases.map(item => ({ value: item.id, label: item.document.name }))} onChange={async id => { if (await editor.requestLeave()) select(id) }} />
          <Button data-menu-close onClick={create} disabled={saving || deleting || !!deletePending}>新建画布</Button>
          {document && <Input aria-label="画布名称" value={document.name} maxLength={255} disabled={!ownership.editable || !!editor.recovery}
            onChange={event => change({ ...document, name: event.target.value })} />}
          {current && <Popconfirm title="删除画布及其运行历史？文件的其他使用关系会保留。" onConfirm={remove}><Button variant="danger" loading={deleting} disabled={saving || !!deletePending || !ownership.editable || !!runtime.busyCards.size}>删除画布</Button></Popconfirm>}
        </CanvasToolbarMenu>
        <span role="status" aria-label="画布保存状态">{saving ? '保存中' : editor.conflict ? '修订冲突' : !ownership.editable && canvasId ? '只读' : dirty ? '待保存' : current ? '已保存' : '尚无画布'}</span>
        {current && <WorkbenchIconButton label="保存画布" variant={dirty ? 'primary' : 'quiet'} icon={<SaveOutlined />} onClick={() => void save()} loading={saving} disabled={!ownership.editable || !!editor.recovery || editor.conflict} />}
        <div className="generation-browse-history-host">{canvasId && <CanvasHistoryControls key={scope} storageKey={`generation-canvas:${scope}`} requestLeave={editor.requestLeave} />}</div>
      </div>
      <div className="generation-toolbar-center" />
      <div className="canvas-toolbar-actions">
        <div ref={setPrimaryHost} className="generation-primary-host" />
        {document && <RunHistory key={document.id} runs={runtime.snapshot.runs} targetRun={search.get('run')} targetNode={search.get('node')}
          disabled={!ownership.editable || !!editor.recovery || editor.conflict} onSave={saveOutput} onCancel={runtime.cancel} cancelling={runtime.cancelling} />}
        <TaskCenter workbench />
        <CanvasToolbarMenu label="更多操作" icon={<MoreOutlined />}>
          <span role="status" aria-label="运行连接">{runtime.connection === 'connected' ? '运行事件已连接' : runtime.connection === 'connecting' ? '正在连接运行事件' : '运行连接恢复中，保留已接收内容'}</span>
        </CanvasToolbarMenu>
      </div>
    </header>
    <div className="generation-feedback">
    {(error || editor.error) && <Alert type="error" showIcon message={error || editor.error} action={deletePending === canvasId ? <Button loading={deleting} onClick={() => void verifyDeletion()}>核实画布状态</Button> : undefined} />}
    {editor.storageError && <Alert type="warning" message={editor.storageError} />}
    {canvasId && !ownership.editable && <Alert type="warning" message={ownership.message || (ownership.state === 'unsupported' ? '浏览器不支持编辑所有权保护，当前只读' : '此画布当前只读')} action={<Space><Button onClick={ownership.takeEditing}>取得编辑权</Button>{ownership.state === 'choice' && <><Button onClick={() => ownership.chooseHandoff('save')}>保存后交接</Button><Button onClick={() => ownership.chooseHandoff('discard')}>放弃后交接</Button></>}</Space>} />}

      {runtime.error && <Alert type="error" message={runtime.error} />}
      {runtime.pending && <Alert type="warning" message="运行请求结果待核实；将使用原请求身份取得回执" action={<Button loading={runtime.submitting} disabled={!ownership.editable} onClick={() => void runtime.submit()}>核实运行请求</Button>} />}
    </div>
      <WorkbenchModal title="核对画布内容" open={!!editor.recovery || editor.conflict} closable={false} footer={null}>
    {editor.recovery && <Alert type="warning" message="发现本地未保存内容；恢复前将核实服务器及未明请求" action={<Space><Button onClick={editor.restore} disabled={!ownership.editable || saving}>恢复本地内容</Button><Button onClick={() => editor.reload()} disabled={!ownership.editable || saving}>使用服务器内容</Button></Space>} />}
    {editor.conflict && <Alert type="warning" message="修订冲突，本地内容已保留。核对后选择处理方式" action={<Space><Button onClick={() => editor.reload(true)}>保留本地并以最新修订保存</Button><Button onClick={() => editor.reload()}>使用服务器内容</Button></Space>} />}
      </WorkbenchModal>
      <WorkbenchModal zIndex={1200} title="运行预检" afterClose={() => {
        // 预检操作容器解除底层 inert 后，再由详情定位真实编辑片段。
        if (pendingInspect.current) { setInspectTarget(pendingInspect.current); pendingInspect.current = undefined }
      }} open={previewOpen && !!runtime.preview && !editor.recovery && !editor.conflict} onCancel={() => setPreviewOpen(false)} footer={null}>
        {runtime.preview && <RunPreview preview={runtime.preview} submitting={runtime.submitting} disabled={!ownership.editable || !!runtime.pending || runtime.busyCards.has(runtime.preview.card_id)} onSubmit={() => void runtime.submit()} onLocate={target => { pendingInspect.current = { cardId: String(target.card_id || runtime.preview!.card_id), segmentId: target.segment_id || target.reference_id ? String(target.segment_id || target.reference_id) : undefined, serial: Date.now() }; setPreviewOpen(false) }} />}
      </WorkbenchModal>
    {!document || !current ? <Empty className="generation-empty" description="创建或选择一张画布" /> : <div className="generation-stage">
      <GenerationCanvasGraph contentHistory={<div className="canvas-history-controls" aria-label="画布内容历史">
        <WorkbenchIconButton label="撤销内容" variant="quiet" icon={<UndoOutlined />} disabled={!ownership.editable || !!editor.recovery || !editor.canUndo} onClick={() => { runtime.invalidate(); editor.undo() }} />
        <WorkbenchIconButton label="重做内容" variant="quiet" icon={<RedoOutlined />} disabled={!ownership.editable || !!editor.recovery || !editor.canRedo} onClick={() => { runtime.invalidate(); editor.redo() }} />
      </div>} primaryHost={primaryHost} savedDocument={current.document} savedRevision={current.revision} key={document.id} document={document} onChange={next => change(next)} inspectTarget={inspectTarget} editingStatus={editor.conflict ? '修订冲突，请关闭详情处理' : saving ? '正在保存修改' : dirty ? '修改尚未保存' : '修改已同步'} readonly={!ownership.editable || !!editor.recovery}
        runtime={{ outputs: runtime.snapshot.current_outputs, nodes: runtime.latestNodes, busyCards: runtime.busyCards, checking: runtime.checking,
          disabled: runtime.storageBlocked || !!runtime.pending || !!runtime.checking || runtime.submitting || editor.conflict, precheck: cardId => void runtime.precheck(cardId) }} />
    </div>}
  </section></WorkbenchDetailsProvider></WorkbenchTheme>
}
