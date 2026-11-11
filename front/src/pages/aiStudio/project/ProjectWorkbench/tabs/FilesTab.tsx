import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Modal, Pagination, Select, Space, Spin, Tag, Tooltip } from 'antd'
import { DownloadOutlined, FileImageOutlined, VideoCameraOutlined, SoundOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { StudioFilesService } from '../../../../../services/generated'
import type { FileRead } from '../../../../../services/generated'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { useChapters } from '../hooks/useProjectData'
import { buildFileDownloadUrl, resolveAssetUrl } from '../../../assets/utils'
import { ProjectContentToolbar } from '../ProjectContentToolbar'
import './project-files.css'

const PAGE_SIZE = 10

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
  const [page, setPage] = useState(1)
  const [files, setFiles] = useState<FileRead[]>([])
  const [total, setTotal] = useState(0)
  const [filesLoading, setFilesLoading] = useState(false)
  const [error, setError] = useState('')
  const [batchMode, setBatchMode] = useState(false)
  const mediaTrigger = useRef<HTMLElement | null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [previewVideo, setPreviewVideo] = useState<FileRead | null>(null)

  const loadFiles = useCallback(async () => {
    if (!projectId) return
    setFilesLoading(true)
    try {
      const res = await StudioFilesService.listFilesApiApiV1StudioFilesGet({
        projectId,
        chapterTitle: chapterTitle ?? null,
        page,
        pageSize: PAGE_SIZE,
        order: 'updated_at',
        isDesc: true,
      })
      setError('')
      setFiles(res.data?.items ?? [])
      setTotal(res.data?.pagination?.total ?? 0)
    } catch {
      setError('读取项目文件失败，请重试')
      setFiles([])
      setTotal(0)
    } finally {
      setFilesLoading(false)
    }
  }, [projectId, chapterTitle, page])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

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
      <div className="project-resource-page project-files-page">
      <ProjectContentToolbar>
        <div className="project-content-toolbar-leading">
          <h1 className="app-page-title">项目文件</h1>
          <Select className="project-files-filter" aria-label="按章节筛选文件" allowClear placeholder="全部章节" style={{ width: 200, maxWidth: '100%' }}
            value={chapterTitle} options={chapters.map(c => ({ value: c.title, label: `${c.title}（第${c.index}章）` }))}
            onChange={value => { setChapterTitle(value ?? undefined); setPage(1) }} loading={chaptersLoading} />
        </div>
        <Space wrap>
          {batchMode && <Button type="primary" aria-label={`批量下载（${selectedIds.size}）`} icon={<DownloadOutlined />} disabled={selectedIds.size === 0}
            onClick={handleBatchDownload}>批量下载（{selectedIds.size}）</Button>}
          <Button onClick={() => { setBatchMode(value => !value); setSelectedIds(new Set()) }}>
            {batchMode ? '退出批量选择' : '批量选择'}
          </Button>
          <Button type="link" onClick={() => navigate('/files')}>前往文件管理</Button>
        </Space>
      </ProjectContentToolbar>
      {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => void loadFiles()}>重试读取文件</Button>} />}
        <Spin spinning={filesLoading}>
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

        {total > 0 && (
          <div className="mt-6 flex justify-end">
            <Pagination
              current={page}
              pageSize={PAGE_SIZE}
              total={total}
              showSizeChanger={false}
              onChange={(p) => setPage(p)}
              showTotal={(t) => `共 ${t} 条`}
            />
          </div>
        )}
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
