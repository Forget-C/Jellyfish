import { directingError } from '../../../directing/common'
import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Empty, Modal, Space, message, Pagination } from 'antd'
import { ArrowRightOutlined, MoreOutlined, PlusOutlined, SkinOutlined, TagOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { StudioProjectAssetsService } from '../../../../../services/generated'
import type { ProjectCostumeLinkRead, ProjectPropLinkRead } from '../../../../../services/generated'
import { resolveAssetUrl } from '../../../assets/utils'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import { ResourceCreateButton } from '../../../assets/components/ResourceCreateButton'
import { ResourceEditorDrawer } from '../../../assets/components/ResourceEditorDrawer'
import { ResourcePublishButton } from '../../../assets/components/ResourcePublishButton'
import { Tag } from 'antd'
import { useProjectAssetDetail } from '../useProjectAssetDetail'
import { ProjectContentToolbar } from '../ProjectContentToolbar'

type AssetKind = 'prop' | 'costume'

type AssetItemLike = {
  project_id?: string | null
  library_copy_id?: string | null
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
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [links, setLinks] = useState<(ProjectPropLinkRead | ProjectCostumeLinkRead)[]>([])
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


  useEffect(() => {
    void loadLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, kind])





  const { openDetail, detailView } = useProjectAssetDetail(kind, loadLinks)
  if (detailView) return detailView

  return (
    <div className="project-resource-page">
      <ProjectContentToolbar>
        <h1 className="app-page-title">{`项目${kind === 'prop' ? '道具' : '服装'}`}</h1>
        <Space wrap>
          <ResourceCreateButton kind={kind} projectId={projectId} onCreate={() => setCreateModalOpen(true)} onCreated={loadLinks}><Button aria-label="新建" type="primary" icon={<PlusOutlined aria-hidden />}>新建</Button></ResourceCreateButton>
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
                  title={<button type="button" data-project-asset-id={assetId} className="project-resource-name" title={asset?.name ?? '资源信息暂不可用'} onClick={() => openDetail(assetId)}><span>{asset?.name ?? '资源信息暂不可用'}</span><ArrowRightOutlined aria-hidden /></button>}
                  imageUrl={resolveAssetUrl(linkThumb ?? asset?.thumbnail)}
                  imageAlt={asset?.name ?? '资源信息暂不可用'}
                  placeholder={<>{kind === 'prop' ? <TagOutlined aria-hidden /> : <SkinOutlined aria-hidden />}暂无封面</>}
                  extra={<Dropdown trigger={['click']} menu={{ items: [
                    { key: 'edit', label: '编辑', onClick: () => openDetail(assetId) },
                    { key: 'delete', label: '删除项目对象', danger: true, disabled: !asset, onClick: () => {
                      Modal.confirm({
                        className: 'project-resource-dialog',
                        title: `删除项目对象「${asset?.name ?? '资源信息暂不可用'}」？`,
                        content: '删除此项目对象及其图片关联，已入库的独立副本继续保留。',
                        okText: '删除项目对象', cancelText: '取消', okButtonProps: { danger: true },
                        onOk: async () => {
                          try { await StudioEntitiesApi.remove(kind, assetId); await loadLinks() }
                          catch (cause) { message.error(directingError(cause)); throw cause }
                        },
                      })
                    } },
                  ] }}><Button type="text" icon={<MoreOutlined />} aria-label={`${asset?.name ?? '资源信息暂不可用'}更多操作`} /></Dropdown>}
                  meta={<><Tag>项目专属</Tag>{asset && <ResourcePublishButton kind={kind} asset={asset} projectId={projectId} onSaved={loadLinks} />} <div className="project-resource-description">{asset?.description?.trim() || '未填写简介'}</div></>}
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


      <ResourceEditorDrawer open={createModalOpen} kind={kind} projectId={projectId}
        onClose={() => setCreateModalOpen(false)} onSaved={loadLinks} />

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
