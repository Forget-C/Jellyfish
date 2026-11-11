import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Empty, Input, Modal, Space, message, Pagination } from 'antd'
import { MoreOutlined, LinkOutlined, PlusOutlined, SkinOutlined, TagOutlined } from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { StudioProjectAssetsService } from '../../../../../services/generated'
import type { ProjectCostumeLinkRead, ProjectPropLinkRead } from '../../../../../services/generated'
import { resolveAssetUrl } from '../../../assets/utils'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import { StudioAssetTypeFormModal } from '../../../assets/components/StudioAssetTypeFormModal'
import { ProjectContentToolbar } from '../ProjectContentToolbar'
import { encodeWorkbenchAssetEditReturnTo, type WorkbenchAssetTabParam } from '../utils/workbenchAssetReturnTo'

type AssetKind = 'prop' | 'costume'

type AssetItemLike = {
  id: string
  name: string
  description?: string | null
  thumbnail?: string
}

function LinkedAssetTab({
  kind,
  projectId,
}: {
  kind: AssetKind
  projectId: string
}) {
  const navigate = useNavigate()
  const workbenchTab: WorkbenchAssetTabParam = kind === 'prop' ? 'props' : 'costumes'
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null)

  const [links, setLinks] = useState<(ProjectPropLinkRead | ProjectCostumeLinkRead)[]>([])
  const [assets, setAssets] = useState<AssetItemLike[]>([])
  const [assetsById, setAssetsById] = useState<Record<string, AssetItemLike>>({})

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
    setLoading(true)
    try {
      const res = await StudioProjectAssetsService.listProjectEntityLinksApiV1StudioProjectAssetsEntityTypeGet({
        entityType: kind,
        projectId,
        chapterId: null,

        assetId: null,
        order: null,
        isDesc: false,
        page: 1,
        pageSize: 100,
      })

      const items = (res.data?.items ?? []) as (ProjectPropLinkRead | ProjectCostumeLinkRead)[]
      setLinks(items)

      const ids = Array.from(new Set(items.map((l) => ('prop_id' in l ? l.prop_id : l.costume_id)).filter(Boolean))) as string[]

      const entityIdKey = kind === 'prop' ? 'prop' : 'costume'
      const detailList = await Promise.all(
        ids.map((id) =>
          StudioEntitiesApi.get(entityIdKey, id)
            .then((r) => (r.data ?? null) as AssetItemLike | null)
            .catch(() => null),
        ),
      )

      const map: Record<string, AssetItemLike> = {}
      detailList.filter(Boolean).forEach((x) => {
        map[x!.id] = x!
      })
      setAssetsById(map)
    } catch {
      message.error(`加载项目${kind === 'prop' ? '道具' : '服装'}关联失败`)
      setLinks([])
      setAssetsById({})
    } finally {
      setLoading(false)
    }
  }

  const loadAssets = async (qOverride?: string) => {
    setListLoading(true)
    try {
      const q = (qOverride ?? search).trim()
      const res =
        kind === 'prop'
          ? await StudioEntitiesApi.list('prop', {
              q: q || null,
              order: 'updated_at',
              isDesc: true,
              page: 1,
              pageSize: 100,
            })
          : await StudioEntitiesApi.list('costume', {
              q: q || null,
              order: 'updated_at',
              isDesc: true,
              page: 1,
              pageSize: 100,
            })
      setAssets((res.data?.items ?? []) as AssetItemLike[])
    } catch {
      message.error(`加载${kind === 'prop' ? '道具' : '服装'}失败`)
      setAssets([])
    } finally {
      setListLoading(false)
    }
  }

  useEffect(() => {
    void loadLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, kind])

  useEffect(() => {
    if (linkModalOpen) void loadAssets('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkModalOpen, kind])

  const linkedIdSet = useMemo(
    () => new Set(links.map((l) => ('prop_id' in l ? l.prop_id : l.costume_id))),
    [links],
  )
  const available = useMemo(() => assets.filter((a) => !linkedIdSet.has(a.id)), [assets, linkedIdSet])

  const handleLink = async (assetId: string, assetName: string) => {
    if (linkingId) return
    setLinkingId(assetId)
    try {
      if (kind === 'prop') {
        await StudioProjectAssetsService.createProjectPropLinkApiV1StudioProjectAssetsPropPost({
          requestBody: { project_id: projectId, chapter_id: null, asset_id: assetId },
        })
      } else {
        await StudioProjectAssetsService.createProjectCostumeLinkApiV1StudioProjectAssetsCostumePost({
          requestBody: { project_id: projectId, chapter_id: null, asset_id: assetId },
        })
      }
      message.success(`已关联${kind === 'prop' ? '道具' : '服装'}「${assetName}」`)
      setLinkModalOpen(false)
      await loadLinks()
    } catch {
      message.error('关联失败')
    } finally {
      setLinkingId(null)
    }
  }

  const handleUnlink = async (link: ProjectPropLinkRead | ProjectCostumeLinkRead) => {
    setUnlinkingId(link.id)
    try {
      if ('prop_id' in link) {
        await StudioProjectAssetsService.deleteProjectPropLinkApiV1StudioProjectAssetsPropLinkIdDelete({ linkId: link.id })
      } else {
        await StudioProjectAssetsService.deleteProjectCostumeLinkApiV1StudioProjectAssetsCostumeLinkIdDelete({ linkId: link.id })
      }
      message.success('已取消关联')
      await loadLinks()
    } catch {
      message.error('取消关联失败')
      throw new Error('取消关联失败')
    } finally {
      setUnlinkingId(null)
    }
  }

  return (
    <div className="project-resource-page">
      <ProjectContentToolbar>
        <h1 className="app-page-title">{`项目${kind === 'prop' ? '道具' : '服装'}`}</h1>
        <Space wrap>
          <Button type="primary" icon={<LinkOutlined />} onClick={() => { setSearch(''); setLinkModalOpen(true) }}>从资产库关联</Button>
          <Button icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>新建</Button>
          <Button type="link" onClick={() => navigate(`/assets?tab=${kind}`)}>查看资产库</Button>
        </Space>
      </ProjectContentToolbar>
        {links.length === 0 && !loading ? (
          <Empty description={`暂无项目${kind === 'prop' ? '道具' : '服装'}`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="space-y-3">
            <div className="project-resource-grid">
            {pagedLinks.map((l) => {
              const assetId = 'prop_id' in l ? l.prop_id : l.costume_id
              const asset = assetsById[assetId]
              const linkThumb = l.thumbnail
              return (
                <DisplayImageCard
                  variant="project"
                  imageFit="contain"
                  key={l.id}
                  title={<Link title={asset?.name ?? '资源信息暂不可用'} to={`/assets/${workbenchTab}/${assetId}/edit?returnTo=${encodeWorkbenchAssetEditReturnTo(projectId, workbenchTab)}`}>{asset?.name ?? '资源信息暂不可用'}</Link>}
                  imageUrl={resolveAssetUrl(linkThumb ?? asset?.thumbnail)}
                  imageAlt={asset?.name ?? '资源信息暂不可用'}
                  placeholder={<>{kind === 'prop' ? <TagOutlined aria-hidden /> : <SkinOutlined aria-hidden />}暂无封面</>}
                  extra={<Dropdown trigger={['click']} menu={{ items: [
                    { key: 'edit', label: '编辑', onClick: () => navigate(`/assets/${workbenchTab}/${assetId}/edit?returnTo=${encodeWorkbenchAssetEditReturnTo(projectId, workbenchTab)}`) },
                    { key: 'unlink', label: '取消关联', danger: true, disabled: unlinkingId === l.id, onClick: () => {
                      Modal.confirm({
                        className: 'project-resource-dialog',
                        title: `取消关联「${asset?.name ?? '资源信息暂不可用'}」？`,
                        content: '仅移除此资源与当前项目的关联，不会删除资产库中的资源。',
                        okText: '取消关联', cancelText: '取消', okButtonProps: { danger: true },
                        onOk: () => handleUnlink(l),
                      })
                    } },
                  ] }}><Button type="text" icon={<MoreOutlined />} aria-label={`${asset?.name ?? '资源信息暂不可用'}更多操作`} /></Dropdown>}
                  meta={<><div className="project-resource-description">{asset?.description?.trim() || '未填写简介'}</div></>}
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


      <StudioAssetTypeFormModal
        open={createModalOpen}
        label={kind === 'prop' ? '道具' : '服装'}
        entityType={kind}
        editing={null}
        linkProjectId={projectId}
        createAsset={async (payload) => {
          const entity = kind === 'prop' ? 'prop' : 'costume'
          const res = await StudioEntitiesApi.create(entity, payload as Record<string, unknown>)
          if (!res.data) throw new Error(`empty ${entity}`)
          return res.data as AssetItemLike
        }}
        updateAsset={async (id, payload) => {
          const entity = kind === 'prop' ? 'prop' : 'costume'
          const res = await StudioEntitiesApi.update(entity, id, payload as Record<string, unknown>)
          if (!res.data) throw new Error(`empty ${entity}`)
          return res.data as AssetItemLike
        }}
        onCancel={() => setCreateModalOpen(false)}
        onSaved={async () => {
          await loadLinks()
        }}
      />

      <Modal
        className="project-resource-dialog"
        title={`从资产库关联${kind === 'prop' ? '道具' : '服装'}`}
        open={linkModalOpen}
        onCancel={() => { if (!linkingId) setLinkModalOpen(false) }}
        closable={!linkingId} keyboard={!linkingId} maskClosable={!linkingId}
        footer={null}
        width={560}
      >
        <div className="mb-3">
          <Input.Search
            placeholder={`搜索${kind === 'prop' ? '道具' : '服装'}名称`}
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => loadAssets(v)}
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {listLoading ? (
            <div className="py-8 text-center text-gray-500">加载中...</div>
          ) : available.length === 0 ? (
            <Empty description="暂无可关联资产" />
          ) : (
            <div className="space-y-2">
              {available.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded border border-gray-200 p-2 hover:bg-gray-50">
                  <div className="flex items-center gap-2 min-w-0">
                    {resolveAssetUrl(a.thumbnail) ? (
                      <img src={resolveAssetUrl(a.thumbnail)} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">—</div>
                    )}
                    <div className="min-w-0">
                      <div className="font-medium truncate">{a.name}</div>
                      {a.description ? <div className="text-xs text-gray-500 truncate">{a.description}</div> : null}
                    </div>
                  </div>
                  <Button type="primary" size="small" disabled={!!linkingId} loading={linkingId === a.id} onClick={() => handleLink(a.id, a.name)}>
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

export function PropsTab() {
  const { projectId } = useParams<{ projectId: string }>()
  if (!projectId) return null
  return <LinkedAssetTab kind="prop" projectId={projectId} />
}

export function CostumesTab() {
  const { projectId } = useParams<{ projectId: string }>()
  if (!projectId) return null
  return <LinkedAssetTab kind="costume" projectId={projectId} />
}
