import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, Image, Input, Modal, Space, message, Pagination } from 'antd'
import { EditOutlined, LinkOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import { StudioShotLinksService } from '../../../../../services/generated'
import type { ProjectActorLinkRead } from '../../../../../services/generated'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import { useProjectCharacters } from '../hooks/useProjectData'
import { resolveAssetUrl } from '../../../assets/utils'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { ActorEntityFormModal } from '../../../assets/components/ActorEntityFormModal'
import { encodeWorkbenchAssetEditReturnTo } from '../utils/workbenchAssetReturnTo'
import { showUserError } from '../../../components/userFacingMessage'

type ActorLike = {
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
      const res = await StudioShotLinksService.listProjectEntityLinksApiV1StudioShotLinksEntityTypeGet({
        entityType: 'actor',
        projectId,
        chapterId: null,
        shotId: null,
        assetId: null,
        order: null,
        isDesc: false,
        page: 1,
        pageSize: 100,
      })
      setLinks((res.data?.items ?? []) as ProjectActorLinkRead[])
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
    if (!projectId) return
    setLinkingId(actor.id)
    try {
      await StudioShotLinksService.createProjectActorLinkApiV1StudioShotLinksActorPost({
        requestBody: {
          project_id: projectId,
          chapter_id: null,
          shot_id: null,
          asset_id: actor.id,
        },
      })
      message.success(`已关联演员「${actor.name}」到项目`)
      setLinkModalOpen(false)
      await loadLinks()
    } catch (e: unknown) {
      /**
       * 审计 §4.2 模式 6：这里把后端响应体里的 `detail` 直接 `message.error` 上了主区，
       * 属于第三层内容直渲。统一走 `showUserError`（掩码 → 去术语 → 业务化 → 中文兜底），
       * 主区只出中文结论，原文进默认收起的「技术详情」。
       */
      const detail =
        e && typeof e === 'object' && 'body' in e && typeof (e as { body?: { detail?: string } }).body?.detail === 'string'
          ? (e as { body: { detail: string } }).body.detail
          : ''
      void showUserError(detail, '关联失败：请稍后重试，或展开「技术详情」查看原始信息')
    } finally {
      setLinkingId(null)
    }
  }

  const handleUnlinkActor = async (link: ProjectActorLinkRead) => {
    setUnlinkingId(link.id)
    try {
      await StudioShotLinksService.deleteProjectActorLinkApiV1StudioShotLinksActorLinkIdDelete({ linkId: link.id })
      message.success('已取消关联')
      await loadLinks()
    } catch {
      message.error('取消关联失败')
    } finally {
      setUnlinkingId(null)
    }
  }

  const linkedByActorId = useMemo(() => {
    const map = new Map<string, ActorLike>()
    actors.forEach((a) => map.set(a.id, a))
    return map
  }, [actors])

  useEffect(() => {
    // 为表格展示补齐 actor 详情（name/thumbnail/description）
    const missing = Array.from(new Set(links.map((l) => l.actor_id))).filter((id) => !linkedByActorId.has(id))
    if (missing.length === 0) return
    void (async () => {
      try {
        const res = await StudioEntitiesApi.list('actor', {
          page: 1,
          pageSize: 100,
          q: null,
          order: null,
          isDesc: false,
        })
        const items = (res.data?.items ?? []) as ActorLike[]
        setActors((prev) => {
          const map = new Map(prev.map((a) => [a.id, a]))
          items.forEach((a) => map.set(a.id, a))
          return Array.from(map.values())
        })
      } catch {
        // ignore
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links])

  const availableActors = useMemo(
    () => actors.filter((a) => !linkedActorIdSet.has(a.id)),
    [actors, linkedActorIdSet],
  )

  if (!projectId) return null

  return (
    <div className="h-full overflow-auto">
      <Card
        title="项目演员"
        extra={
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
              新建
            </Button>
            <Button
              type="primary"
              icon={<LinkOutlined />}
              onClick={() => {
                setSearch('')
                setLinkModalOpen(true)
              }}
            >
              从资产库关联
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => navigate('/assets')}>
              前往资产管理
            </Button>
          </Space>
        }
      >
        {links.length === 0 && !linksLoading ? (
          <Empty description="暂无项目演员，可从资产库关联演员到本项目" image={Empty.PRESENTED_IMAGE_SIMPLE}>
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
                新建
              </Button>
              <Button
                type="primary"
                icon={<LinkOutlined />}
                onClick={() => {
                  setSearch('')
                  setLinkModalOpen(true)
                }}
              >
                从资产库关联
              </Button>
              <Button onClick={() => navigate('/assets')}>前往资产管理</Button>
            </Space>
          </Empty>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {pagedLinks.map((l) => {
              const a = linkedByActorId.get(l.actor_id)
              return (
                <DisplayImageCard
                  key={l.id}
                  title={<div className="truncate">{a?.name ?? l.actor_id}</div>}
                  imageUrl={resolveAssetUrl(a?.thumbnail)}
                  imageAlt={a?.name ?? l.actor_id}
                  extra={
                    <Space size="small">
                      <Button
                        type="default"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() =>
                          navigate(
                            `/assets/actors/${l.actor_id}/edit?returnTo=${encodeWorkbenchAssetEditReturnTo(projectId, 'actors')}`,
                          )
                        }
                      >
                        编辑
                      </Button>
                      <Button
                        size="small"
                        danger
                        loading={unlinkingId === l.id}
                        onClick={() => {
                          Modal.confirm({
                            title: `取消关联「${a?.name ?? l.actor_id}」？`,
                            okText: '取消关联',
                            cancelText: '取消',
                            okButtonProps: { danger: true },
                            onOk: () => handleUnlinkActor(l),
                          })
                        }}
                      >
                        取消关联
                      </Button>
                    </Space>
                  }
                  meta={
                    <div className="space-y-1">
                      <div className="text-xs text-gray-600 line-clamp-2">{a?.description ?? '—'}</div>
                      <div className="text-xs text-gray-500 truncate">actor_id：{l.actor_id}</div>
                    </div>
                  }
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
      </Card>

      <ActorEntityFormModal
        open={createModalOpen}
        editing={null}
        linkProjectId={projectId}
        onCancel={() => setCreateModalOpen(false)}
        onSuccess={async () => {
          await loadLinks()
        }}
      />

      <Modal
        title="从资产库关联演员"
        open={linkModalOpen}
        onCancel={() => setLinkModalOpen(false)}
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

