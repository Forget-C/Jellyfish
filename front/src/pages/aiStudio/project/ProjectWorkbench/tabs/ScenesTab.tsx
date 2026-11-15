import { directingError } from '../../../directing/common'
import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Empty, Modal, Space, message, Pagination } from 'antd'
import { ArrowRightOutlined, MoreOutlined, PlusOutlined, EnvironmentOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import { StudioProjectAssetsService } from '../../../../../services/generated'
import type { ProjectSceneLinkRead } from '../../../../../services/generated'
import { buildFileDownloadUrl, resolveAssetUrl } from '../../../assets/utils'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import { ResourceCreateButton } from '../../../assets/components/ResourceCreateButton'
import { ResourceEditorDrawer } from '../../../assets/components/ResourceEditorDrawer'
import { ResourcePublishButton } from '../../../assets/components/ResourcePublishButton'
import { Tag } from 'antd'
import { useProjectAssetDetail } from '../useProjectAssetDetail'
import { ProjectContentToolbar } from '../ProjectContentToolbar'

type SceneLike = {
  project_id?: string | null
  library_copy_id?: string | null
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


  useEffect(() => {
    void loadLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])



  const toThumbUrl = (thumbnail?: string) => {
    const url = resolveAssetUrl(thumbnail)
    if (url) return url
    // 兼容后端返回 file_id 的情况
    if (thumbnail && !thumbnail.includes('/') && !thumbnail.includes(':')) return buildFileDownloadUrl(thumbnail)
    return undefined
  }



  const { openDetail, detailView } = useProjectAssetDetail('scene', loadLinks)
  if (detailView) return detailView

  if (!projectId) return null

  return (
    <div className="project-resource-page">
      <ProjectContentToolbar>
        <h1 className="app-page-title">项目场景</h1>
        <Space wrap>
          <ResourceCreateButton kind={'scene'} projectId={projectId} onCreate={() => setCreateModalOpen(true)} onCreated={loadLinks}><Button aria-label="新建" type="primary" icon={<PlusOutlined aria-hidden />}>新建</Button></ResourceCreateButton>
          <Button type="link" onClick={() => navigate('/assets?tab=scene')}>查看资产库</Button>
        </Space>
      </ProjectContentToolbar>
        {links.length === 0 && !linksLoading ? (
          <Empty description="暂无项目场景，可新建或从资产库导入" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="space-y-3">
            <div className="project-resource-grid">
            {pagedLinks.map((l) => {
              const s = scenesById[l.scene_id]
              return (
                <DisplayImageCard
                  variant="project"
                  imageFit="cover"
                  key={l.id}
                  title={<button type="button" data-project-asset-id={l.scene_id} className="project-resource-name" title={s?.name ?? '场所信息暂不可用'} onClick={() => openDetail(l.scene_id)}><span>{s?.name ?? '场所信息暂不可用'}</span><ArrowRightOutlined aria-hidden /></button>}
                  imageUrl={toThumbUrl(l.thumbnail ?? s?.thumbnail)}
                  imageAlt={s?.name ?? '场所信息暂不可用'}
                  placeholder={<><EnvironmentOutlined aria-hidden />暂无封面</>}
                  extra={<Dropdown trigger={['click']} menu={{ items: [
                    { key: 'edit', label: '编辑', onClick: () => openDetail(l.scene_id) },
                    { key: 'delete', label: '删除项目对象', danger: true, disabled: !s, onClick: () => {
                      Modal.confirm({
                        className: 'project-resource-dialog',
                        title: `删除项目对象「${s?.name ?? '场所信息暂不可用'}」？`,
                        content: '删除此项目对象及其图片关联，已入库的独立副本继续保留。',
                        okText: '删除项目对象', cancelText: '取消', okButtonProps: { danger: true },
                        onOk: async () => {
                          try { await StudioEntitiesApi.remove('scene', l.scene_id); await loadLinks() }
                          catch (cause) { message.error(directingError(cause)); throw cause }
                        },
                      })
                    } },
                  ] }}><Button type="text" icon={<MoreOutlined />} aria-label={`${s?.name ?? '场所信息暂不可用'}更多操作`} /></Dropdown>}
                  meta={<><Tag>项目专属</Tag>{s && <ResourcePublishButton kind={'scene'} asset={s} projectId={projectId} onSaved={loadLinks} />} <div className="project-resource-description">{s?.description?.trim() || '未填写简介'}</div></>}
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


      <ResourceEditorDrawer open={createModalOpen} kind="scene" projectId={projectId}
        onClose={() => setCreateModalOpen(false)} onSaved={loadLinks} />

    </div>
  )
}
