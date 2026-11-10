import { useEffect, useId, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Input, Select, Skeleton, Tag } from 'antd'
import { FileImageOutlined, FileOutlined, ReloadOutlined, SearchOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components'
import api from '../../../services/aiStudioApi'
import type { FileItem } from '../../../mocks/data'
import './file-management.css'

function FileThumbnail({ src, name, type }: { src?: string; name: string; type: FileItem['type'] }) {
  const [failed, setFailed] = useState(false)
  const Icon = type === 'video' ? VideoCameraOutlined : type === 'image' ? FileImageOutlined : FileOutlined

  return (
    <div className="file-thumbnail">
      {src && !failed
        ? <img src={src} alt={`${name}缩略图`} loading="lazy" onError={() => setFailed(true)} />
        : <span className="file-thumbnail-placeholder"><Icon aria-hidden />暂无缩略图</span>}
    </div>
  )
}

function FileCard({ file, selected, onSelect }: {
  file: FileItem
  selected: boolean
  onSelect?: (checked: boolean) => void
}) {
  const titleId = useId()
  const name = typeof file.name === 'string' && file.name.trim() ? file.name : '未命名文件'
  const type = file.type === 'image' ? '图片' : file.type === 'video' ? '视频' : '类型未知'
  const createdAt = typeof file.createdAt === 'string' && file.createdAt.trim() ? file.createdAt : '时间未知'
  const thumbnail = typeof file.thumbnail === 'string' ? file.thumbnail.trim() : undefined
  const tags = file.tags

  return (
    <article className="file-card" aria-labelledby={titleId} data-selected={selected || undefined}>
      {onSelect && (
        <div className="file-card-select">
          <Checkbox aria-label={`选择${name}`} checked={selected} onChange={event => onSelect(event.target.checked)} />
        </div>
      )}
      <FileThumbnail key={thumbnail} src={thumbnail} name={name} type={file.type} />
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
  const [files, setFiles] = useState<FileItem[] | null>(null)
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [revision, setRevision] = useState(0)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string>()
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => {
    let active = true
    void api.files.list().then(response => {
      if (!active) return
      if (!Array.isArray(response) || response.some(file => !file || typeof file.id !== 'string' || !file.id)) {
        setLoadStatus('error')
        return
      }
      const nextFiles = response.map(file => ({
        ...file,
        name: typeof file.name === 'string' ? file.name : '',
        tags: Array.isArray(file.tags)
          ? Array.from(new Set(file.tags.filter(tag => typeof tag === 'string' && tag.trim())))
          : [],
      }))
      const nextIds = new Set(nextFiles.map(file => file.id))
      setFiles(nextFiles)
      setSelectedIds(ids => ids.filter(id => nextIds.has(id)))
      setLoadStatus('loaded')
    }).catch(() => {
      if (active) setLoadStatus('error')
    })
    return () => { active = false }
  }, [revision])

  const refresh = () => {
    if (loadStatus === 'loading') return
    setLoadStatus('loading')
    setRevision(value => value + 1)
  }

  const allTags = Array.from(new Set(files?.flatMap(file => file.tags))).sort()
  const query = search.trim().toLowerCase()
  const visible = files?.filter(file => (
    (!query || file.name?.toLowerCase().includes(query) || file.tags.some(tag => tag.toLowerCase().includes(query))) &&
    (!tagFilter || file.tags.includes(tagFilter))
  )) ?? []
  const selected = new Set(selectedIds)
  const selectedVisible = visible.filter(file => selected.has(file.id)).length
  const filtered = Boolean(query || tagFilter)

  const toggleBatchMode = () => {
    if (batchMode) setSelectedIds([])
    setBatchMode(!batchMode)
  }

  return (
    <WorkspaceLayout className="management-page">
      <PageToolbar title="文件管理" className="management-toolbar">
        <div className="management-tools">
          <Input
            aria-label="搜索文件"
            placeholder="搜索文件名或标签"
            prefix={<SearchOutlined />}
            allowClear
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
          <Select<string>
            aria-label="按标签筛选"
            className="file-tag-filter"
            placeholder="按标签筛选"
            allowClear
            value={tagFilter}
            onChange={setTagFilter}
            options={allTags.map(tag => ({ label: tag, value: tag }))}
          />
          {files && <span className="management-count">已加载 {files.length} 个文件</span>}
          {files && import.meta.env.VITE_USE_MOCK === 'true' && <Tag>示例数据</Tag>}
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
          <span role="status">已选 {selected.size} 项{selectedVisible < selected.size && `（${selected.size - selectedVisible} 项不在当前筛选）`}</span>
          <Button size="small" disabled>批量标记（暂未接入）</Button>
          <Button size="small" disabled>批量导出（暂未接入）</Button>
        </div>
      )}
      <WorkspaceScrollPanel className="management-panel">
        {loadStatus === 'error' && (
          <Alert
            showIcon
            type="error"
            message={files ? '刷新文件失败，仍显示上次结果' : '读取文件失败'}
            action={<Button size="small" onClick={refresh}>重试</Button>}
          />
        )}
        {loadStatus === 'loading' && !files && (
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
                setTagFilter(undefined)
              }}>清除筛选</Button>}
            </Empty>
          </div>
        )}
      </WorkspaceScrollPanel>
    </WorkspaceLayout>
  )
}
