import { useCallback, useEffect, useState } from 'react'
import { Popconfirm, Select } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DownOutlined, PictureOutlined } from '@ant-design/icons'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasRead } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { CanvasToolbarMenu } from '../directing/CanvasToolbarMenu'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import { GenerationCanvasWorkspace } from './GenerationCanvasWorkspace'

/** 项目入口管理画布列表和路由，画布工作区管理当前文档及运行。 */
export function GenerationCanvasPage({ projectId }: { projectId: string }) {
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()
  const canvasId = search.get('canvas')
  const [canvases, setCanvases] = useState<CanvasRead[]>([])
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deletePending, setDeletePending] = useState<string>()

  const fail = (reason: unknown) => {
    const detail = reason instanceof ApiError ? reason.body?.data : undefined
    setError(detail?.code ? `${detail.code}: ${detail.message}` : reason instanceof ApiError ? reason.body?.message || '操作失败，请重试' : '操作失败，请重试')
  }
  const refreshList = () => Canvases.canvasList({ projectId }).then(response => setCanvases(response.data || []))
  const select = (id?: string) => setSearch(previous => {
    const next = new URLSearchParams(previous)
    next.delete('run'); next.delete('node'); next.delete('check'); next.delete('report')
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
    let active = true
    Canvases.canvasList({ projectId }).then(response => { if (active) setCanvases(response.data || []) }).catch(fail)
    return () => { active = false }
  }, [projectId])
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
  const remove = async (current: CanvasRead, canEdit: () => boolean, running: boolean, requestLeave: () => Promise<boolean>) => {
    if (running || !canEdit() || !await requestLeave()) return
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
  return <GenerationCanvasWorkspace projectId={projectId} canvasId={canvasId}
    back={{ label: '返回项目', onClick: () => navigate(`/projects/${encodeURIComponent(projectId)}`) }}
    onCanvasRead={rememberCanvas}
    hostError={error}
    hostErrorAction={deletePending === canvasId ? <Button loading={deleting} onClick={() => void verifyDeletion()}>核实画布状态</Button> : undefined}
    targetRun={search.get('run')} targetNode={search.get('node')}
    targetCheck={search.get('check')} targetReport={search.get('report')} onCloseRunHistory={closeRunHistory}
    renderCanvasManagement={({ current, saving, editable, running, canEdit, requestLeave, nameEditor }) => (
      <CanvasToolbarMenu label="画布管理" caption={<span className="canvas-menu-caption">画布<DownOutlined className="canvas-menu-chevron" /></span>}>
        <Select aria-label="选择画布" placeholder="选择画布" value={canvasId || undefined}
          disabled={saving || deleting || !!deletePending} options={canvases.map(item => ({ value: item.id, label: <span className="generation-canvas-option">{item.document.cover_file_id && <span className="generation-canvas-cover"><PictureOutlined aria-hidden /><img alt="画布封面" src={buildFileDownloadUrl(item.document.cover_file_id)} onError={event=>{event.currentTarget.style.visibility='hidden'}} /></span>}{item.document.name}</span> }))} onChange={async id => { if (await requestLeave()) select(id) }} />
        <Button data-menu-close onClick={() => void create(requestLeave)} disabled={saving || deleting || !!deletePending}>新建画布</Button>
        {nameEditor}
        {current && <Popconfirm title="删除画布及其运行历史？文件的其他使用关系会保留。" onConfirm={() => remove(current, canEdit, running, requestLeave)}><Button variant="danger" loading={deleting} disabled={saving || !!deletePending || !editable || running}>删除画布</Button></Popconfirm>}
      </CanvasToolbarMenu>
    )} />
}
