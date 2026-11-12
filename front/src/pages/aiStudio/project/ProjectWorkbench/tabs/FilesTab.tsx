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

  // A generation owns its pagination; responses from earlier filters cannot update this list.
  const loadFiles = useCallback(async () => {
    if (!projectId || loading.current) return
    const requestGeneration = generation.current
    const nextPage = page.current + 1
    loading.current = true
    setFilesLoading(true)
    setError('')
    try {
      const res = await StudioFilesService.listFilesApiApiV1StudioFilesGet({
        projectId, chapterTitle: chapterTitle ?? null, page: nextPage,
        pageSize: PAGE_SIZE, order: 'updated_at', isDesc: true,
      })
      if (requestGeneration !== generation.current) return
      const items = res.data?.items ?? []
      const count = res.data?.pagination?.total
      page.current = nextPage
      setFiles(previous => Array.from(new Map([...previous, ...items].map(file => [file.id, file])).values()))
      setTotal(count ?? 0)
      setHasMore(items.length > 0 && ((count === undefined || count === null) ? items.length === PAGE_SIZE : nextPage * PAGE_SIZE < count))
    } catch {
      if (requestGeneration === generation.current) setError('读取项目文件失败，请重试')
    } finally {
      if (requestGeneration === generation.current) {
        loading.current = false
        setFilesLoading(false)
      }
    }
  }, [projectId, chapterTitle])

  useEffect(() => {
    generation.current += 1
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
    return () => { generation.current += 1 }
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
          <h1 className="app-page-title">项目文件</h1>
          <Select className="project-files-filter" aria-label="按章节筛选文件" allowClear placeholder="全部章节" style={{ width: 200, maxWidth: '100%' }}
            value={chapterTitle} options={chapters.map(c => ({ value: c.title, label: `${c.title}（第${c.index}章）` }))}
            onChange={value => { setChapterTitle(value ?? undefined) }} loading={chaptersLoading} />
        </div>
        <Space wrap>
          <span className="project-files-count">已加载 {files.length}{total > 0 ? ` / 共 ${total}` : ''} 个文件</span>
          {batchMode && <Button onClick={() => setSelectedIds(new Set(files.map(file => file.id)))}>选择已加载文件</Button>}
          {batchMode && <Button type="primary" aria-label={`批量下载（${selectedIds.size}）`} icon={<DownloadOutlined />} disabled={selectedIds.size === 0}
            onClick={handleBatchDownload}>批量下载（{selectedIds.size}）</Button>}
          <Button onClick={() => { setBatchMode(value => !value); setSelectedIds(new Set()) }}>
            {batchMode ? '退出批量选择' : '批量选择'}
          </Button>
          <Button type="link" onClick={() => navigate('/files')}>前往文件管理</Button>
        </Space>
      </ProjectContentToolbar>
      {error && files.length === 0 && <Alert type="error" showIcon message={error} action={<Button onClick={() => void loadFiles()}>重试读取文件</Button>} />}
        <Spin spinning={filesLoading && files.length === 0}>
          {files.length === 0 && !filesLoading && !error ? (
            <Empty
              description="暂无文件（仅展示已在项目中产生过关联记录的文件）"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <div className="project-resource-grid">
              {files.map((file) => {
                const url = fileResourceUrl(file)
                const checked = selectedIds.has(file.id)
                const isVideo = file.type === 'video'
                const isAudio = file.type === 'audio'

                return (
                  <div key={file.id}>
                    <DisplayImageCard
                      variant="project"
                      lazyImage
                      title={
                        <div className="flex items-start gap-2 pr-1 min-w-0">
                          {batchMode && <Checkbox
                            aria-label={`选择${file.name}`}
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
                      imageUrl={isAudio ? undefined : isVideo ? resolveAssetUrl(file.thumbnail) : url}
                      imageAlt={file.name}
                      enablePreview={!isVideo && !isAudio}
                      onImageClick={isVideo || isAudio ? () => { mediaTrigger.current = document.activeElement as HTMLElement; setPreviewVideo(file) } : undefined}
                      placeholder={
                        isAudio ? <SoundOutlined className="text-4xl" /> : isVideo ? (
                          <span className="flex flex-col items-center gap-1">
                            <VideoCameraOutlined className="text-4xl" />
                            <span className="text-xs">点击预览</span>
                          </span>
                        ) : (
                          <FileImageOutlined className="text-5xl" />
                        )
                      }
                      meta={<Tag color={isVideo ? 'purple' : 'blue'}>{isVideo ? '视频' : isAudio ? '音频' : '图片'}</Tag>}
                      extra={
                        <Tooltip title={`下载${file.name}`}>
                          <Button type="text" icon={<DownloadOutlined />} aria-label={`下载${file.name}`}
                            onClick={() => downloadOne(file)} />
                        </Tooltip>
                      }
                    />
                  </div>
                )
              })}
            </div>
          )}
        </Spin>

        <div ref={sentinel} className="project-files-load-status" role="status">
          {error && files.length > 0 && <Alert type="error" showIcon message={error} action={<Button onClick={() => void loadFiles()}>重试读取文件</Button>} />}
          {filesLoading ? '正在加载文件…' : error ? null : hasMore ?
            <Button onClick={() => void loadFiles()}>加载更多</Button> : files.length > 0 ? `已显示全部 ${files.length} 个文件` : null}
        </div>
      </div>

      <Modal
        className="project-resource-dialog"
        focusTriggerAfterClose={false}
        afterClose={() => mediaTrigger.current?.focus({ preventScroll: true })}
        title={previewVideo?.name ?? '媒体预览'}
        open={previewVideo !== null}
        footer={null}
        width={720}
        onCancel={() => setPreviewVideo(null)}
        destroyOnClose
      >
        {previewVideo?.type === 'audio' ? <audio aria-label="音频预览" src={buildFileDownloadUrl(previewVideo.id)} controls style={{ width: '100%' }} /> : previewVideo ? (
          <video
            aria-label="视频预览"
            className="w-full max-h-[70vh] bg-black rounded"
            src={buildFileDownloadUrl(previewVideo.id)}
            controls
            playsInline
          >
            您的浏览器不支持视频播放
          </video>
        ) : null}
      </Modal>
    </>
  )
}
