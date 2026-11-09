import { useCallback, useEffect, useRef, useState } from 'react'
import { Select } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DownOutlined, PictureOutlined } from '@ant-design/icons'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasRead } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { CanvasToolbarMenu } from '../directing/CanvasToolbarMenu'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import { GenerationCanvasWorkspace } from './GenerationCanvasWorkspace'
import { CanvasDeletionDialog } from './CanvasDeletionDialog'

/** 项目入口管理画布列表和路由，画布工作区管理当前文档及运行。 */
export function GenerationCanvasPage({ projectId }: { projectId: string }) {
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()
  const canvasId = search.get('canvas')
  const [canvases, setCanvases] = useState<CanvasRead[]>([])
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string>()
  const listRead = useRef(0)
  const deleting = !!deleteTarget && deleteTarget === canvasId

  const fail = (reason: unknown) => {
    const detail = reason instanceof ApiError ? reason.body?.data : undefined
    setError(detail?.code ? `${detail.code}: ${detail.message}` : reason instanceof ApiError ? reason.body?.message || '操作失败，请重试' : '操作失败，请重试')
  }
  const refreshList = useCallback(async () => {
    const read = ++listRead.current
    const response = await Canvases.canvasList({ projectId })
    if (read === listRead.current) setCanvases(response.data || [])
  }, [projectId])
  const select = (id?: string) => setSearch(previous => {
    const next = new URLSearchParams(previous)
    next.delete('run'); next.delete('node'); next.delete('check'); next.delete('report'); next.delete('storyboardTask')
    if (id) next.set('canvas', id)
    else next.delete('canvas')
    return next
  })
  const closeRunHistory = () => {
    if (!search.has('run') && !search.has('node')) return
    // 关闭即撤销本次历史定位意图，替换当前地址，避免刷新重开或新增无效回退步骤。
    setSearch(previous => {
      const next = new URLSearchParams(previous)
      next.delete('run'); next.delete('node')
      return next
    }, { replace: true })
  }
  useEffect(() => {
    const requests = listRead
    const load = () => { void refreshList().catch(fail) }
    load()
    window.addEventListener('focus', load)
    return () => { requests.current++; window.removeEventListener('focus', load) }
  }, [refreshList])
  const create = async (requestLeave: () => Promise<boolean>) => {
    if (!await requestLeave()) return
    try {
      const response = await Canvases.canvasCreate({ projectId, requestBody: { name: '未命名画布' } })
      await refreshList()
      if (response.data) select(response.data.id)
    } catch (reason) { fail(reason) }
  }
  const rememberCanvas = useCallback((current: CanvasRead) => {
    setCanvases(previous => previous.map(item => item.id === current.id ? current : item))
  }, [])
  const beginDelete = async (id: string, canEdit: () => boolean, requestLeave: () => Promise<boolean>) => {
    if (canEdit() && await requestLeave() && canEdit()) {
      setError('')
      setDeleteTarget(id)
    }
  }
  return <GenerationCanvasWorkspace projectId={projectId} canvasId={canvasId} storyboardTaskId={search.get('storyboardTask')}
    back={{ label: '返回项目', onClick: () => navigate(`/projects/${encodeURIComponent(projectId)}`) }}
    onCanvasRead={rememberCanvas}
    hostError={error}
    targetRun={search.get('run')} targetNode={search.get('node')}
    targetCheck={search.get('check')} targetReport={search.get('report')} onCloseRunHistory={closeRunHistory}
    renderCanvasManagement={({ current, saving, editable, running, canEdit, requestLeave, nameEditor }) => <>
      <CanvasToolbarMenu label="画布管理" caption={<span className="canvas-menu-caption">画布<DownOutlined className="canvas-menu-chevron" /></span>}>
        <Select aria-label="选择画布" placeholder="选择画布" value={canvasId || undefined}
          disabled={saving || deleting} options={canvases.map(item => ({ value: item.id, label: <span className="generation-canvas-option">{item.document.cover_file_id && <span className="generation-canvas-cover"><PictureOutlined aria-hidden /><img alt="画布封面" src={buildFileDownloadUrl(item.document.cover_file_id)} onError={event=>{event.currentTarget.style.visibility='hidden'}} /></span>}{item.document.name}</span> }))} onChange={async id => { if (await requestLeave()) select(id) }} />
        <Button data-menu-close onClick={() => void create(requestLeave)} disabled={saving || deleting}>新建画布</Button>
        {nameEditor}
        {current && <Button variant="danger" data-menu-close disabled={saving || deleting || !editable || running}
          onClick={() => void beginDelete(current.id, canEdit, requestLeave)}>删除画布</Button>}
        {current && running && <small>任务结束后可删除</small>}
      </CanvasToolbarMenu>
      {deleting && <CanvasDeletionDialog key={deleteTarget} projectId={projectId} canvasId={deleteTarget} workbench
        blockedReason={running ? '画布仍有活动运行，任务结束后可删除' : !editable ? '当前页面没有画布编辑权' : undefined}
        canDelete={async () => !running && canEdit() && await requestLeave() && canEdit()}
        onClose={() => setDeleteTarget(undefined)} onFailure={setError}
        onDeleted={() => {
          setCanvases(previous => previous.filter(item => item.id !== deleteTarget))
          select()
          void refreshList().catch(fail)
        }} />}
    </>} />
}
