import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Empty, Modal, message, Pagination, Tag } from 'antd'
import { ArrowRightOutlined, MoreOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons'
import { useParams, useSearchParams } from 'react-router-dom'
import { useProjectCharacters } from '../hooks/useProjectData'
import { resolveAssetUrl } from '../../../assets/utils'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { ResourcePublishButton } from '../../../assets/components/ResourcePublishButton'
import { ResourceEditorDrawer } from '../../../assets/components/ResourceEditorDrawer'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import { useProjectAssetDetail } from '../useProjectAssetDetail'
import { ProjectContentToolbar } from '../ProjectContentToolbar'
import { directingError } from '../../../directing/common'
import './project-roles.css'

type CreateSeed = { name?: string; description?: string; visual_style?: '现实' | '动漫'; style?: string }

export function RolesTab() {
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { characters, loading, refresh } = useProjectCharacters(projectId)
  const [createOpen, setCreateOpen] = useState(false)
  const [createSeed, setCreateSeed] = useState<CreateSeed>()
  const [menuRoleId, setMenuRoleId] = useState<string>()
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string }>()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deletePending = useRef(false)
  const deleteTrigger = useRef<HTMLElement | null>(null)
  const createTrigger = useRef<HTMLButtonElement>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const pagedRoleCards = useMemo(() => characters.slice((page - 1) * pageSize, page * pageSize).map(c => ({ c })), [characters, page, pageSize])
  useEffect(() => { setPage(1) }, [characters.length])
  useEffect(() => {
    if (searchParams.get('create') !== '1' || searchParams.get('tab') !== 'roles') return
    const visual = searchParams.get('visualStyle')
    setCreateSeed({ name: searchParams.get('name') ?? '', description: searchParams.get('desc') ?? '',
      visual_style: visual === '现实' || visual === '动漫' ? visual : undefined, style: searchParams.get('style') ?? undefined })
    setCreateOpen(true)
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      for (const key of ['create', 'name', 'desc', 'visualStyle', 'style']) next.delete(key)
      return next
    }, { replace: true })
  }, [searchParams, setSearchParams])
  async function deleteRole() {
    if (!deleteTarget || deletePending.current) return
    deletePending.current = true; setDeleting(true); setDeleteError('')
    try {
      await StudioEntitiesApi.remove('character', deleteTarget.id)
      message.success('已删除'); setDeleteTarget(undefined); await refresh()
    } catch (cause) { setDeleteError(directingError(cause)) }
    finally { deletePending.current = false; setDeleting(false) }
  }
  const { openDetail, detailView } = useProjectAssetDetail('character', refresh)
  if (detailView) return detailView
  if (!projectId) return null

  return (
    <div className="project-resource-page project-role-page">
      <ProjectContentToolbar>
        <h1 className="app-page-title">项目角色</h1>
        <Button ref={createTrigger} aria-label="新建角色" type="primary" icon={<PlusOutlined />} onClick={() => { setCreateSeed(undefined); setCreateOpen(true) }}>新建角色</Button>
      </ProjectContentToolbar>
        {characters.length === 0 && !loading ? (
          <Empty description="暂无项目角色" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="space-y-3">
            <div className="project-resource-grid">
            {pagedRoleCards.map(({ c }) => (
              <DisplayImageCard
                variant="project"
                imageFit="contain"
                key={c.id}
                title={<button type="button" data-project-asset-id={c.id} className="project-resource-name" title={c.name} onClick={() => openDetail(c.id)}><span>{c.name}</span><ArrowRightOutlined aria-hidden /></button>}
                imageUrl={resolveAssetUrl(c.thumbnail)}
                imageAlt={c.name}
                enablePreview
                placeholder={<><UserOutlined aria-hidden />暂无封面</>}
                extra={<Dropdown trigger={['click']} open={menuRoleId === c.id}
                  onOpenChange={open => {
                    setMenuRoleId(open ? c.id : undefined)
                    if (open) deleteTrigger.current = document.activeElement as HTMLElement
                  }} menu={{ items: [
                    { key: 'edit', label: '编辑', onClick: () => {
                      setMenuRoleId(undefined)
                      openDetail(c.id)
                    } },
                    { key: 'delete', label: '删除角色', danger: true, disabled: deleting, onClick: () => {
                      setMenuRoleId(undefined)
                      setDeleteError('')
                      requestAnimationFrame(() => setDeleteTarget({ id: c.id, name: c.name }))
                    } },
                  ] }}><Button type="text" icon={<MoreOutlined />} aria-label={`${c.name}更多操作`} /></Dropdown>}
                meta={<><Tag>项目专属</Tag><ResourcePublishButton kind="character" asset={c} projectId={projectId} onSaved={refresh} />
                  <div className="project-resource-description">{c.description?.trim() || '未填写简介'}</div>
                </>}
              />
            ))}
            </div>
            <div className="flex justify-end">
              <Pagination
                current={page}
                pageSize={pageSize}
                total={characters.length}
                showSizeChanger={false}
                showTotal={(t) => `共 ${t} 条`}
                onChange={(p, ps) => {
                  setPage(p)
                  setPageSize(ps)
                }}
              />
            </div>
          </div>
        )}

      <Modal className="project-resource-dialog" title={deleteTarget ? `删除角色「${deleteTarget.name}」？` : '删除角色'} open={!!deleteTarget}
        onCancel={() => { if (!deletePending.current) setDeleteTarget(undefined) }}
        onOk={() => void deleteRole()} okText="删除角色" cancelText="取消" confirmLoading={deleting}
        okButtonProps={{ danger: true, disabled: deleting }} cancelButtonProps={{ disabled: deleting }}
        closable={!deleting} keyboard={!deleting} maskClosable={!deleting} focusTriggerAfterClose={false}
        afterClose={() => (deleteTrigger.current?.isConnected ? deleteTrigger.current : createTrigger.current)?.focus({ preventScroll: true })}>
        <p>删除角色将移除该项目角色配置，不会删除曾作为参考的资产。</p>
        {deleteError && <Alert type="error" showIcon message={deleteError} />}
      </Modal>
      <ResourceEditorDrawer open={createOpen} kind="character" projectId={projectId} seed={createSeed}
        onClose={() => { setCreateOpen(false); setCreateSeed(undefined) }} onSaved={async () => { await refresh() }} />
    </div>
  )
}
