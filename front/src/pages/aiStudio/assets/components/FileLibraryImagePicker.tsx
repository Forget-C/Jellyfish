import { useUiText } from '../../../../uiText'
import { useEffect, useState } from 'react'
import { Alert, Button, Dropdown, Empty, Input, Pagination, Spin, Tooltip } from 'antd'
import { CheckOutlined, MoreOutlined, PictureOutlined } from '@ant-design/icons'
import { StudioFilesService, type FileRead } from '../../../../services/generated'
import { WorkbenchButton } from '../../../../components/workbench/WorkbenchButton'
import { buildFileDownloadUrl, resolveAssetUrl } from '../utils'
import './file-library-image-picker.css'

function FilePickerThumbnail({ file }: { file: FileRead }) {
  const uiText = useUiText()
  const original = buildFileDownloadUrl(file.id)
  const thumbnail = resolveAssetUrl(file.thumbnail)
  const [failedSource, setFailedSource] = useState<string>()
  const source = thumbnail && failedSource !== thumbnail ? thumbnail : original
  return failedSource && failedSource === original
    ? <span role="status" className="file-library-image-picker-unavailable"><PictureOutlined aria-hidden />{uiText("图片暂不可预览")}</span>
    : <img src={source} loading="lazy" alt="" onError={() => setFailedSource(source)} />
}

export function FileLibraryImagePicker({ onSelect, disabled, autoFocus, canvas, projectId, selectedId, onRelease, releasing, releaseError, onRefresh }: {
  onSelect: (id: string) => void; disabled: boolean; autoFocus?: boolean; canvas?: boolean; projectId?: string
  selectedId?: string | null; onRelease?: (id: string) => Promise<boolean>; releasing?: string; releaseError?: string; onRefresh?: () => void
}) {
  const uiText = useUiText()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [loaded, setLoaded] = useState<{ scope: string; page: number; rows: FileRead[]; total: number }>()
  const [failed, setFailed] = useState(false)
  const pageSize = 12
  const scope = JSON.stringify([projectId, query])
  const pageSet = loaded?.scope === scope ? loaded : undefined
  const result = pageSet?.page === page ? pageSet : undefined

  useEffect(() => {
    let active = true
    setFailed(false)
    const request = StudioFilesService.listFilesApiApiV1StudioFilesGet({
      projectId, q: query || undefined, fileType: 'image', page, pageSize, order: 'updated_at', isDesc: true,
    })
    void request.then(({ data }) => {
      if (!data || !Array.isArray(data.items)) throw new Error(uiText("图片列表响应无效"))
      if (!active) return
      const lastPage = Math.max(1, Math.ceil(data.pagination.total / pageSize))
      if (page > lastPage) setPage(lastPage)
      else setLoaded({ scope, page, rows: data.items, total: data.pagination.total })
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; request.cancel() }
  }, [uiText, page, projectId, query, scope, retry])

  return <div className="file-library-image-picker" data-canvas={canvas || undefined}>
    <div className="file-library-image-picker-toolbar">
      <Input.Search allowClear={canvas} autoFocus={autoFocus} aria-label={uiText("搜索图片")} placeholder={uiText("搜索图片名称")} onSearch={value => { setQuery(value.trim()); setPage(1) }} />
      {onRefresh && <Button disabled={!!releasing} onClick={() => { onRefresh(); setRetry(value => value + 1) }}>{uiText("刷新项目文件")}</Button>}
    </div>
    {releaseError && <Alert type="error" message={releaseError} />}
    {failed && <Alert type="error" message={uiText("图片列表加载失败")}
      action={<Button onClick={() => setRetry(value => value + 1)}>{uiText("重试")}</Button>} />}
    <div className="file-library-image-picker-content" key={`${scope}:${page}`}>
      {!result ? !failed && <Spin aria-label={uiText("正在加载图片")} />
        : result.rows.length ? <div className="file-library-image-picker-grid">
          {result.rows.map(file => <div className="file-library-image-picker-item" key={file.id}>
            <Button disabled={disabled || !!releasing} onClick={() => onSelect(file.id)} title={file.name}
              aria-label={canvas ? `${uiText("选用")} ${file.name}` : undefined} aria-pressed={canvas ? selectedId === file.id : undefined}>
              {canvas ? <FilePickerThumbnail file={file} /> : <img src={buildFileDownloadUrl(file.id)} loading="lazy" alt="" />}
              <span className="file-library-image-picker-name">{file.name}</span>
              {selectedId === file.id && <CheckOutlined className="file-library-image-picker-selected" aria-hidden />}
            </Button>
            {onRelease && <div className="file-library-image-picker-more">
              <Tooltip title={uiText("更多操作")} trigger={['hover', 'focus']}>
                <Dropdown trigger={['click']} menu={{ items: [{ key: 'release', label: uiText("释放上传保留"), danger: true }],
                  onClick: async () => {
                    if (!await onRelease(file.id)) return
                    setLoaded(previous => previous?.scope === scope
                      ? { ...previous, rows: previous.rows.filter(item => item.id !== file.id) } : previous)
                    setRetry(value => value + 1)
                  } }}>
                  <WorkbenchButton icon={<MoreOutlined />} loading={releasing === file.id}
                    disabled={disabled || !!releasing} aria-label={uiText("{{name}}更多操作", { name: file.name })} />
                </Dropdown>
              </Tooltip>
            </div>}
          </div>)}
        </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={uiText("暂无匹配图片")} />}
    </div>
    {pageSet && pageSet.total > pageSize && <Pagination current={page} pageSize={pageSize} total={pageSet.total}
      showSizeChanger={false} size={canvas ? 'small' : undefined} onChange={setPage} disabled={!!releasing} />}
  </div>
}
