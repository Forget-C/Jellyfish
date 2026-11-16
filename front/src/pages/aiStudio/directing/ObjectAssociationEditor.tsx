import { useEffect, useState } from 'react'
import { Alert, Empty, Image, Input, Pagination, Skeleton, Tag } from 'antd'
import { PictureOutlined, CheckCircleFilled } from '@ant-design/icons'
import { StudioEntitiesService } from '../../../services/generated'
import { buildFileDownloadUrl, resolveAssetUrl } from '../assets/utils'
import { readResourceImages, type ResourcePicture } from '../assets/resourceImages'
import { directingError } from './common'
import { WorkbenchModal } from './ui/WorkbenchModal'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import '../assets/components/resourceCreate.css'

export type ObjectResourceChoice = { id: string; name: string; description?: string; thumbnail?: string | null }

/** 选择资源与预览图片分别操作，明确确认后才更新本场选用。 */
export function ObjectAssociationEditor({ projectId, kind, objectName, sameName, assetId, disabled, onSave, open, onClose }: {
  projectId: string; kind: 'character' | 'scene' | 'prop'; objectName: string; sameName: boolean
  open: boolean; onClose: () => void; assetId?: string | null; disabled: boolean
  onSave: (id: string) => Promise<boolean>
}) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(1)
  const [rows, setRows] = useState<ObjectResourceChoice[]>([]), [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<ObjectResourceChoice>()
  const [pictures, setPictures] = useState<ResourcePicture[]>([])
  const [loading, setLoading] = useState(true), [picturesLoading, setPicturesLoading] = useState(false)
  const [error, setError] = useState(''), [pictureError, setPictureError] = useState('')
  const [failedCovers, setFailedCovers] = useState<Record<string, boolean>>({})
  const [retry, setRetry] = useState(0), [pictureRetry, setPictureRetry] = useState(0), [pending, setPending] = useState(false)
  useEffect(() => { if (open) { setQuery(''); setPage(1); setSelected(undefined); setError(''); setPictures([]) } }, [open])
  useEffect(() => {
    if (!open) return
    let current = true
    setLoading(true); setError('')
    void StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({ entityType: kind, projectId,
      q: query, exactName: sameName ? objectName : undefined, page, pageSize: 12 })
      .then(response => { if (current) { setRows((response.data?.items ?? []) as ObjectResourceChoice[]); setTotal(response.data?.pagination.total ?? 0) } })
      .catch(cause => { if (current) setError(directingError(cause)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [open, projectId, kind, objectName, sameName, query, page, retry])
  useEffect(() => {
    if (!open || !selected) return
    let current = true
    setPictures([]); setPicturesLoading(true); setPictureError('')
    void readResourceImages(kind, selected.id).then(value => { if (current) setPictures(value.filter(image => image.file_id)) })
      .catch(cause => { if (current) setPictureError(directingError(cause)) })
      .finally(() => { if (current) setPicturesLoading(false) })
    return () => { current = false }
  }, [open, kind, selected, pictureRetry])
  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || pending || document.querySelector('.ant-image-preview-wrap:not([aria-hidden="true"])')) return
      event.preventDefault(); onClose()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [open, pending, onClose])
  const submit = async () => {
    if (!selected || pending || disabled) return
    setPending(true)
    try { if (await onSave(selected.id)) onClose(); else setError('选用未完成，请核对后重试。') }
    catch (cause) { setError(directingError(cause)) }
    finally { setPending(false) }
  }
  return <WorkbenchModal title={sameName ? '选用同名项目资源' : '选用项目资源'} open={open} width={720}
    onCancel={() => { if (!pending) onClose() }} closable={!pending} maskClosable={!pending} keyboard={!pending}
    okText="确认选用" cancelText="取消" confirmLoading={pending} okButtonProps={{ disabled: disabled || !selected || loading }} onOk={() => void submit()}>
    <div className="object-resource-picker">
      {assetId && <Alert type="info" showIcon message="重新选用将更新本场及沿用它的画布动态参考。原资源、固定图片与已受理任务会保留。" />}
      {!sameName && <Input.Search aria-label="搜索项目资源" placeholder="搜索名称或描述" allowClear onSearch={value => { setQuery(value.trim()); setPage(1) }} onChange={event => { if (!event.target.value) { setQuery(''); setPage(1) } }} disabled={pending} />}
      {error && <Alert type="error" message={error} action={<Button onClick={() => setRetry(value => value + 1)}>重试资源</Button>} />}
      {loading ? <Skeleton active title={false} paragraph={{ rows: 3 }} /> : rows.length ? <>
        <div className="resource-import-grid" role="group" aria-label="项目资源图片选择">{rows.map(row => <button key={row.id} type="button" aria-label={`选择${row.name}`} aria-pressed={selected?.id === row.id} disabled={pending} onClick={() => setSelected(row)}>
          <span className={`resource-import-cover${kind === 'scene' ? ' resource-import-cover-scene' : ''}`}>
            {resolveAssetUrl(row.thumbnail) && !failedCovers[row.id] ? <img src={resolveAssetUrl(row.thumbnail)} alt="" onError={() => setFailedCovers(current => ({ ...current, [row.id]: true }))} /> : <span><PictureOutlined aria-hidden />{failedCovers[row.id] ? '封面加载失败' : '暂无封面'}</span>}
          </span><span className="resource-import-name" title={row.name}>{row.name}</span><Tag>项目资源</Tag>
          {selected?.id === row.id && <CheckCircleFilled className="resource-import-selected" aria-hidden />}
        </button>)}</div>
        {total > 12 && <Pagination size="small" current={page} pageSize={12} total={total} showSizeChanger={false} onChange={setPage} disabled={pending} />}
      </> : !error && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到匹配的项目资源" />}
      {selected && <section className="resource-import-selection"><strong>已选资源：{selected.name}</strong><p>{selected.description || '未填写描述'}</p>
        {picturesLoading ? <Skeleton active title={false} paragraph={{ rows: 1 }} /> : pictureError ? <Alert type="warning" message={pictureError} action={<Button onClick={() => setPictureRetry(value => value + 1)}>重试图片</Button>} /> : pictures.length ? <Image.PreviewGroup><div className="resource-import-pictures">{pictures.map(picture => <Image key={picture.id} src={buildFileDownloadUrl(picture.file_id!)} alt={`${selected.name}成员图片`} />)}</div></Image.PreviewGroup> : <p>暂无图片，选用后可进入详情准备图片。</p>}
      </section>}
    </div>
  </WorkbenchModal>
}
