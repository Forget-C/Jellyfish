import { useEffect, useRef, useState } from 'react'
import { Alert, Empty, Image, Input, Pagination, Segmented, Skeleton, Tag, Modal, Button } from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import { StudioEntitiesService } from '../../../services/generated'
import { buildFileDownloadUrl, resolveAssetUrl } from '../assets/utils'
import { readResourceImages, type ResourcePicture } from '../assets/resourceImages'
import { directingError } from './common'
import { DisplayImageCard } from '../assets/components/DisplayImageCard'
import { ResourceCardMetadata } from '../assets/components/ResourceCardMetadata'
import type { LibraryAsset } from '../assets/components/AssetImageCard'
import '../assets/components/resourceCreate.css'

export type ObjectResourceChoice = LibraryAsset & { source: 'project' | 'library' }

/** 选择资源与预览图片分别操作，明确确认后才更新本场选用。 */
export function ObjectAssociationEditor({ projectId, kind, objectName, sameName, assetId, disabled, onSave, open, onClose }: {
  projectId: string; kind: 'character' | 'scene' | 'prop'; objectName: string; sameName: boolean
  open: boolean; onClose: () => void; assetId?: string | null; disabled: boolean
  onSave: (id: string) => Promise<boolean>
}) {
  const [source, setSource] = useState<'project' | 'library'>('project')
  const requestId = useRef(crypto.randomUUID()), importedId = useRef<string>()
  const [copyName, setCopyName] = useState('')
  const [query, setQuery] = useState(''), [page, setPage] = useState(1)
  const [rows, setRows] = useState<ObjectResourceChoice[]>([]), [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<ObjectResourceChoice>()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pictures, setPictures] = useState<ResourcePicture[]>([])
  const [loading, setLoading] = useState(true), [picturesLoading, setPicturesLoading] = useState(false)
  const [error, setError] = useState(''), [pictureError, setPictureError] = useState('')
  const [retry, setRetry] = useState(0), [pictureRetry, setPictureRetry] = useState(0), [pending, setPending] = useState(false)
  useEffect(() => { if (open) { setQuery(''); setPage(1); setSource('project'); setSelected(undefined); setError(''); setPictures([]); importedId.current = undefined; requestId.current = crypto.randomUUID() } }, [open])
  useEffect(() => {
    if (!open) return
    let current = true
    setLoading(true); setError('')
    const sources = sameName ? ['project', 'library'] as const : [source]
    void Promise.all(sources.map(async currentSource => {
      const response = await StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({
        entityType: currentSource === 'library' && kind === 'character' ? 'actor' : kind,
        projectId: currentSource === 'project' ? projectId : undefined,
        q: query, exactName: sameName ? objectName : undefined, page, pageSize: 12 })
      return { items: ((response.data?.items ?? []) as ObjectResourceChoice[]).map(row => ({ ...row, source: currentSource })), total: response.data?.pagination.total ?? 0 }
    })).then(results => { if (current) { setRows(results.flatMap(value => value.items)); setTotal(results.reduce((sum, value) => sum + value.total, 0)) } })
      .catch(cause => { if (current) setError(directingError(cause)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [open, projectId, kind, objectName, sameName, source, query, page, retry])
  useEffect(() => {
    if (!open || !selected) return
    let current = true
    setPictures([]); setPicturesLoading(true); setPictureError('')
    void readResourceImages(selected.source === 'library' && kind === 'character' ? 'actor' : kind, selected.id).then(value => { if (current) setPictures(value.filter(image => image.file_id)) })
      .catch(cause => { if (current) setPictureError(directingError(cause)) })
      .finally(() => { if (current) setPicturesLoading(false) })
    return () => { current = false }
  }, [open, kind, selected, pictureRetry])
  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || pending) return
      event.preventDefault()
      if (previewOpen) setPreviewOpen(false)
      else onClose()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [open, pending, previewOpen, onClose])
  const submit = async () => {
    if (!selected || pending || disabled) return
    setPending(true)
    try {
      let id = selected.id
      if (selected.source === 'library') {
        if (!importedId.current) {
          await StudioEntitiesService.createImageSourceEntityApiV1StudioEntitiesEntityTypeImageSourcePost({ entityType: kind,
            requestBody: { id: requestId.current, name: copyName.trim(), project_id: projectId, source_id: selected.id } })
          importedId.current = requestId.current
        }
        id = importedId.current
      }
      if (await onSave(id)) onClose()
      else setError(importedId.current ? '资源已导入，选用未完成。重试将使用已创建的副本，不会重复导入。' : '选用未完成，请核对后重试。')
    }
    catch (cause) { setError(directingError(cause)) }
    finally { setPending(false) }
  }
  return <Modal className="project-resource-dialog object-resource-dialog" title={sameName ? '选用同名资源' : source === 'library' ? '选用资产库资源' : '选用项目资源'} open={open} width={720}
    onCancel={() => { if (!pending) onClose() }} closable={!pending} maskClosable={!pending} keyboard={!pending && !previewOpen}
    okText={selected?.source === 'library' ? '导入并选用' : '确认选用'} cancelText="取消" confirmLoading={pending} okButtonProps={{ disabled: disabled || !selected || loading || selected.source === 'library' && !importedId.current && (!copyName.trim() || picturesLoading || !!pictureError || !pictures.length) }} onOk={() => void submit()}>
    <div className="object-resource-picker">
      <div className="object-resource-picker-toolbar">
      {assetId && <Alert type="info" showIcon message="重新选用将更新本场及沿用它的画布动态参考。原资源、固定图片与已受理任务会保留。" />}
      {!sameName && <Segmented aria-label="资源来源" value={source} options={[{ value: 'project', label: '项目资源' }, { value: 'library', label: '资产库' }]} disabled={pending || !!importedId.current} onChange={value => {
        setSource(value as typeof source); setPage(1); setSelected(undefined); setPictures([])
      }} />}
      {!sameName && <Input.Search aria-label={source === 'library' ? '搜索资产库资源' : '搜索项目资源'} placeholder="搜索名称或描述" allowClear onSearch={value => { setQuery(value.trim()); setPage(1) }} onChange={event => { if (!event.target.value) { setQuery(''); setPage(1) } }} disabled={pending || !!importedId.current} />}
      </div>
      <div className="object-resource-picker-content">
      {error && <Alert type="error" message={error} action={<Button onClick={() => setRetry(value => value + 1)}>重试资源</Button>} />}
      {loading ? <Skeleton active title={false} paragraph={{ rows: 3 }} /> : rows.length ? <>
        <div className="object-resource-grid" role="group" aria-label={sameName ? '同名资源图片选择' : source === 'library' ? '资产库图片选择' : '项目资源图片选择'}>{rows.map(row => <DisplayImageCard key={`${row.source}:${row.id}`} variant="project"
          title={<span title={row.name}>{row.name}</span>} imageUrl={resolveAssetUrl(row.thumbnail)} imageAlt={row.name}
          imageFit={kind === 'scene' ? 'cover' : 'contain'} enablePreview={false}
          selection={{ label: `选择${row.name}`, selected: selected?.id === row.id && selected.source === row.source, disabled: pending || !!importedId.current,
            onSelect: () => { if (selected?.id === row.id && selected.source === row.source) return; setSelected(row); setCopyName(row.name); setPictures([]); setPicturesLoading(true); setPictureError(''); requestId.current = crypto.randomUUID() } }}
          extra={<><Tag>{row.source === 'project' ? '项目资源' : '资产库'}</Tag>{selected?.id === row.id && selected.source === row.source && <CheckCircleFilled aria-label="已选中" />}</>}
          meta={<><ResourceCardMetadata asset={row} /><div className="project-resource-description" title={row.description ?? undefined}>{row.description?.trim() || '未填写简介'}</div></>}
        />)}</div>
        {total > 12 && <Pagination size="small" current={page} pageSize={12} total={total} showSizeChanger={false} onChange={setPage} disabled={pending || !!importedId.current} />}
      </> : !error && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={sameName ? '未找到同名资源' : source === 'library' ? '未找到匹配的资产库资源' : '未找到匹配的项目资源'} />}
      {selected && <section className="resource-import-selection"><strong>已选资源：{selected.name}</strong><p>{selected.description || '未填写描述'}</p>
        {selected.source === 'library' && <><p>将复制全部有效图片创建独立项目副本，后续修改与资产库独立保存。若项目已有同名对象，请修改副本名称或返回选用已有项目资源。</p><label>副本名称<Input aria-label="副本名称" maxLength={255} value={copyName} disabled={pending || !!importedId.current} onChange={event => setCopyName(event.target.value)} /></label></>}
        {picturesLoading ? <Skeleton active title={false} paragraph={{ rows: 1 }} /> : pictureError ? <Alert type="warning" message={pictureError} action={<Button onClick={() => setPictureRetry(value => value + 1)}>重试图片</Button>} /> : pictures.length ? <Image.PreviewGroup preview={{ visible: previewOpen, onVisibleChange: setPreviewOpen }}><div className="resource-import-pictures">{pictures.map(picture => <Image key={picture.id} src={buildFileDownloadUrl(picture.file_id!)} alt={`${selected.name}成员图片`} />)}</div></Image.PreviewGroup> : <p>{selected.source === 'library' ? '来源没有有效图片，无法导入。' : '暂无图片，选用后可进入详情准备图片。'}</p>}
      </section>}
      </div>
    </div>
  </Modal>
}
