import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Input, Pagination, Spin } from 'antd'
import { StudioFilesService, type FileRead } from '../../../../services/generated'
import { buildFileDownloadUrl } from '../utils'
import './file-library-image-picker.css'

export function FileLibraryImagePicker({ onSelect, disabled, autoFocus }: { onSelect: (id: string) => void; disabled: boolean; autoFocus?: boolean }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ rows: FileRead[]; total: number }>()
  const [failed, setFailed] = useState(false)
  const pageSize = 12

  useEffect(() => {
    let active = true
    setResult(undefined)
    setFailed(false)
    const request = StudioFilesService.listFilesApiApiV1StudioFilesGet({
      q: query || undefined, fileType: 'image', page, pageSize, order: 'updated_at', isDesc: true,
    })
    void request.then(({ data }) => {
      if (!data || !Array.isArray(data.items)) throw new Error('图片列表响应无效')
      if (active) setResult({ rows: data.items, total: data.pagination.total })
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; request.cancel() }
  }, [page, query, retry])

  return <div className="file-library-image-picker">
    <Input.Search autoFocus={autoFocus} aria-label="搜索图片" placeholder="搜索图片名称" onSearch={value => { setQuery(value.trim()); setPage(1) }} />
    {failed ? <Alert type="error" message="图片列表加载失败"
      action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />
      : !result ? <Spin aria-label="正在加载图片" />
        : result.rows.length ? <div className="file-library-image-picker-grid">
          {result.rows.map(file => <Button key={file.id} disabled={disabled} onClick={() => onSelect(file.id)} title={file.name}>
            <img src={buildFileDownloadUrl(file.id)} loading="lazy" alt="" />
            <span>{file.name}</span>
          </Button>)}
        </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配图片" />}
    {result && result.total > pageSize && <Pagination current={page} pageSize={pageSize} total={result.total}
      showSizeChanger={false} onChange={setPage} />}
  </div>
}
