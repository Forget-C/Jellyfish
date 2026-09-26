import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Button, Empty, Modal, Input, message, Space, Select, Pagination } from 'antd'
import { EditOutlined, PlusOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  StudioProjectsService,
  StudioShotLinksService,
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

function notifyShotAssetCreatedAndLinked(payload: {
  projectId?: string
  chapterId?: string | null
  shotId?: string | null
  assetId?: string
  assetName: string
}) {
  if (!payload.projectId || !payload.chapterId || !payload.shotId) return
  try {
    window.opener?.postMessage(
      {
        type: 'studio-shot-asset-created-and-linked',
        projectId: payload.projectId,
        chapterId: payload.chapterId,
        shotId: payload.shotId,
        assetId: payload.assetId ?? null,
        assetName: payload.assetName,
      },
      window.location.origin,
    )
  } catch {
    // 跨窗口通知失败不阻塞角色创建成功。
  }
}

export function RolesTab() {
  const { options: projectStyleOptions, defaultVisualStyle, getDefaultStyle } = useProjectStyleOptions()
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { characters, loading, refresh } = useProjectCharacters(projectId)

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [pendingShotLinkShotId, setPendingShotLinkShotId] = useState<string | null>(null)
  const [pendingShotLinkChapterId, setPendingShotLinkChapterId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formActorId, setFormActorId] = useState<string | undefined>(undefined)
  const [formCostumeId, setFormCostumeId] = useState<string | undefined>(undefined)

  const [projectActorLinks, setProjectActorLinks] = useState<ProjectActorLinkRead[]>([])
  /** 全局演员库选择器（不要求用户先去「项目演员」页关联再回来） */
  const [actorPickerOpen, setActorPickerOpen] = useState(false)
  const [actorKeyword, setActorKeyword] = useState('')
  const [actorPage, setActorPage] = useState(1)
  const [actorLibrary, setActorLibrary] = useState<ActorLike[]>([])
  const [actorLibraryTotal, setActorLibraryTotal] = useState(0)
  const [actorLibraryLoading, setActorLibraryLoading] = useState(false)
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
      const shotIdFromUrl = searchParams.get('shotId')?.trim() ?? ''
      const chapterIdFromUrl = searchParams.get('chapterId')?.trim() ?? ''
      setPendingShotLinkShotId(shotIdFromUrl || null)
      setPendingShotLinkChapterId(chapterIdFromUrl || null)
      setCreateOpen(true)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('create')
          next.delete('name')
          next.delete('desc')
          next.delete('chapterId')
          next.delete('shotId')
          next.delete('visualStyle')
          next.delete('style')
          return next
        },
        { replace: true },
      )
    }
  }, [getDefaultStyle, projectStyle, projectVisualStyle, searchParams, setSearchParams])

  const openNormalRoleCreate = useCallback(() => {
    setPendingShotLinkShotId(null)
    setPendingShotLinkChapterId(null)
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
        StudioShotLinksService.listProjectEntityLinksApiV1StudioShotLinksEntityTypeGet({
          entityType: 'actor',
          projectId,
          chapterId: null,
          shotId: null,
          assetId: null,
          order: null,
          isDesc: false,
          page: 1,
          pageSize: 100,
        }),
        StudioShotLinksService.listProjectEntityLinksApiV1StudioShotLinksEntityTypeGet({
          entityType: 'costume',
          projectId,
          chapterId: null,
          shotId: null,
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
      const createRes = await StudioEntitiesApi.create('character', {
        id: newId('char'),
        project_id: projectId,
        chapter_id: pendingShotLinkChapterId,
        shot_id: pendingShotLinkShotId,
        name,
        description: formDesc.trim() || undefined,
        visual_style: formVisualStyle || '现实',
        style: formStyle,
        actor_id: formActorId,
        costume_id: formCostumeId ?? null,
      })
      const charId = (createRes.data as { id?: string } | undefined)?.id
      if (charId && pendingShotLinkShotId) {
        notifyShotAssetCreatedAndLinked({
          projectId,
          chapterId: pendingShotLinkChapterId,
          shotId: pendingShotLinkShotId,
          assetId: charId,
          assetName: name,
        })
      }
      message.success('角色创建成功')
      setCreateOpen(false)
      setFormName('')
      setFormDesc('')
      setFormActorId(undefined)
      setFormCostumeId(undefined)
      setFormVisualStyle(projectVisualStyle)
      setFormStyle(projectStyle)
      setPendingShotLinkShotId(null)
      setPendingShotLinkChapterId(null)
      await refresh()
    } catch {
      message.error('创建失败')
      setPendingShotLinkShotId(null)
      setPendingShotLinkChapterId(null)
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

  /** 演员库每页条数（后端 page_size 上限 100，这里用 6 一屏便于挑图）。 */
  const ACTOR_LIBRARY_PAGE_SIZE = 6

  const loadActorLibrary = useCallback(
    async (keyword: string, page: number) => {
      setActorLibraryLoading(true)
      try {
        const res = await StudioEntitiesApi.list('actor', {
          q: keyword.trim() || null,
          page,
          pageSize: ACTOR_LIBRARY_PAGE_SIZE,
        })
        setActorLibrary((res.data?.items ?? []) as ActorLike[])
        setActorLibraryTotal(Number(res.data?.pagination?.total ?? 0))
      } catch {
        message.error('演员库加载失败')
        setActorLibrary([])
        setActorLibraryTotal(0)
      } finally {
        setActorLibraryLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (!actorPickerOpen) return
    void loadActorLibrary(actorKeyword, actorPage)
  }, [actorPickerOpen, actorKeyword, actorPage, loadActorLibrary])

  /**
   * 选中演员：**只写进表单**，不在这里建立项目关联。
   *
   * 为什么：用户可能只是看看、或随后取消创建——这时不该在项目里留下关联行。
   * 关联由后端在创建/更新角色的**同一事务**内幂等确保（见
   * `services/studio/entity_crud.py::_ensure_character_actor_link`）。
   */
  const pickActorFromLibrary = useCallback((actor: ActorLike) => {
    setFormActorId(actor.id)
    setActorPickerOpen(false)
  }, [])

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
          setPendingShotLinkShotId(null)
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-gray-600">关联演员（必填）</div>
              <Button size="small" icon={<SearchOutlined />} onClick={() => setActorPickerOpen(true)}>
                从演员库选择
              </Button>
            </div>
            <Select
              className="w-full mt-1"
              placeholder="选择已关联的演员，或点右上角「从演员库选择」"
              loading={loadingLinks}
              value={formActorId}
              onChange={(v) => setFormActorId(v)}
              options={actorOptions}
              showSearch
              optionFilterProp="searchLabel"
              filterOption={(input, option) => String(option?.searchLabel ?? '').toLowerCase().includes(input.toLowerCase())}
            />
            <div className="mt-1 text-[11px] text-gray-400">
              「项目角色」与「关联演员」是两种对象：角色名称、描述、服装属于本项目；
              演员来自全局演员库，其定版图与文件被直接复用（不复制文件、不新建另一套演员数据）。
            </div>
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

      {/* 全局演员库选择器：支持服务端搜索、分页与缩略图；选中即写进表单并确保项目关联 */}
      <Modal
        title="从演员库选择演员"
        open={actorPickerOpen}
        onCancel={() => setActorPickerOpen(false)}
        footer={null}
        width={680}
        // 角色弹窗也是 Modal：不抬高层级会被它盖住，导致「选择」点不动（真实用户同样受影响）
        zIndex={1200}
      >
        <div className="space-y-3">
          <div className="text-[11px] text-gray-500">
            演员来自全局演员库（可跨项目复用）；选中后角色会引用该演员的定版图与文件，
            角色的名称 / 描述 / 服装仍然是本项目自己的字段。
          </div>
          <Input.Search
            allowClear
            placeholder="搜索演员名称 / 描述"
            value={actorKeyword}
            onChange={(e) => {
              setActorKeyword(e.target.value)
              setActorPage(1)
            }}
            onSearch={(value) => {
              setActorKeyword(value)
              setActorPage(1)
            }}
            data-testid="actor-library-search"
          />
          <div className="grid grid-cols-2 gap-2" data-testid="actor-library-list">
            {actorLibrary.map((actor) => {
              const url = resolveAssetUrl(actor.thumbnail)
              const linked = projectActorLinks.some((link) => link.actor_id === actor.id)
              return (
                <div key={actor.id} className="flex items-center gap-2 rounded border border-gray-200 p-2">
                  {url ? (
                    <img src={url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">
                      <UserOutlined />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{actor.name}</div>
                    <div className="truncate text-[11px] text-gray-400">
                      {linked ? '已在本项目' : '尚未关联本项目'}
                    </div>
                  </div>
                  <Button size="small" type="primary" onClick={() => void pickActorFromLibrary(actor)}>
                    选择
                  </Button>
                </div>
              )
            })}
            {!actorLibraryLoading && actorLibrary.length === 0 ? (
              <div className="col-span-2 py-6 text-center text-xs text-gray-400">没有匹配的演员</div>
            ) : null}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-400">{`共 ${actorLibraryTotal} 位演员`}</span>
            <Pagination
              size="small"
              current={actorPage}
              total={actorLibraryTotal}
              pageSize={ACTOR_LIBRARY_PAGE_SIZE}
              hideOnSinglePage
              onChange={(page) => setActorPage(page)}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
