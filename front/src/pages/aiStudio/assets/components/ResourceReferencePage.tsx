import { CheckCircleFilled } from '@ant-design/icons'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Image, Input, Pagination, Segmented, Select, Space, Spin, Tag, Upload } from 'antd'
import { StudioEntitiesService, StudioFilesService, type AssetPromptReference } from '../../../../services/generated'
import { StudioEntitiesApi } from '../../../../services/studioEntities'
import { readResourceImages } from '../resourceImages'
import { buildFileDownloadUrl, resolveAssetUrl } from '../utils'
import { DisplayImageCard } from './DisplayImageCard'
import { ResourceCardMetadata } from './ResourceCardMetadata'
import type { LibraryAsset } from './AssetImageCard'
import type { ResourceKind } from './ResourceEditorDrawer'
import './resourceCreate.css'

type Picture = { id: number; file_id?: string; view_angle?: string; is_primary?: boolean }
const angleLabels: Record<string, string> = { FRONT: '正面', LEFT: '侧面', RIGHT: '右侧', TOP: '俯视', BACK: '背面', THREE_QUARTER: '3/4 侧面', DETAIL: '细节' }

/** 一次会话只编辑当前用途，应用前保留独立选择；其他用途原样带回。 */
export function ResourceReferencePage({ kind, projectId, purpose, value, onApply, onCancel, toolbarTarget, onNames, onUploading, onPreview, returnLabel }: {
  returnLabel?: string
  onPreview?: (open: boolean) => void
  onNames?: (names: Record<string, string>) => void; onUploading?: (uploading: boolean) => void
  toolbarTarget?: HTMLElement | null
  kind: ResourceKind; projectId?: string | null; purpose: 'subject' | 'costume' | 'prop'
  value: AssetPromptReference[]; onApply: (value: AssetPromptReference[]) => void; onCancel: () => void
}) {
  const [scope, setScope] = useState<'project' | 'library'>('library')
  const [sourceKind, setSourceKind] = useState<ResourceKind>(purpose === 'subject' ? kind === 'character' ? 'actor' : kind : purpose)
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(1)
  const [total, setTotal] = useState(0), [sources, setSources] = useState<LibraryAsset[]>([])
  const [source, setSource] = useState<LibraryAsset>(), [pictures, setPictures] = useState<Picture[]>([])
  const [view, setView] = useState<'resources' | 'pictures' | 'selected'>('resources')
  const [selected, setSelected] = useState(value), [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState('')
  const [uploadError, setUploadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!uploading) root.current?.focus() }, [uploading])
  const request = useRef(0), content = useRef<HTMLDivElement>(null), scroll = useRef(0), mounted = useRef(true)
  const role: AssetPromptReference['role'] = purpose !== 'subject' ? purpose : kind === 'actor' || kind === 'character' ? 'identity' : kind === 'scene' ? 'layout' : 'design'
  const belongs = (reference: AssetPromptReference) => purpose === 'subject' ? !['costume', 'prop'].includes(reference.role) : reference.role === purpose
  const chosen = selected.filter(belongs)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    const sources = new Map(value.filter(item => item.source_kind && item.source_id).map(item => [`${item.source_kind}:${item.source_id}`, item]))
    for (const [key, item] of sources) void StudioEntitiesApi.get(item.source_kind!, item.source_id!).then(response => {
      if (active && response.data) setNames(current => ({ ...current, [key]: response.data!.name }))
    }).catch(() => { /* Deleted sources retain their unnamed label. */ })
    return () => { active = false }
  }, [value])
  useEffect(() => {
    let active = true
    setBusy(true); setError(''); setUploadError(false)
    void StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({ entityType: sourceKind, projectId: scope === 'project' ? projectId : undefined, q: query, page, pageSize: 12 })
      .then(response => { if (active) { setSources((response.data?.items ?? []) as LibraryAsset[]); setTotal(response.data?.pagination.total ?? 0) } })
      .catch(() => { if (active) setError('读取参考对象失败') }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [sourceKind, scope, projectId, query, page, retry])
  const rememberNames = (next: Record<string, string>) => { setNames(current => ({ ...current, ...next })); onNames?.(next) }
  const chooseSource = async (next: LibraryAsset) => {
    const token = ++request.current
    if (view === 'resources') scroll.current = content.current?.scrollTop ?? 0
    setView('pictures'); setSource(next); setPictures([]); setBusy(true); setError(''); setUploadError(false)
    rememberNames({ [`${sourceKind}:${next.id}`]: next.name })
    try {
      const rows = await readResourceImages(sourceKind, next.id)
      if (mounted.current && token === request.current) setPictures(rows.filter(image => image.file_id) as Picture[])
    } catch { if (mounted.current && token === request.current) setError('读取对象图片失败，请重试') }
    finally { if (mounted.current && token === request.current) setBusy(false) }
  }
  const back = () => { request.current++; setBusy(false); setError(''); setView('resources'); requestAnimationFrame(() => { if (content.current) content.current.scrollTop = scroll.current }) }
  const toggle = (reference: AssetPromptReference) => setSelected(current => current.some(item => item.file_id === reference.file_id && belongs(item))
    ? current.filter(item => !(item.file_id === reference.file_id && belongs(item))) : [...current, reference])
  const actions = <div className="reference-picker-footer"><Space><span>已选 {chosen.length} 张</span><Button disabled={uploading} onClick={() => { if (view === 'resources') scroll.current = content.current?.scrollTop ?? 0; request.current++; setBusy(false); setError(''); setView('selected') }}>查看已选</Button></Space><Space><Button disabled={uploading} onClick={onCancel}>{returnLabel ?? '返回生成'}</Button><Button type="primary" disabled={uploading || busy} onClick={() => onApply(selected)}>应用参考</Button></Space></div>
  return <div className="resource-editor-fields resource-reference-page" ref={root} tabIndex={-1}>
    <div className="resource-reference-toolbar">
      {view === 'resources' ? <><Space wrap><Segmented aria-label="参考来源范围" value={scope} disabled={uploading} options={[...(projectId ? [{ value: 'project', label: '项目资源' }] : []), { value: 'library', label: '资产库' }]} onChange={next => { setScope(next as typeof scope); setSearch(''); setQuery(''); setPage(1); if (next === 'library' && sourceKind === 'character') setSourceKind('actor') }} />
        {purpose === 'subject' && (kind === 'actor' || kind === 'character') && <Select aria-label="参考主体类别" value={sourceKind} disabled={uploading} options={[{ value: 'actor', label: '演员' }, ...(projectId && scope === 'project' ? [{ value: 'character', label: '角色' }] : [])]} onChange={next => { setSourceKind(next); setPage(1) }} />}
        <Upload accept="image/*" showUploadList={false} disabled={uploading} beforeUpload={file => {
          setUploading(true); onUploading?.(true); setError(''); setUploadError(false)
          void StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: file as unknown as string } })
            .then(response => { if (mounted.current && response.data) { rememberNames({ [response.data.id]: file.name }); setSelected(current => [...current, { file_id: response.data!.id, role }]) } })
            .catch(() => { if (mounted.current) { setError('上传参考图失败，请重新上传'); setUploadError(true) } }).finally(() => { if (mounted.current) { setUploading(false); onUploading?.(false) } })
          return false
        }}><Button loading={uploading}>上传参考图</Button></Upload></Space>
        <Input.Search value={search} disabled={uploading} allowClear aria-label="搜索参考对象" placeholder="搜索名称或描述" onChange={event => { setSearch(event.target.value); if (!event.target.value) { setQuery(''); setPage(1) } }} onSearch={text => { setQuery(text.trim()); setPage(1) }} /></>
        : <Space wrap><Button disabled={uploading} onClick={back}>返回资源列表</Button><strong>{view === 'pictures' ? source?.name : '已选参考图片'}</strong>{view === 'pictures' && <Tag>{scope === 'project' ? '项目资源' : '资产库'}</Tag>}</Space>}
    </div>
    <div className="resource-reference-content" ref={content}>
      {error && <Alert type="error" message={error} action={!uploading && !uploadError && <Button onClick={() => view === 'pictures' && source ? void chooseSource(source) : setRetry(value => value + 1)}>重试</Button>} />}
      <Spin spinning={busy}>
        {view === 'resources' ? <><div className="object-resource-grid">{sources.map(item => <DisplayImageCard key={item.id} variant="project" title={<span title={item.name}>{item.name}</span>} imageUrl={resolveAssetUrl(item.thumbnail)} imageAlt={item.name} imageFit={sourceKind === 'scene' ? 'cover' : 'contain'} enablePreview={false}
          selection={{ label: `浏览参考资源 ${item.name}`, selected: chosen.some(reference => reference.source_kind === sourceKind && reference.source_id === item.id), disabled: uploading, onSelect: () => void chooseSource(item) }}
          extra={<><Tag>{scope === 'project' ? '项目资源' : '资产库'}</Tag>{chosen.some(reference => reference.source_kind === sourceKind && reference.source_id === item.id) && <CheckCircleFilled aria-label="包含已选参考" />}</>} meta={<><ResourceCardMetadata asset={item} /><div className="project-resource-description" title={item.description ?? undefined}>{item.description?.trim() || '未填写简介'}</div></>} />)}</div>
          {!busy && !sources.length && !error && <Empty description="未找到匹配的资源" />}{total > 12 && <Pagination size="small" current={page} pageSize={12} total={total} disabled={uploading} onChange={setPage} showSizeChanger={false} />}</>
          : <div className="reference-picture-grid">{(view === 'pictures' ? pictures.map(picture => ({ file_id: picture.file_id!, role, source_kind: sourceKind, source_id: source!.id, source_image_id: picture.id, view_angle: picture.view_angle as AssetPromptReference['view_angle'] })) : chosen).map((reference, index) => {
            const checked = chosen.some(item => item.file_id === reference.file_id)
            const title = names[`${reference.source_kind}:${reference.source_id}`] ?? names[reference.file_id] ?? '未命名参考'
            return <div className="reference-picture" key={`${reference.file_id}:${index}`}><Image preview={{ onVisibleChange: open => onPreview?.(open) }} src={buildFileDownloadUrl(reference.file_id)} alt={title} /><span title={title}>{title}</span><span>{angleLabels[reference.view_angle ?? ''] ?? reference.view_angle ?? '图片'}{view === 'pictures' && pictures[index]?.is_primary ? ' · 主图' : ''}</span><Button aria-label={view === 'selected' ? '移除' : checked ? '取消选择' : '选择图片'} disabled={uploading} aria-pressed={checked} onClick={() => toggle(reference)}>{view === 'selected' ? '移除' : checked ? '取消选择' : '选择图片'}</Button></div>
          })}{!busy && !(view === 'pictures' ? pictures.length : chosen.length) && !error && <Empty description={view === 'pictures' ? '当前资源暂无可用图片' : '当前用途尚未选择图片'} />}</div>}
      </Spin>
    </div>
    <div className="resource-reference-actions">{toolbarTarget ? createPortal(actions, toolbarTarget) : actions}</div>
  </div>
}
