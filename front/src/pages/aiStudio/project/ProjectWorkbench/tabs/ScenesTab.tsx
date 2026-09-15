import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, Input, Modal, Space, message, Pagination } from 'antd'
import { EditOutlined, LinkOutlined, PlusOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import { StudioProjectAssetsService } from '../../../../../services/generated'
import type { ProjectSceneLinkRead } from '../../../../../services/generated'
import { buildFileDownloadUrl, resolveAssetUrl } from '../../../assets/utils'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import { StudioAssetTypeFormModal } from '../../../assets/components/StudioAssetTypeFormModal'
import { encodeWorkbenchAssetEditReturnTo } from '../utils/workbenchAssetReturnTo'

type SceneLike = {
  id: string
  name: string
  description?: string | null
  thumbnail?: string
}

export function ScenesTab() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()

  const [links, setLinks] = useState<ProjectSceneLinkRead[]>([])
  const [linksLoading, setLinksLoading] = useState(false)
  const [scenesById, setScenesById] = useState<Record<string, SceneLike>>({})

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [scenes, setScenes] = useState<SceneLike[]>([])
  const [scenesLoading, setScenesLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null)

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
        entityType: 'scene',
        projectId,
        chapterId: null,

        assetId: null,
        order: null,
        isDesc: false,
        page: 1,
        pageSize: 100,
      })
      const items = (res.data?.items ?? []) as ProjectSceneLinkRead[]
      setLinks(items)

      const ids = Array.from(new Set(items.map((l) => l.scene_id)))
      const fetched = await Promise.all(
        ids.map((id) =>
          StudioEntitiesApi.get('scene', id)
            .then((r) => (r.data ?? null) as SceneLike | null)
            .catch(() => null),
        ),
      )
      const next: Record<string, SceneLike> = {}
      fetched.filter(Boolean).forEach((s) => {
        next[(s as SceneLike).id] = s as SceneLike
      })
      setScenesById(next)
    } catch {
      message.error('加载项目场景关联失败')
      setLinks([])
      setScenesById({})
    } finally {
      setLinksLoading(false)
    }
  }

  const loadScenes = async (searchQuery?: string) => {
    setScenesLoading(true)
    try {
      const q = (searchQuery !== undefined ? searchQuery : search).trim()
      const res = await StudioEntitiesApi.list('scene', {
        q: q ? q : null,
        order: 'updated_at',
        isDesc: true,
        page: 1,
        pageSize: 100,
      })
      setScenes((res.data?.items ?? []) as SceneLike[])
    } catch {
      message.error('加载场景失败')
      setScenes([])
    } finally {
      setScenesLoading(false)
    }
  }

  useEffect(() => {
    void loadLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (linkModalOpen) void loadScenes('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkModalOpen])

  const linkedSceneIdSet = useMemo(() => new Set(links.map((l) => l.scene_id)), [links])
  const availableScenes = useMemo(() => scenes.filter((s) => !linkedSceneIdSet.has(s.id)), [scenes, linkedSceneIdSet])

  const toThumbUrl = (thumbnail?: string) => {
    const url = resolveAssetUrl(thumbnail)
    if (url) return url
    // 兼容后端返回 file_id 的情况
    if (thumbnail && !thumbnail.includes('/') && !thumbnail.includes(':')) return buildFileDownloadUrl(thumbnail)
    return undefined
  }

  const handleLinkScene = async (scene: SceneLike) => {
    if (!projectId) return
    setLinkingId(scene.id)
    try {
      await StudioProjectAssetsService.createProjectSceneLinkApiV1StudioProjectAssetsScenePost({
        requestBody: { project_id: projectId, chapter_id: null, asset_id: scene.id },
      })
      message.success(`已关联场景「${scene.name}」到项目`)
      setLinkModalOpen(false)
      await loadLinks()
    } catch {
      message.error('关联失败')
    } finally {
      setLinkingId(null)
    }
  }

  const handleUnlinkScene = async (link: ProjectSceneLinkRead) => {
    setUnlinkingId(link.id)
    try {
      await StudioProjectAssetsService.deleteProjectSceneLinkApiV1StudioProjectAssetsSceneLinkIdDelete({ linkId: link.id })
      message.success('已取消关联')
      await loadLinks()
    } catch {
      message.error('取消关联失败')
    } finally {
      setUnlinkingId(null)
    }
  }

  if (!projectId) return null

  return (
    <div className="h-full overflow-auto">
      <Card
        title="项目场景"
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
            <Button icon={<PlusOutlined />} onClick={() => navigate('/assets?tab=scene')}>
              前往资产管理
            </Button>
          </Space>
        }
      >
        {links.length === 0 && !linksLoading ? (
          <Empty description="暂无项目场景，可从资产库关联场景到本项目" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {pagedLinks.map((l) => {
              const s = scenesById[l.scene_id]
              return (
                <DisplayImageCard
                  key={l.id}
                  title={<div className="truncate">{s?.name ?? l.scene_id}</div>}
                  imageUrl={toThumbUrl(l.thumbnail ?? s?.thumbnail)}
                  imageAlt={s?.name ?? l.scene_id}
                  extra={
                    <Space size="small">
                      <Button
                        type="default"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() =>
                          navigate(
                            `/assets/scenes/${l.scene_id}/edit?returnTo=${encodeWorkbenchAssetEditReturnTo(projectId, 'scenes')}`,
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
                            title: `取消关联「${s?.name ?? l.scene_id}」？`,
                            okText: '取消关联',
                            cancelText: '取消',
                            okButtonProps: { danger: true },
                            onOk: () => handleUnlinkScene(l),
                          })
                        }}
                      >
                        取消关联
                      </Button>
                    </Space>
                  }
                  meta={
                    <div className="space-y-1">
                      <div className="text-xs text-gray-600 line-clamp-2">{s?.description ?? '—'}</div>
                      <div className="text-xs text-gray-500 truncate">scene_id：{l.scene_id}</div>
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

      <StudioAssetTypeFormModal
        open={createModalOpen}
        label="场景"
        entityType="scene"
        editing={null}
        linkProjectId={projectId}
        createAsset={async (payload) => {
          const res = await StudioEntitiesApi.create('scene', payload as Record<string, unknown>)
          if (!res.data) throw new Error('empty scene')
          return res.data as SceneLike
        }}
        updateAsset={async (id, payload) => {
          const res = await StudioEntitiesApi.update('scene', id, payload as Record<string, unknown>)
          if (!res.data) throw new Error('empty scene')
          return res.data as SceneLike
        }}
        onCancel={() => setCreateModalOpen(false)}
        onSaved={async () => {
          await loadLinks()
        }}
      />

      <Modal
        title="从资产库关联场景"
        open={linkModalOpen}
        onCancel={() => setLinkModalOpen(false)}
        footer={null}
        width={560}
      >
        <div className="mb-3">
          <Input.Search
            placeholder="搜索场景名称"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(value) => loadScenes(value)}
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {scenesLoading ? (
            <div className="py-8 text-center text-gray-500">加载中...</div>
          ) : availableScenes.length === 0 ? (
            <Empty description={scenes.length === 0 ? '暂无场景，请先在资产管理中创建场景' : '当前项目已关联全部搜索结果'} />
          ) : (
            <div className="space-y-2">
              {availableScenes.map((scene) => (
                <div
                  key={scene.id}
                  className="flex items-center justify-between gap-3 rounded border border-gray-200 p-2 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {toThumbUrl(scene.thumbnail) ? (
                      <img
                        src={toThumbUrl(scene.thumbnail)}
                        alt=""
                        className="w-10 h-10 rounded object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">
                        —
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-medium truncate">{scene.name}</div>
                      {scene.description && <div className="text-xs text-gray-500 truncate">{scene.description}</div>}
                    </div>
                  </div>
                  <Button type="primary" size="small" loading={linkingId === scene.id} onClick={() => handleLinkScene(scene)}>
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
