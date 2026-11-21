import { useUiText } from '../../../uiText'
import { useEffect, useId, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Input, Modal, Select, Skeleton, Tag } from 'antd'
import { FileImageOutlined, FileOutlined, ReloadOutlined, SoundOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components'
import type { FileRead } from '../../../services/generated'
import { buildFileDownloadUrl, resolveAssetUrl } from '../assets/utils'
import { useManagedFiles, DEMO_MODE, type FileEntry } from './useManagedFiles'
import { useFileViewport } from './components/useFileViewport'
import { FileVirtualGrid } from './components/FileVirtualGrid'
import { FileScrollHint } from './components/FileScrollHint'
import './file-management.css'

function FileThumbnail({ src, name, type }: { src?: string; name: string; type: FileRead['type'] }) {
  const uiText = useUiText()
  const [failed, setFailed] = useState(false)
  const Icon = type === 'video' ? VideoCameraOutlined : type === 'image' ? FileImageOutlined : type === 'audio' ? SoundOutlined : FileOutlined

  return (
    <span className="file-thumbnail">
      {src && !failed
        ? <img src={src} alt={uiText("{{name}}缩略图", { name })} loading="lazy" onError={() => setFailed(true)} />
        : <span className="file-thumbnail-placeholder"><Icon aria-hidden />{uiText("暂无缩略图")}</span>}
    </span>
  )
}

function FileCard({ file, selected, onSelect, onPreview }: {
  file: FileEntry
  selected: boolean
  onSelect?: (checked: boolean) => void
  onPreview?: () => void
}) {
  const uiText = useUiText()
  const titleId = useId()
  const name = typeof file.name === 'string' && file.name.trim() ? file.name : uiText("未命名文件")
  const type = file.type === 'image' ? '图片' : file.type === 'video' ? '视频' : file.type === 'audio' ? '音频' : '类型未知'
  const createdAt = typeof file.createdAt === 'string' && file.createdAt.trim() ? file.createdAt : uiText("时间未知")
  const thumbnail = DEMO_MODE ? file.thumbnail : resolveAssetUrl(file.thumbnail)
  const tags = file.tags

  return (
    <article className="file-card" aria-labelledby={titleId} data-selected={selected || undefined}>
      {onSelect && (
        <div className="file-card-select">
          <Checkbox aria-label={uiText("选择{{name}}", { name })} checked={selected} onChange={event => onSelect(event.target.checked)} />
        </div>
      )}
      {onPreview ? <button type="button" className="file-preview-trigger" aria-label={uiText("预览{{name}}", { name })} onClick={onPreview}>
        <FileThumbnail key={thumbnail} src={thumbnail} name={name} type={file.type} />
        <span className="file-preview-label">{uiText("预览")}</span>
      </button> : <FileThumbnail key={thumbnail} src={thumbnail} name={name} type={file.type} />}
      <div className="file-card-details">
        <h2 id={titleId} title={name}>{name}</h2>
        <div className="file-card-meta">
          <span>{uiText(type)}</span>
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
  const uiText = useUiText()
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string>()
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [preview, setPreview] = useState<FileEntry | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [focusedId, setFocusedId] = useState<string>()
  const [hintUsed, setHintUsed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const previewScroll = useRef(0)
  const data = useManagedFiles(query, tagFilter, () => {
    setSelectedIds([]); setBatchMode(false); setFocusedId(undefined); setHintUsed(false)
    if (root.current) root.current.scrollTop = 0
  })
  const { files: visible, tags: allTags, busy, filtered, error, more, load } = data
  const loadStatus = busy ? 'loading' : error ? 'error' : 'loaded'
  const viewport = useFileViewport(root, visible.length)
  useEffect(() => { if (viewport.scrolling) setHintUsed(true) }, [viewport.scrolling])
  useEffect(() => {
    if (filtered || busy || error || !more || !sentinel.current) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load()
    }, { root: root.current, rootMargin: `0px 0px ${root.current?.clientHeight || 0}px 0px` })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [filtered, busy, error, more, load])
  const selected = new Set(selectedIds)
  const refresh = () => { void data.load(true) }
  const searchFiles = (value: string) => setQuery(value.trim())
  const previewUrl = preview ? buildFileDownloadUrl(preview.id) : undefined
  const countLabel = filtered ? data.more ? uiText("已找到 {{length}} 项 · 已检查 {{scanned}} 项", { length: visible.length, scanned: data.scanned }) : uiText("共 {{length}} 个文件", { length: visible.length })
    : uiText("已加载 {{length}}{{value2}} 个文件", { length: visible.length, value2: data.total === undefined ? '' : uiText(" / 共 {{total}}", { total: data.total }) })

  const toggleBatchMode = () => {
    if (batchMode) setSelectedIds([])
    setBatchMode(!batchMode)
  }

  return (
    <WorkspaceLayout className="management-page file-manager-page" style={{ position: 'relative' }}>
      <PageToolbar title={uiText("文件管理")} className="management-toolbar">
        <div className="management-tools">
          <Input.Search
            aria-label={uiText("搜索文件名或标签")}
            className="file-search"
            placeholder={uiText("搜索文件名或标签")}
            allowClear
            value={search}
            onSearch={searchFiles}
            onChange={event => {
              setSearch(event.target.value)
              if (!event.target.value) searchFiles('')
            }}
          />
          <Select<string>
            aria-label={uiText("按标签筛选")}
            className="file-tag-filter"
            placeholder={uiText("按标签筛选")}
            allowClear
            value={tagFilter}
            onChange={value => { setTagFilter(value) }}
            options={allTags.map(tag => ({ label: tag, value: tag }))}
          />
          <span className="management-count">{countLabel}</span>
          <span className="management-count">{uiText("已发现标签")}</span>
          {DEMO_MODE && <Tag>{uiText("示例数据")}</Tag>}
        </div>
        <div className="file-toolbar-actions management-primary">
          <Button type="text" icon={<ReloadOutlined />} loading={loadStatus === 'loading'} onClick={refresh}>{uiText("刷新")}</Button>
          <Button aria-expanded={batchMode} onClick={toggleBatchMode}>
            {batchMode ? uiText("退出批量管理") : uiText("批量管理")}
          </Button>
        </div>
      </PageToolbar>
      {batchMode && (
        <div className="file-batch-actions management-surface">
          <span role="status">{uiText("已选")} {selected.size} {uiText("项")}</span>
          <Button size="small" disabled={busy} onClick={() => setSelectedIds(visible.map(file => file.id))}>{uiText("选择已加载文件")}</Button>
          <Button size="small" disabled>{uiText("批量标记（暂未接入）")}</Button>
          <Button size="small" disabled>{uiText("批量导出（暂未接入）")}</Button>
        </div>
      )}
      <WorkspaceScrollPanel ref={root} className="management-panel">
        {loadStatus === 'error' && (
          <Alert
            showIcon
            type="error"
            message={uiText(error === 'refresh' ? "刷新文件失败，仍显示上次结果" : "读取文件失败")}
            action={<Button size="small" onClick={() => void data.load(error === 'refresh')}>{uiText("重试")}</Button>}
          />
        )}
        {loadStatus === 'loading' && visible.length === 0 && (
          <div className="file-card-grid" role="status" aria-label={uiText("正在读取文件")}>
            {[1, 2, 3].map(item => <div className="management-surface" key={item}><Skeleton active paragraph={{ rows: 3 }} /></div>)}
          </div>
        )}
        {visible.length > 0 && (
          <FileVirtualGrid files={visible} viewport={viewport} root={root} pinnedIds={[focusedId, preview?.id]} onFocus={setFocusedId} className="file-card-grid file-virtual-grid">
            {file => <FileCard
              key={file.id}
              file={file}
              selected={selected.has(file.id)}
              onPreview={!DEMO_MODE && !file.deleted && ['image', 'video', 'audio'].includes(file.type) ? () => {
                trigger.current = document.activeElement as HTMLElement
                previewScroll.current = root.current?.scrollTop || 0
                setPreviewFailed(false)
                setPreview(file)
              } : undefined}
              onSelect={batchMode ? checked => setSelectedIds(ids => checked
                ? [...new Set([...ids, file.id])]
                : ids.filter(id => id !== file.id)) : undefined}
            />}
          </FileVirtualGrid>
        )}
        {loadStatus === 'loaded' && visible.length === 0 && (
          <div className="management-surface">
            <Empty description={filtered ? data.more ? uiText("当前已检查范围内暂无匹配") : uiText("无匹配文件") : uiText("暂无文件")}>
              {filtered && <Button onClick={() => {
                setSearch('')
                searchFiles('')
                setTagFilter(undefined)
              }}>{uiText("清除筛选")}</Button>}
            </Empty>
          </div>
        )}
        <div ref={sentinel} className="file-load-status" role="status">
          {busy ? uiText("正在读取文件…") : !error && data.more ? <Button onClick={() => void data.load()}>{filtered ? uiText("继续检索") : uiText("加载更多")}</Button>
            : !error && visible.length > 0 ? uiText("已显示全部 {{length}} 个文件", { length: visible.length }) : null}
        </div>
      </WorkspaceScrollPanel>
      <FileScrollHint root={root} used={hintUsed} onUsed={() => setHintUsed(true)} visible={visible.length > 0 && !preview && !busy && !error && !viewport.scrolling && !viewport.blocked && viewport.remaining > 80} />
      <Modal title={preview ? uiText("{{value1}} · 预览", { value1: preview.name || '未命名文件' }) : uiText("文件预览")}
        focusTriggerAfterClose={false} afterClose={() => { if (root.current) root.current.scrollTop = previewScroll.current; trigger.current?.focus({ preventScroll: true }) }}
        open={Boolean(preview)} onCancel={() => { setFocusedId(preview?.id); setPreview(null) }} footer={null} destroyOnClose
        width="min(720px, calc(100vw - 24px))">
        {previewFailed ? <Alert type="error" showIcon message={uiText("无法预览此文件")} /> : preview && previewUrl && (
          <div className="file-preview-media">
            {preview.type === 'image' ? <img src={previewUrl} alt={preview.name || uiText("未命名文件")} onError={() => setPreviewFailed(true)} />
              : preview.type === 'audio' ? <audio src={previewUrl} controls preload="metadata" aria-label={uiText("音频预览")} onError={() => setPreviewFailed(true)} />
                : <video src={previewUrl} controls playsInline preload="metadata" aria-label={uiText("视频预览")} onError={() => setPreviewFailed(true)} />}
          </div>
        )}
      </Modal>
    </WorkspaceLayout>
  )
}
