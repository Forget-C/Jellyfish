import { directingError } from '../../../directing/common'
import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Empty, Image, Input, Modal, Space, Tag, message, Pagination } from 'antd'
import { ArrowRightOutlined, MoreOutlined, LinkOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import { StudioProjectAssetsService } from '../../../../../services/generated'
import type { ProjectActorLinkRead } from '../../../../../services/generated'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import { useProjectCharacters } from '../hooks/useProjectData'
import { resolveAssetUrl } from '../../../assets/utils'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { ResourcePublishButton } from '../../../assets/components/ResourcePublishButton'
import { resourceAssetUrl } from '../../../assets/components/ResourceEditorDrawer'
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
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [linkedActors, setLinkedActors] = useState<Record<string, ActorLike>>({})
  const [actors, setActors] = useState<ActorLike[]>([])
  const [actorsLoading, setActorsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null)
  const [links, setLinks] = useState<ProjectActorLinkRead[]>([])
  const [linksLoading, setLinksLoading] = useState(false)

  const linkedActorIdSet = useMemo(
    () => new Set(links.map((l) => l.actor_id).filter(Boolean) as string[]),
    [links],
  )

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

  const loadActors = async (searchQuery?: string) => {
    setActorsLoading(true)
    try {
      const q = searchQuery !== undefined ? searchQuery : search
      const res = await StudioEntitiesApi.list('actor', {
        page: 1,
        pageSize: 100,
        q: q?.trim() || undefined,
        order: 'updated_at',
        isDesc: true,
      })
      setActors((res.data?.items ?? []) as ActorLike[])
    } catch {
      message.error('加载演员失败')
      setActors([])
    } finally {
      setActorsLoading(false)
    }
  }

  useEffect(() => {
    if (linkModalOpen) void loadActors('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkModalOpen])

  useEffect(() => {
    void loadLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const handleLinkActor = async (actor: ActorLike) => {
    if (!projectId || linkingId) return
    setLinkingId(actor.id)
    try {
      await StudioProjectAssetsService.createProjectActorLinkApiV1StudioProjectAssetsActorPost({
        requestBody: {
          project_id: projectId,
          chapter_id: null,

          asset_id: actor.id,
        },
      })
      message.success(`已关联演员「${actor.name}」到项目`)
      setLinkModalOpen(false)
      await loadLinks()
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'body' in e && typeof (e as { body?: { detail?: string } }).body?.detail === 'string'
          ? (e as { body: { detail: string } }).body.detail
          : '关联失败'
      message.error(msg)
    } finally {
      setLinkingId(null)
    }
  }

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

  const availableActors = useMemo(
    () => actors.filter((a) => !linkedActorIdSet.has(a.id)),
    [actors, linkedActorIdSet],
  )

  const { openDetail, detailView } = useProjectAssetDetail('actor', async () => { await loadLinks(); await loadActors('') })
  if (detailView) return detailView

  if (!projectId) return null

  return (
    <div className="project-resource-page">
      <ProjectContentToolbar>
        <h1 className="app-page-title">项目演员</h1>
        <Space wrap>
          <Button type="primary" icon={<LinkOutlined />} onClick={() => { setSearch(''); setLinkModalOpen(true) }}>从资产库关联</Button>
          <Button icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>新建</Button>
          <Button type="link" onClick={() => navigate('/assets')}>查看资产库</Button>
        </Space>
      </ProjectContentToolbar>
        {links.length === 0 && !linksLoading ? (
          <Empty description="暂无项目演员，可从资产库关联演员到本项目" image={Empty.PRESENTED_IMAGE_SIMPLE} />
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
                  meta={<><Tag>{a?.source_character_id ? '从角色转化 · 只读' : a?.project_id ? '项目专属' : '共享资产'}</Tag>
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

      <Modal
        className="project-resource-dialog"
        title="从资产库关联演员"
        open={linkModalOpen}
        onCancel={() => { if (!linkingId) setLinkModalOpen(false) }}
        closable={!linkingId} keyboard={!linkingId} maskClosable={!linkingId}
        footer={null}
        width={560}
      >
        <div className="mb-3">
          <Input.Search
            placeholder="搜索演员名称"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(value) => loadActors(value)}
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {actorsLoading ? (
            <div className="py-8 text-center text-gray-500">加载中...</div>
          ) : availableActors.length === 0 ? (
            <Empty description={actors.length === 0 ? '暂无演员，请先在资产管理中创建演员' : '当前项目已关联全部搜索结果'} />
          ) : (
            <div className="space-y-2">
              {availableActors.map((actor) => (
                <div
                  key={actor.id}
                  className="flex items-center justify-between gap-3 rounded border border-gray-200 p-2 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {resolveAssetUrl(actor.thumbnail) ? (
                      <Image
                        src={resolveAssetUrl(actor.thumbnail)}
                        alt=""
                        width={40}
                        height={40}
                        style={{ objectFit: 'cover', borderRadius: 4 }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">
                        <UserOutlined />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-medium truncate">{actor.name}</div>
                      {actor.description && <div className="text-xs text-gray-500 truncate">{actor.description}</div>}
                    </div>
                  </div>
                  <Button
                    type="primary"
                    size="small"
                    disabled={!!linkingId}
                    loading={linkingId === actor.id}
                    onClick={() => handleLinkActor(actor)}
                  >
                    关联到项目
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
