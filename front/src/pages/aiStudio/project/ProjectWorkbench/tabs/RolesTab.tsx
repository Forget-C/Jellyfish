import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Button, Empty, Modal, Input, message, Space, Select, Pagination } from 'antd'
import { EditOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  StudioProjectsService,
  StudioProjectAssetsService,
} from '../../../../../services/generated'
import type { ProjectActorLinkRead, ProjectCostumeLinkRead } from '../../../../../services/generated'
import { useProjectCharacters, newId } from '../hooks/useProjectData'
import { resolveAssetUrl } from '../../../assets/utils'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import {
  ProjectVisualStyleAndStyleFields,
  type ProjectVisualStyleChoice,
} from '../../../project/ProjectVisualStyleAndStyleFields'
import { useProjectStyleOptions } from '../../../project/useProjectStyleOptions'

type ActorLike = {
  id: string
  name: string
  description?: string | null
  thumbnail?: string
}

type CostumeLike = {
  id: string
  name: string
  description?: string | null
  thumbnail?: string
}

export function RolesTab() {
  const { options: projectStyleOptions, defaultVisualStyle, getDefaultStyle } = useProjectStyleOptions()
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { characters, loading, refresh } = useProjectCharacters(projectId)

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formActorId, setFormActorId] = useState<string | undefined>(undefined)
  const [formCostumeId, setFormCostumeId] = useState<string | undefined>(undefined)

  const [projectActorLinks, setProjectActorLinks] = useState<ProjectActorLinkRead[]>([])
  const [projectCostumeLinks, setProjectCostumeLinks] = useState<ProjectCostumeLinkRead[]>([])
  const [actorsById, setActorsById] = useState<Record<string, ActorLike>>({})
  const [costumesById, setCostumesById] = useState<Record<string, CostumeLike>>({})
  const [loadingLinks, setLoadingLinks] = useState(false)
  const [projectVisualStyle, setProjectVisualStyle] = useState<ProjectVisualStyleChoice>(defaultVisualStyle as ProjectVisualStyleChoice)
  const [projectStyle, setProjectStyle] = useState<string>(getDefaultStyle(defaultVisualStyle))
  const [formVisualStyle, setFormVisualStyle] = useState<ProjectVisualStyleChoice>(defaultVisualStyle as ProjectVisualStyleChoice)
  const [formStyle, setFormStyle] = useState<string>(getDefaultStyle(defaultVisualStyle))

  useEffect(() => {
    const create = searchParams.get('create')
    const name = searchParams.get('name') ?? ''
    const desc = searchParams.get('desc') ?? ''
    const tab = searchParams.get('tab')
    const visualStyle = (searchParams.get('visualStyle')?.trim() || '') as ProjectVisualStyleChoice | ''
    const style = searchParams.get('style')?.trim() ?? ''
    if (create === '1' && tab === 'roles') {
      setFormName(name)
      setFormDesc(desc)
      setFormActorId(undefined)
      setFormCostumeId(undefined)
      const nextVisual = visualStyle || projectVisualStyle
      setFormVisualStyle(nextVisual)
      setFormStyle(style || projectStyle || getDefaultStyle(nextVisual))
      setCreateOpen(true)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('create')
          next.delete('name')
          next.delete('desc')
          next.delete('visualStyle')
          next.delete('style')
          return next
        },
        { replace: true },
      )
    }
  }, [getDefaultStyle, projectStyle, projectVisualStyle, searchParams, setSearchParams])

  const openNormalRoleCreate = useCallback(() => {
    setFormName('')
    setFormDesc('')
    setFormActorId(undefined)
    setFormCostumeId(undefined)
    setFormVisualStyle(projectVisualStyle)
    setFormStyle(projectStyle)
    setCreateOpen(true)
  }, [projectStyle, projectVisualStyle])

  const loadProjectLinks = async () => {
    if (!projectId) return
    setLoadingLinks(true)
    try {
      const [actorRes, costumeRes] = await Promise.all([
        StudioProjectAssetsService.listProjectEntityLinksApiV1StudioProjectAssetsEntityTypeGet({
          entityType: 'actor',
          projectId,
          chapterId: null,

          assetId: null,
          order: null,
          isDesc: false,
          page: 1,
          pageSize: 100,
        }),
        StudioProjectAssetsService.listProjectEntityLinksApiV1StudioProjectAssetsEntityTypeGet({
          entityType: 'costume',
          projectId,
          chapterId: null,

          assetId: null,
          order: null,
          isDesc: false,
          page: 1,
          pageSize: 100,
        }),
      ])
      const actorLinks = (actorRes.data?.items ?? []) as ProjectActorLinkRead[]
      const costumeLinks = (costumeRes.data?.items ?? []) as ProjectCostumeLinkRead[]
      setProjectActorLinks(actorLinks)
      setProjectCostumeLinks(costumeLinks)

      const actorIds = Array.from(new Set(actorLinks.map((l) => l.actor_id)))
      const costumeIds = Array.from(new Set(costumeLinks.map((l) => l.costume_id)))

      const [actors, costumes] = await Promise.all([
        Promise.all(
          actorIds.map((id) =>
            StudioEntitiesApi.get('actor', id)
              .then((r) => (r.data ?? null) as ActorLike | null)
              .catch(() => null),
          ),
        ),
        Promise.all(
          costumeIds.map((id) =>
            StudioEntitiesApi.get('costume', id)
              .then((r) => (r.data ?? null) as CostumeLike | null)
              .catch(() => null),
          ),
        ),
      ])

      const nextActors: Record<string, ActorLike> = {}
      actors.filter(Boolean).forEach((a) => {
        nextActors[(a as ActorLike).id] = a as ActorLike
      })
      const nextCostumes: Record<string, CostumeLike> = {}
      costumes.filter(Boolean).forEach((c) => {
        nextCostumes[(c as CostumeLike).id] = c as CostumeLike
      })
      setActorsById(nextActors)
      setCostumesById(nextCostumes)
    } catch {
      message.error('加载项目关联演员/服装失败')
      setProjectActorLinks([])
      setProjectCostumeLinks([])
      setActorsById({})
      setCostumesById({})
    } finally {
      setLoadingLinks(false)
    }
  }

  useEffect(() => {
    void loadProjectLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    void (async () => {
      try {
        const res = await StudioProjectsService.getProjectApiV1StudioProjectsProjectIdGet({ projectId })
        const nextVisual = (res.data?.visual_style as ProjectVisualStyleChoice | undefined) ?? (defaultVisualStyle as ProjectVisualStyleChoice)
        const nextStyle = (res.data?.style as string | undefined) ?? getDefaultStyle(nextVisual)
        setProjectVisualStyle(nextVisual)
        setProjectStyle(nextStyle)
      } catch {
        // ignore: fallback to default
      }
    })()
  }, [defaultVisualStyle, getDefaultStyle, projectId])

  const handleCreateRole = async () => {
    if (!projectId) return
    const name = formName.trim()
    if (!name) {
      message.warning('请输入角色名称')
      return
    }
    if (!formActorId) {
      message.warning('请选择关联演员')
      return
    }
    setCreating(true)
    try {
      await StudioEntitiesApi.create('character', {
        id: newId('char'),
        project_id: projectId,
        name,
        description: formDesc.trim() || undefined,
        visual_style: formVisualStyle || '现实',
        style: formStyle,
        actor_id: formActorId,
        costume_id: formCostumeId ?? null,
      })
      message.success('角色创建成功')
      setCreateOpen(false)
      setFormName('')
      setFormDesc('')
      setFormActorId(undefined)
      setFormCostumeId(undefined)
      setFormVisualStyle(projectVisualStyle)
      setFormStyle(projectStyle)
      await refresh()
    } catch {
      message.error('创建失败')
    } finally {
      setCreating(false)
    }
  }

  const roleCards = useMemo(() => {
    return characters.map((c) => {
      const actor = actorsById[c.actor_id]
      const costume = c.costume_id ? costumesById[c.costume_id] : undefined
      return { c, actor, costume }
    })
  }, [actorsById, characters, costumesById])

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const pagedRoleCards = useMemo(() => {
    const start = (page - 1) * pageSize
    return roleCards.slice(start, start + pageSize)
  }, [page, pageSize, roleCards])

  useEffect(() => {
    setPage(1)
  }, [roleCards.length])

  const actorOptions = useMemo(() => {
    return projectActorLinks.map((l) => {
      const a = actorsById[l.actor_id]
      const url = resolveAssetUrl(a?.thumbnail)
      return {
        value: l.actor_id,
        searchLabel: a?.name ?? l.actor_id,
        label: (
          <div className="flex items-center gap-2 min-w-0">
            {url ? (
              <img src={url} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
            ) : (
              <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">
                <UserOutlined />
              </div>
            )}
            <div className="min-w-0 truncate">{a?.name ?? l.actor_id}</div>
          </div>
        ),
      }
    })
  }, [actorsById, projectActorLinks])

  const costumeOptions = useMemo(() => {
    return projectCostumeLinks.map((l) => {
      const c = costumesById[l.costume_id]
      return { value: l.costume_id, label: c?.name ?? l.costume_id, searchLabel: c?.name ?? l.costume_id }
    })
  }, [costumesById, projectCostumeLinks])

  if (!projectId) {
    return null
  }

  return (
    <div className="h-full overflow-auto">
      <Card
        title="项目角色"
        extra={
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={openNormalRoleCreate}>
              新建角色
            </Button>
          </Space>
        }
      >
        {characters.length === 0 && !loading ? (
          <Empty
            description="暂无项目角色"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={openNormalRoleCreate}>
                新建角色
              </Button>
            </Space>
          </Empty>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {pagedRoleCards.map(({ c, actor, costume }) => (
              <DisplayImageCard
                key={c.id}
                title={<div className="truncate">{c.name}</div>}
                imageUrl={resolveAssetUrl(c.thumbnail)}
                imageAlt={c.name}
                enablePreview
                extra={
                  <Space size="small">
                    <Button
                      type="default"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => {
                        if (!projectId) return
                        navigate(`/projects/${projectId}/roles/${c.id}/edit`)
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() => {
                        Modal.confirm({
                          title: `删除角色「${c.name}」？`,
                          okText: '删除',
                          cancelText: '取消',
                          okButtonProps: { danger: true },
                          onOk: async () => {
                            try {
                              await StudioEntitiesApi.remove('character', c.id)
                              message.success('已删除')
                              await refresh()
                            } catch {
                              message.error('删除失败')
                            }
                          },
                        })
                      }}
                    >
                      删除
                    </Button>
                  </Space>
                }
                meta={
                  <div className="space-y-1">
                    {c.description ? <div className="text-xs text-gray-600 line-clamp-2">{c.description}</div> : null}
                    <div className="text-xs text-gray-500 truncate">
                      演员：{actor?.name ?? c.actor_id}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      服装：{costume?.name ?? (c.costume_id ?? '—')}
                    </div>
                  </div>
                }
              />
            ))}
            </div>
            <div className="flex justify-end">
              <Pagination
                current={page}
                pageSize={pageSize}
                total={roleCards.length}
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

      <Modal
        title="新建角色"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false)
        }}
        onOk={handleCreateRole}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
        width={560}
      >
        <div className="space-y-3">
          <div>
            <div className="text-sm text-gray-600 mb-1">角色名称</div>
            <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="例如：小雨" />
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">描述（可选）</div>
            <Input.TextArea rows={3} value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
          </div>
          <div>
            <ProjectVisualStyleAndStyleFields
              visual_style={formVisualStyle}
              style={formStyle}
              options={projectStyleOptions}
              onChange={(next) => {
                setFormVisualStyle(next.visual_style)
                setFormStyle(next.style)
              }}
            />
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">关联演员（必填）</div>
            <Select
              className="w-full"
              placeholder="选择当前项目已关联的演员"
              loading={loadingLinks}
              value={formActorId}
              onChange={(v) => setFormActorId(v)}
              options={actorOptions}
              showSearch
              optionFilterProp="searchLabel"
              filterOption={(input, option) => String(option?.searchLabel ?? '').toLowerCase().includes(input.toLowerCase())}
            />
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">关联服装（可选）</div>
            <Select
              className="w-full"
              allowClear
              placeholder="选择当前项目已关联的服装"
              loading={loadingLinks}
              value={formCostumeId}
              onChange={(v) => setFormCostumeId(v)}
              options={costumeOptions}
              showSearch
              optionFilterProp="searchLabel"
              filterOption={(input, option) => String(option?.searchLabel ?? '').toLowerCase().includes(input.toLowerCase())}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
