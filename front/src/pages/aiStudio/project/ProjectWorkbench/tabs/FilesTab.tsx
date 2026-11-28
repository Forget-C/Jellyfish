import { useUiText } from '../../../../../uiText'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Modal, Select, Space, Spin, Tag, Tooltip } from 'antd'
import { DownloadOutlined, FileImageOutlined, VideoCameraOutlined, SoundOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { StudioFilesService } from '../../../../../services/generated'
import type { FileRead } from '../../../../../services/generated'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { useChapters } from '../hooks/useProjectData'
import { buildFileDownloadUrl, resolveAssetUrl } from '../../../assets/utils'
import { ProjectContentToolbar } from '../ProjectContentToolbar'
import { useFileViewport } from '../../../files/components/useFileViewport'
import { FileVirtualGrid } from '../../../files/components/FileVirtualGrid'
import { FileScrollHint } from '../../../files/components/FileScrollHint'
import './project-files.css'

const PAGE_SIZE = 24

function openDownload(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function batchOpenDownloads(urls: string[]) {
  urls.forEach((url, i) => {
    if (!url) return
    setTimeout(() => window.open(url, '_blank', 'noopener,noreferrer'), i * 350)
  })
}

export function FilesTab() {
  const uiText = useUiText()
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()

  const { chapters, loading: chaptersLoading } = useChapters(projectId)

  const [chapterTitle, setChapterTitle] = useState<string | undefined>(undefined)
  const page = useRef(0)
  const generation = useRef(0)
  const loading = useRef(false)
  const pageRoot = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const [hasMore, setHasMore] = useState(true)
  const [files, setFiles] = useState<FileRead[]>([])
  const [total, setTotal] = useState(0)
  const [filesLoading, setFilesLoading] = useState(false)
  const [error, setError] = useState('')
  const [batchMode, setBatchMode] = useState(false)
  const mediaTrigger = useRef<HTMLElement | null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [previewVideo, setPreviewVideo] = useState<FileRead | null>(null)
  const request = useRef<ReturnType<typeof StudioFilesService.listFilesApiApiV1StudioFilesGet>>()
  const knownIds = useRef(new Set<string>())
  const viewport = useFileViewport(pageRoot, files.length)
  const [focusedId, setFocusedId] = useState<string>()
  const [hintUsed, setHintUsed] = useState(false)
  const previewScroll = useRef(0)
  const openPreview = (file: FileRead) => {
    mediaTrigger.current = document.activeElement as HTMLElement
    previewScroll.current = pageRoot.current?.closest('.project-workbench-content')?.scrollTop || 0
    setPreviewVideo(file)
  }
  const hintVisible = files.length > 0 && !previewVideo && !error && !filesLoading && viewport.remaining > 80 && !viewport.scrolling && !viewport.blocked
  useEffect(() => { if (viewport.scrolling) setHintUsed(true) }, [viewport.scrolling])

  // A generation owns its pagination; responses from earlier filters cannot update this list.
  const loadFiles = useCallback(async () => {
    if (!projectId || loading.current) return
    const requestGeneration = generation.current
    const nextPage = page.current + 1
    loading.current = true
    setFilesLoading(true)
    setError('')
    try {
      const pending = StudioFilesService.listFilesApiApiV1StudioFilesGet({
        projectId, chapterTitle: chapterTitle ?? null, page: nextPage,
        pageSize: PAGE_SIZE, order: 'updated_at', isDesc: true,
      })
      request.current = pending
      const res = await pending
      if (requestGeneration !== generation.current) return
      const items = res.data?.items ?? []
      const count = res.data?.pagination?.total
      page.current = nextPage
      const added = items.filter(file => { if (knownIds.current.has(file.id)) return false; knownIds.current.add(file.id); return true })
      setFiles(previous => [...previous, ...added])
      setTotal(count ?? 0)
      setHasMore(items.length > 0 && ((count === undefined || count === null) ? items.length === PAGE_SIZE : nextPage * PAGE_SIZE < count))
    } catch {
      if (requestGeneration === generation.current) setError(uiText("读取项目文件失败，请重试"))
    } finally {
      if (requestGeneration === generation.current) {
        loading.current = false
        setFilesLoading(false)
      }
    }
  }, [uiText, projectId, chapterTitle])

  useEffect(() => {
    generation.current += 1
    request.current?.cancel()
    knownIds.current.clear()
    setHintUsed(false)
    setFocusedId(undefined)
    page.current = 0
    loading.current = false
    setFiles([])
    setTotal(0)
    setHasMore(true)
    setError('')
    setSelectedIds(new Set())
    setBatchMode(false)
    const panel = pageRoot.current?.closest('.project-workbench-content')
    if (panel) panel.scrollTop = 0
    void loadFiles()
    return () => { generation.current += 1; request.current?.cancel() }
  }, [loadFiles])

  useEffect(() => {
    const root = pageRoot.current?.closest('.project-workbench-content')
    if (!root || !sentinel.current || filesLoading || error || !hasMore) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadFiles()
    }, { root, rootMargin: `0px 0px ${root.clientHeight}px 0px` })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [filesLoading, error, hasMore, loadFiles])

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  /** 展示与下载均使用 `/api/v1/studio/files/{id}/download`（由 buildFileDownloadUrl 拼接）。 */
  const fileResourceUrl = (file: FileRead) => buildFileDownloadUrl(file.id)

  const downloadOne = (file: FileRead) => {
    const url = fileResourceUrl(file)
    if (url) openDownload(url)
  }

  const handleBatchDownload = () => {
    const urls = Array.from(selectedIds)
      .map((id) => buildFileDownloadUrl(id))
      .filter((u): u is string => Boolean(u))
    batchOpenDownloads(urls)
  }

  return (
    <>
      <div ref={pageRoot} className="project-resource-page project-files-page">
      <ProjectContentToolbar>
        <div className="project-content-toolbar-leading">
          <h1 className="app-page-title">{uiText("项目文件")}</h1>
          <Select className="project-files-filter" aria-label={uiText("按章节筛选文件")} allowClear placeholder={uiText("全部章节")} style={{ width: 200, maxWidth: '100%' }}
            value={chapterTitle} options={chapters.map(c => ({ value: c.title, label: uiText("{{title}}（第{{index}}章）", { title: c.title, index: c.index }) }))}
            onChange={value => { setChapterTitle(value ?? undefined) }} loading={chaptersLoading} />
        </div>
        <Space wrap>
          <span className="project-files-count">{uiText("已加载")} {files.length}{total > 0 ? uiText(" / 共 {{total}}", { total }) : ''} {uiText("个文件")}</span>
          {batchMode && <Button onClick={() => setSelectedIds(new Set(files.map(file => file.id)))}>{uiText("选择已加载文件")}</Button>}
          {batchMode && <Button type="primary" aria-label={uiText("批量下载（{{size}}）", { size: selectedIds.size })} icon={<DownloadOutlined />} disabled={selectedIds.size === 0}
            onClick={handleBatchDownload}>{uiText("批量下载（{{size}}）", { size: selectedIds.size })}</Button>}
          <Button onClick={() => { setBatchMode(value => !value); setSelectedIds(new Set()) }}>
            {batchMode ? uiText("退出批量选择") : uiText("批量选择")}
          </Button>
          <Button type="link" onClick={() => navigate('/files')}>{uiText("前往文件管理")}</Button>
        </Space>
      </ProjectContentToolbar>
      {error && files.length === 0 && <Alert type="error" showIcon message={error} action={<Button onClick={() => void loadFiles()}>{uiText("重试读取文件")}</Button>} />}
        <Spin spinning={filesLoading && files.length === 0}>
          {files.length === 0 && !filesLoading && !error ? (
            <Empty
              description={uiText("暂无文件（仅展示已在项目中产生过关联记录的文件）")}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <FileVirtualGrid files={files} viewport={viewport} root={pageRoot} pinnedIds={[focusedId, previewVideo?.id]} onFocus={setFocusedId} className="project-resource-grid project-files-virtual">
              {file => {
                const url = fileResourceUrl(file)
                const checked = selectedIds.has(file.id)
                const isVideo = file.type === 'video'
                const isAudio = file.type === 'audio'

                return (
                    <DisplayImageCard
                      variant="project"
                      lazyImage
                      requireImageForClick={!isVideo && !isAudio}
                      title={
                        <div className="flex items-start gap-2 pr-1 min-w-0">
                          {batchMode && <Checkbox
                            aria-label={uiText("选择{{name}}", { name: file.name })}
                            checked={checked}
                            onChange={(e) => {
                              e.stopPropagation()
                              toggleSelect(file.id, e.target.checked)
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />}
                          <span className="truncate flex-1 min-w-0 text-sm font-semibold" title={file.name}>
                            {file.name}
                          </span>
                        </div>
                      }
                      imageUrl={isAudio ? undefined : resolveAssetUrl(file.thumbnail) || (isVideo ? undefined : url)}
                      imageAlt={file.name}
                      enablePreview={false}
                      onImageClick={() => openPreview(file)}
                      placeholder={
                        isAudio ? <SoundOutlined className="text-4xl" /> : isVideo ? (
                          <span className="flex flex-col items-center gap-1">
                            <VideoCameraOutlined className="text-4xl" />
                            <span className="text-xs">{uiText("点击预览")}</span>
                          </span>
                        ) : (
                          <FileImageOutlined className="text-5xl" />
                        )
                      }
                      meta={<Tag color={isVideo ? 'purple' : 'blue'}>{isVideo ? uiText("视频") : isAudio ? uiText("音频") : uiText("图片")}</Tag>}
                      extra={
                        <Tooltip title={uiText("下载{{name}}", { name: file.name })}>
                          <Button type="text" icon={<DownloadOutlined />} aria-label={uiText("下载{{name}}", { name: file.name })}
                            onClick={() => downloadOne(file)} />
                        </Tooltip>
                      }
                    />
                )
              }}
            </FileVirtualGrid>
          )}
        </Spin>

        <div ref={sentinel} className="project-files-load-status" role="status">
          {error && files.length > 0 && <Alert type="error" showIcon message={error} action={<Button onClick={() => void loadFiles()}>{uiText("重试读取文件")}</Button>} />}
          {filesLoading ? uiText("正在加载文件…") : error ? null : hasMore ?
            <Button onClick={() => void loadFiles()}>{uiText("加载更多")}</Button> : files.length > 0 ? uiText("已显示全部 {{length}} 个文件", { length: files.length }) : null}
        </div>
      </div>

      <FileScrollHint root={pageRoot} visible={hintVisible} used={hintUsed} onUsed={() => setHintUsed(true)} />
      <Modal
        className="project-resource-dialog"
        focusTriggerAfterClose={false}
        afterClose={() => { const panel = pageRoot.current?.closest('.project-workbench-content'); if (panel) panel.scrollTop = previewScroll.current; mediaTrigger.current?.focus({ preventScroll: true }) }}
        title={previewVideo?.name ?? uiText("媒体预览")}
        open={previewVideo !== null}
        footer={null}
        width={720}
        onCancel={() => { setFocusedId(previewVideo?.id); setPreviewVideo(null) }}
        destroyOnHidden
      >
        {previewVideo?.type === 'image' ? <img className="project-resource-preview" alt={previewVideo.name} src={buildFileDownloadUrl(previewVideo.id)} /> : previewVideo?.type === 'audio' ? <audio aria-label={uiText("音频预览")} src={buildFileDownloadUrl(previewVideo.id)} controls style={{ width: '100%' }} /> : previewVideo ? (
          <video
            aria-label={uiText("视频预览")}
            className="w-full max-h-[70vh] bg-black rounded"
            src={buildFileDownloadUrl(previewVideo.id)}
            controls
            playsInline
          >
            {uiText("您的浏览器不支持视频播放")}
          </video>
        ) : null}
      </Modal>
    </>
  )
}
