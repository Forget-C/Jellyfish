import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, Input, Modal, Pagination, Space, message } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { StudioEntitiesApi } from '../../../../services/studioEntities'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { assetAdapters } from '../assetAdapters'
import { AssetImageCard } from '../components/AssetImageCard'
import { ActorEntityFormModal, type ActorEntityLike } from '../components/ActorEntityFormModal'

export function ActorsTab() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [actors, setActors] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [total, setTotal] = useState(0)

  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<ActorEntityLike | null>(null)
  const [fromShotCreateContext, setFromShotCreateContext] = useState<{
    projectId: string
    chapterId: string
    shotId: string
  } | null>(null)

  const load = async (opts?: { page?: number; pageSize?: number; q?: string }) => {
    setLoading(true)
    try {
      const nextPage = opts?.page ?? page
      const nextPageSize = opts?.pageSize ?? pageSize
      const q = typeof opts?.q === 'string' ? opts.q : search.trim() || undefined
      const res = await StudioEntitiesApi.list('actor', {
        page: nextPage,
        pageSize: nextPageSize,
        q: q ?? null,
        order: 'updated_at',
        isDesc: true,
      })
      const items = res.data?.items ?? []
      setActors(items)
      setTotal(res.data?.pagination.total ?? 0)
    } catch {
      message.error('加载演员失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize])

  useEffect(() => {
    const create = searchParams.get('create')
    const tab = searchParams.get('tab')
    const projectId = searchParams.get('projectId')?.trim() ?? ''
    const chapterId = searchParams.get('chapterId')?.trim() ?? ''
    const shotId = searchParams.get('shotId')?.trim() ?? ''
    if (create === '1' && tab === 'actor') {
      setEditing(null)
      if (projectId && chapterId && shotId) {
        setFromShotCreateContext({ projectId, chapterId, shotId })
      } else {
        setFromShotCreateContext(null)
      }
      setEditOpen(true)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('create')
          next.delete('name')
          next.delete('desc')
          next.delete('projectId')
          next.delete('chapterId')
          next.delete('shotId')
          return next
        },
        { replace: true },
      )
    }
  }, [searchParams, setSearchParams])

  const filtered = useMemo(() => actors, [actors])

  const openCreate = () => {
    setEditing(null)
    setFromShotCreateContext(null)
    setEditOpen(true)
  }

  const openEdit = (a: ActorEntityLike) => {
    setEditing(a)
    setFromShotCreateContext(null)
    setEditOpen(true)
  }

  const handleModalCancel = () => {
    setEditOpen(false)
    setEditing(null)
    setFromShotCreateContext(null)
  }

  return (
    <Card
      title="演员"
      extra={
        <Space>
          <Input.Search
            placeholder="搜索演员"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => {
              setPage(1)
              void load({ q: v, page: 1 })
            }}
            style={{ width: 240 }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建
          </Button>
        </Space>
      }
    >
      {filtered.length === 0 && !loading ? (
        <Empty description="暂无演员" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {filtered.map((a) => (
            <AssetImageCard
              key={a.id}
              asset={a}
              assetLabel="演员"
              listImages={assetAdapters.actor.listImages}
              createImageSlot={assetAdapters.actor.createImageSlot as any}
              renderPrompt={assetAdapters.actor.renderPrompt}
              createGenerationTask={assetAdapters.actor.createGenerationTask}
              onEdit={() => openEdit(a)}
              onDetails={() => navigate(`/assets/actors/${a.id}/edit`)}
              onDelete={() => {
                Modal.confirm({
                  title: `删除演员「${a.name}」？`,
                  okText: '删除',
                  cancelText: '取消',
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    try {
                      await StudioEntitiesApi.remove('actor', a.id)
                      message.success('已删除')
                      void load()
                    } catch {
                      message.error('删除失败')
                    }
                  },
                })
              }}
            />
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Pagination
          current={page}
          pageSize={pageSize}
          total={total}
          showSizeChanger={false}
          onChange={(p, ps) => {
            setPage(p)
            setPageSize(ps)
          }}
        />
      </div>

      <ActorEntityFormModal
        open={editOpen}
        editing={editing}
        linkProjectId={fromShotCreateContext?.projectId}
        linkChapterId={fromShotCreateContext?.chapterId}
        linkShotId={fromShotCreateContext?.shotId}
        onCancel={handleModalCancel}
        onSuccess={async (detail) => {
          const createdItem = detail?.created as { id?: string } | undefined
          if (createdItem && page === 1 && !search.trim()) {
            setActors((prev) => [createdItem, ...prev.filter((it) => it.id !== createdItem.id)])
            setTotal((prev) => prev + 1)
          }
          await load({ page: 1 })
          setPage(1)
        }}
      />
    </Card>
  )
}
