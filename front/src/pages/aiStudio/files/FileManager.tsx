import { useEffect, useId, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Input, Modal, Pagination, Select, Skeleton, Tag } from 'antd'
import { FileImageOutlined, FileOutlined, ReloadOutlined, SoundOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components'
import api from '../../../services/aiStudioApi'
import { StudioFilesService } from '../../../services/generated'
import type { FileRead } from '../../../services/generated'
import { buildFileDownloadUrl, resolveAssetUrl } from '../assets/utils'
import { searchManagementList } from '../managementListSearch'
import './file-management.css'

const PAGE_SIZE = 24
const DEMO_MODE = import.meta.env.VITE_USE_MOCK === 'true'

type FileEntry = Omit<FileRead, 'tags'> & { tags: string[]; createdAt?: string }
type FilePage = { items: FileEntry[]; total?: number; page: number }

function normalizeFiles(response: (FileRead & { createdAt?: string })[]): FileEntry[] {
  if (!Array.isArray(response) || response.some(file => !file || typeof file.id !== 'string' || !file.id)) {
    throw new Error('文件列表响应无效')
  }
  return response.map(file => ({
    ...file,
    name: typeof file.name === 'string' ? file.name : '',
    tags: Array.isArray(file.tags) ? Array.from(new Set(file.tags.filter(tag => typeof tag === 'string' && tag.trim()))) : [],
  }))
}

function FileThumbnail({ src, name, type }: { src?: string; name: string; type: FileRead['type'] }) {
  const [failed, setFailed] = useState(false)
  const Icon = type === 'video' ? VideoCameraOutlined : type === 'image' ? FileImageOutlined : type === 'audio' ? SoundOutlined : FileOutlined

  return (
    <span className="file-thumbnail">
      {src && !failed
        ? <img src={src} alt={`${name}缩略图`} loading="lazy" onError={() => setFailed(true)} />
        : <span className="file-thumbnail-placeholder"><Icon aria-hidden />暂无缩略图</span>}
    </span>
  )
}

function FileCard({ file, selected, onSelect, onPreview }: {
  file: FileEntry
  selected: boolean
  onSelect?: (checked: boolean) => void
  onPreview?: () => void
}) {
  const titleId = useId()
  const name = typeof file.name === 'string' && file.name.trim() ? file.name : '未命名文件'
  const type = file.type === 'image' ? '图片' : file.type === 'video' ? '视频' : file.type === 'audio' ? '音频' : '类型未知'
  const createdAt = typeof file.createdAt === 'string' && file.createdAt.trim() ? file.createdAt : '时间未知'
  const thumbnail = DEMO_MODE ? file.thumbnail : resolveAssetUrl(file.thumbnail)
  const tags = file.tags

  return (
    <article className="file-card" aria-labelledby={titleId} data-selected={selected || undefined}>
      {onSelect && (
        <div className="file-card-select">
          <Checkbox aria-label={`选择${name}`} checked={selected} onChange={event => onSelect(event.target.checked)} />
        </div>
      )}
      {onPreview ? <button type="button" className="file-preview-trigger" aria-label={`预览${name}`} onClick={onPreview}>
        <FileThumbnail key={thumbnail} src={thumbnail} name={name} type={file.type} />
        <span className="file-preview-label">预览</span>
      </button> : <FileThumbnail key={thumbnail} src={thumbnail} name={name} type={file.type} />}
      <div className="file-card-details">
        <h2 id={titleId} title={name}>{name}</h2>
        <div className="file-card-meta">
          <span>{type}</span>
          <span title={createdAt}>{createdAt}</span>
        </div>
        <div className="file-card-tags" title={tags.length ? tags.join('、') : undefined}>
          {tags.slice(0, 2).map(tag => <Tag key={tag}>{tag}</Tag>)}
          {tags.length > 2 && <span>+{tags.length - 2}</span>}
          {tags.length === 0 && <span>—</span>}
        </div>
      </div>
    </article>
  )
}

export default function FileManager() {
  const [result, setResult] = useState<FilePage | null>(null)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [allTags, setAllTags] = useState<string[]>([])
  const [preview, setPreview] = useState<FileEntry | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [revision, setRevision] = useState(0)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string>()
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => {
    let active = true
    let request: { cancel: () => void } | undefined
    setLoadStatus('loading')
    const discovered = new Set<string>()
    const rememberTags = (items: FileEntry[]) => {
      items.forEach(file => file.tags.forEach(tag => discovered.add(tag)))
      return items
    }
    const keyword = query.toLocaleLowerCase()
    const matches = (file: FileEntry) => (
      (!keyword || file.name.toLocaleLowerCase().includes(keyword) || file.tags.some(tag => tag.toLocaleLowerCase().includes(keyword))) &&
      (!tagFilter || file.tags.includes(tagFilter))
    )
    const slicePage = (items: FileEntry[]) => ({
      items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      total: items.length,
    })
    const readPage = async (requestedPage: number) => {
      const reading = StudioFilesService.listFilesApiApiV1StudioFilesGet({
        page: requestedPage, pageSize: PAGE_SIZE, order: 'updated_at', isDesc: true,
      })
      request = reading
      const { data } = await reading
      if (!data) throw new Error('文件列表响应缺少数据')
      return { items: rememberTags(normalizeFiles(data.items)), total: data.pagination?.total }
    }
    const load = async () => {
      if (DEMO_MODE) {
        const files = rememberTags(normalizeFiles(await api.files.list()))
        return slicePage(files.filter(matches))
      }
      if (keyword || tagFilter) {
        const filtered = await searchManagementList(readPage, PAGE_SIZE, matches, () => active)
        return filtered && slicePage(filtered)
      }
      return readPage(page)
    }
    void load().then(data => {
      if (!active || !data) return
      const last = data.total === undefined ? page : Math.max(1, Math.ceil(data.total / PAGE_SIZE))
      if (page > last) {
        setPage(last)
        return
      }
      setAllTags(previous => [...new Set([...previous, ...discovered])].sort())
      setResult({ ...data, page })
      setLoadStatus('loaded')
    }).catch(() => {
      if (active) setLoadStatus('error')
    })
    return () => {
      active = false
      request?.cancel()
    }
  }, [page, query, revision, tagFilter])

  const refresh = () => {
    if (loadStatus === 'loading') return
    setLoadStatus('loading')
    setRevision(value => value + 1)
  }

  const searchFiles = (value: string) => {
    setQuery(value.trim())
    setPage(1)
  }

  const visible = result?.items ?? []
  const selected = new Set(selectedIds)
  const selectedVisible = visible.filter(file => selected.has(file.id)).length
  const filtered = Boolean(query || tagFilter)
  const previewUrl = preview ? buildFileDownloadUrl(preview.id) : undefined

  const toggleBatchMode = () => {
    if (batchMode) setSelectedIds([])
    setBatchMode(!batchMode)
  }

  return (
    <WorkspaceLayout className="management-page">
      <PageToolbar title="文件管理" className="management-toolbar">
        <div className="management-tools">
          <Input.Search
            aria-label="搜索文件名或标签"
            className="file-search"
            placeholder="搜索文件名或标签"
            allowClear
            value={search}
            onSearch={searchFiles}
            onChange={event => {
              setSearch(event.target.value)
              if (!event.target.value) searchFiles('')
            }}
          />
          <Select<string>
            aria-label="按标签筛选"
            className="file-tag-filter"
            placeholder="按标签筛选"
            allowClear
            value={tagFilter}
            onChange={value => { setTagFilter(value); setPage(1) }}
            options={allTags.map(tag => ({ label: tag, value: tag }))}
          />
          {result && <span className="management-count">{result.total === undefined
            ? `已加载 ${result.items.length} 个文件` : `共 ${result.total} 个文件`}</span>}
          {result && DEMO_MODE && <Tag>示例数据</Tag>}
        </div>
        <div className="file-toolbar-actions management-primary">
          <Button type="text" icon={<ReloadOutlined />} loading={loadStatus === 'loading'} onClick={refresh}>刷新</Button>
          <Button aria-expanded={batchMode} onClick={toggleBatchMode}>
            {batchMode ? '退出批量管理' : '批量管理'}
          </Button>
        </div>
      </PageToolbar>
      {batchMode && (
        <div className="file-batch-actions management-surface">
          <span role="status">已选 {selected.size} 项{selectedVisible < selected.size && `（${selected.size - selectedVisible} 项不在当前${filtered ? '筛选' : '页'}）`}</span>
          <Button size="small" disabled>批量标记（暂未接入）</Button>
          <Button size="small" disabled>批量导出（暂未接入）</Button>
        </div>
      )}
      <WorkspaceScrollPanel className="management-panel">
        {loadStatus === 'error' && (
          <Alert
            showIcon
            type="error"
            message={result ? '刷新文件失败，仍显示上次结果' : '读取文件失败'}
            action={<Button size="small" onClick={refresh}>重试</Button>}
          />
        )}
        {loadStatus === 'loading' && !result && (
          <div className="file-card-grid" role="status" aria-label="正在读取文件">
            {[1, 2, 3].map(item => <div className="management-surface" key={item}><Skeleton active paragraph={{ rows: 3 }} /></div>)}
          </div>
        )}
        {visible.length > 0 && (
          <div className="file-card-grid">
            {visible.map(file => <FileCard
              key={file.id}
              file={file}
              selected={selected.has(file.id)}
              onPreview={!DEMO_MODE && !file.deleted && ['image', 'video', 'audio'].includes(file.type) ? () => {
                setPreviewFailed(false)
                setPreview(file)
              } : undefined}
              onSelect={batchMode ? checked => setSelectedIds(ids => checked
                ? [...new Set([...ids, file.id])]
                : ids.filter(id => id !== file.id)) : undefined}
            />)}
          </div>
        )}
        {loadStatus === 'loaded' && visible.length === 0 && (
          <div className="management-surface">
            <Empty description={filtered ? '无匹配文件' : '暂无文件'}>
              {filtered && <Button onClick={() => {
                setSearch('')
                searchFiles('')
                setTagFilter(undefined)
              }}>清除筛选</Button>}
            </Empty>
          </div>
        )}
        {result && result.total !== undefined && <Pagination
          className="file-pagination" size="small" current={result.page} pageSize={PAGE_SIZE}
          total={result.total} showSizeChanger={false} hideOnSinglePage
          disabled={loadStatus === 'loading'} onChange={setPage}
        />}
      </WorkspaceScrollPanel>
      <Modal title={preview ? `${preview.name || '未命名文件'} · 预览` : '文件预览'}
        open={Boolean(preview)} onCancel={() => setPreview(null)} footer={null} destroyOnClose
        width="min(720px, calc(100vw - 24px))">
        {previewFailed ? <Alert type="error" showIcon message="无法预览此文件" /> : preview && previewUrl && (
          <div className="file-preview-media">
            {preview.type === 'image' ? <img src={previewUrl} alt={preview.name || '未命名文件'} onError={() => setPreviewFailed(true)} />
              : preview.type === 'audio' ? <audio src={previewUrl} controls preload="metadata" aria-label="音频预览" onError={() => setPreviewFailed(true)} />
                : <video src={previewUrl} controls playsInline preload="metadata" aria-label="视频预览" onError={() => setPreviewFailed(true)} />}
          </div>
        )}
      </Modal>
    </WorkspaceLayout>
  )
}
