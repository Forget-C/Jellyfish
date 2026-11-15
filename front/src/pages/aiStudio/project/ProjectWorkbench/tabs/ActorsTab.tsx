import { directingError } from '../../../directing/common'
import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Empty, Modal, Space, Tag, message, Pagination } from 'antd'
import { ArrowRightOutlined, MoreOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import { StudioProjectAssetsService } from '../../../../../services/generated'
import type { ProjectActorLinkRead } from '../../../../../services/generated'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import { useProjectCharacters } from '../hooks/useProjectData'
import { resolveAssetUrl } from '../../../assets/utils'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { ResourcePublishButton } from '../../../assets/components/ResourcePublishButton'
import { resourceAssetUrl } from '../../../assets/components/ResourceEditorDrawer'
import { ResourceCreateButton } from '../../../assets/components/ResourceCreateButton'
import { ResourceEditorDrawer } from '../../../assets/components/ResourceEditorDrawer'
import { useProjectAssetDetail } from '../useProjectAssetDetail'
import { ProjectContentToolbar } from '../ProjectContentToolbar'

type ActorLike = {
  project_id?: string | null
  library_copy_id?: string | null
  source_character_id?: string | null
  id: string
  name: string
  description?: string | null
  thumbnail?: string
}

export function ActorsTab() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  useProjectCharacters(projectId)

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [linkedActors, setLinkedActors] = useState<Record<string, ActorLike>>({})
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null)
  const [links, setLinks] = useState<ProjectActorLinkRead[]>([])
  const [linksLoading, setLinksLoading] = useState(false)


  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const pagedLinks = useMemo(() => {
    const start = (page - 1) * pageSize
    return links.slice(start, start + pageSize)
  }, [links, page, pageSize])

  useEffect(() => {
    setPage(1)
  }, [links.length])

  const loadLinks = async () => {
    if (!projectId) return
    setLinksLoading(true)
    try {
      const res = await StudioProjectAssetsService.listProjectEntityLinksApiV1StudioProjectAssetsEntityTypeGet({
        entityType: 'actor',
        projectId,
        chapterId: null,

        assetId: null,
        order: null,
        isDesc: false,
        page: 1,
        pageSize: 100,
      })
      const items = (res.data?.items ?? []) as ProjectActorLinkRead[]
      setLinks(items)
      const details = await Promise.all([...new Set(items.map(item => item.actor_id))].map(id =>
        StudioEntitiesApi.get('actor', id).then(response => response.data as ActorLike).catch(() => undefined)))
      setLinkedActors(previous => Object.fromEntries(items.map(item => [item.actor_id, details.find(actor => actor?.id === item.actor_id) ?? previous[item.actor_id]]).filter(([, value]) => value)))
    } catch {
      message.error('加载项目演员关联失败')
      setLinks([])
    } finally {
      setLinksLoading(false)
    }
  }



  useEffect(() => {
    void loadLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])


  const handleUnlinkActor = async (link: ProjectActorLinkRead) => {
    setUnlinkingId(link.id)
    try {
      await StudioProjectAssetsService.deleteProjectActorLinkApiV1StudioProjectAssetsActorLinkIdDelete({ linkId: link.id })
      message.success('已取消关联')
      await loadLinks()
    } catch {
      message.error('取消关联失败')
      throw new Error('取消关联失败')
    } finally {
      setUnlinkingId(null)
    }
  }

  const linkedByActorId = useMemo(() => new Map(Object.values(linkedActors).map(actor => [actor.id, actor])), [linkedActors])


  const { openDetail, detailView } = useProjectAssetDetail('actor', loadLinks)
  if (detailView) return detailView

  if (!projectId) return null

  return (
    <div className="project-resource-page">
      <ProjectContentToolbar>
        <h1 className="app-page-title">项目演员</h1>
        <Space wrap>
          <ResourceCreateButton kind={'actor'} projectId={projectId} onCreate={() => setCreateModalOpen(true)} onCreated={loadLinks}><Button aria-label="新建" type="primary" icon={<PlusOutlined aria-hidden />}>新建</Button></ResourceCreateButton>
          <Button type="link" onClick={() => navigate('/assets')}>查看资产库</Button>
        </Space>
      </ProjectContentToolbar>
        {links.length === 0 && !linksLoading ? (
          <Empty description="暂无项目演员，可新建或从资产库导入" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="space-y-3">
            <div className="project-resource-grid">
            {pagedLinks.map((l) => {
              const a = linkedByActorId.get(l.actor_id)
              return (
                <DisplayImageCard
                  variant="project"
                  key={l.id}
                  title={<button type="button" data-project-asset-id={l.actor_id} className="project-resource-name" title={a?.name ?? '演员信息暂不可用'} onClick={() => openDetail(l.actor_id)}><span>{a?.name ?? '演员信息暂不可用'}</span><ArrowRightOutlined aria-hidden /></button>}
                  imageUrl={resolveAssetUrl(a?.thumbnail)}
                  imageAlt={a?.name ?? '演员信息暂不可用'}
                  placeholder={<><UserOutlined aria-hidden />暂无封面</>}
                  extra={<Dropdown trigger={['click']} menu={{ items: [
                    { key: 'edit', label: a?.source_character_id ? '查看资产' : a?.project_id === null ? '编辑共享资产 ↗' : '编辑', onClick: () => a?.project_id === null ? window.open(resourceAssetUrl('actor', l.actor_id), '_blank', 'noopener,noreferrer') : openDetail(l.actor_id) },
                    { key: 'unlink', label: a?.project_id ? '删除项目对象' : '取消关联', danger: true, disabled: unlinkingId === l.id, onClick: () => {
                      Modal.confirm({
                        className: 'project-resource-dialog',
                        title: `${a?.project_id ? '删除项目对象' : '取消关联'}「${a?.name ?? '此演员'}」？`,
                        content: a?.project_id ? '删除此项目对象及其图片关联，已入库的独立副本继续保留。' : '仅移除项目关联，不删除资产库中的共享对象。',
                        okText: a?.project_id ? '删除项目对象' : '取消关联', cancelText: '取消', okButtonProps: { danger: true },
                        onOk: async () => {
                          if (a?.project_id) {
                            try { await StudioEntitiesApi.remove('actor', l.actor_id); await loadLinks() }
                            catch (cause) { message.error(directingError(cause)); throw cause }
                          }
                          else await handleUnlinkActor(l)
                        },
                      })
                    } },
                  ] }}><Button type="text" icon={<MoreOutlined />} aria-label={`${a?.name ?? '演员'}更多操作`} /></Dropdown>}
                  meta={<><Tag>{a?.source_character_id ? '从角色转化' : a?.project_id ? '项目专属' : '共享资产'}</Tag>
                  {a && <ResourcePublishButton kind="actor" asset={a} projectId={projectId} onSaved={loadLinks} />} <div className="project-resource-description">{a?.description?.trim() || '未填写简介'}</div></>}
                />
              )
            })}
            </div>
            <div className="flex justify-end">
              <Pagination
                current={page}
                pageSize={pageSize}
                total={links.length}
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


      <ResourceEditorDrawer open={createModalOpen} kind="actor" projectId={projectId}
        onClose={() => setCreateModalOpen(false)} onSaved={loadLinks} />

    </div>
  )
}
