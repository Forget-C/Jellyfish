import { useUiText } from '../../../../uiText'
import { useEffect, useId, useRef, useState } from 'react'
import { Alert, Empty, Image, Input, Pagination, Segmented, Skeleton, Tag, Button } from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import { StudioEntitiesService } from '../../../../services/generated'
import { buildFileDownloadUrl, resolveAssetUrl } from '../utils'
import { readResourceImages, type ResourcePicture } from '../resourceImages'
import { apiErrorMessage } from '../../../../services/apiErrorMessage'
import { DisplayImageCard } from './DisplayImageCard'
import { ResourceCardMetadata } from './ResourceCardMetadata'
import type { LibraryAsset } from './AssetImageCard'
import './resourceCreate.css'
import { ResourceEditorFrame } from './ResourceEditorFrame'
import { AssetDetailLeaveGuard } from './AssetDetailLeaveGuard'
import { useWorkspaceDraft, useWorkspaceDraftStatus } from '../../directing/WorkspaceDrafts'
import type { ResourceKind } from './ResourceEditorDrawer'

const viewLabels: Record<string, string> = { FRONT: '正面', LEFT: '侧面', TOP: '俯视', BACK: '背面' }

export type ResourceChoice = LibraryAsset & { source: 'project' | 'library' }
/** created locks the chosen source after a partial commit so retry cannot create another copy. */
export type ResourceSelectionResult = { complete: boolean; created?: boolean; error?: string }
type Props = {
  mode: 'import' | 'select' | 'same-name'; projectId: string; kind: ResourceKind; objectName?: string
  assetId?: string | null; disabled?: boolean; onClose: () => void
  onConfirm: (choice: ResourceChoice, name: string, requestId: string) => Promise<ResourceSelectionResult>
}

/** One drawer session owns querying and selection; callers own resource creation and scene binding. */
export function ResourceSelectionDrawer({ mode, projectId, kind, objectName, assetId, disabled = false, onConfirm, onClose }: Props) {
  const uiText = useUiText()
  const id = useId()
  const importing = mode === 'import'
  const [sameName, setSameName] = useState(mode === 'same-name')
  const [source, setSource] = useState<'project' | 'library'>(importing ? 'library' : 'project')
  const requestId = useRef(crypto.randomUUID()), lock = useRef(false), accepted = useRef(false)
  const [created, setCreated] = useState(false), [closeRequested, setCloseRequested] = useState(false)
  const [copyName, setCopyName] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState(''), [page, setPage] = useState(1)
  const [rows, setRows] = useState<ResourceChoice[]>([]), [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<ResourceChoice>()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pictures, setPictures] = useState<ResourcePicture[]>([])
  const [loading, setLoading] = useState(true), [picturesLoading, setPicturesLoading] = useState(false)
  const [error, setError] = useState(''), [pictureError, setPictureError] = useState('')
  const [retry, setRetry] = useState(0), [pictureRetry, setPictureRetry] = useState(0), [pending, setPending] = useState(false)
  useEffect(() => {
    let current = true
    setLoading(true); setError('')
    const sources = sameName ? ['project', 'library'] as const : [source]
    void Promise.all(sources.map(async currentSource => {
      const response = await StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({
        entityType: currentSource === 'library' && kind === 'character' ? 'actor' : kind,
        projectId: currentSource === 'project' ? projectId : undefined,
        q: query, exactName: sameName ? objectName : undefined, page, pageSize: 12 })
      return { items: ((response.data?.items ?? []) as ResourceChoice[]).map(row => ({ ...row, source: currentSource })), total: response.data?.pagination.total ?? 0 }
    })).then(results => { if (current) { setRows(results.flatMap(value => value.items)); setTotal(sameName ? Math.max(...results.map(value => value.total)) : results[0].total) } })
      .catch(cause => { if (current) setError(apiErrorMessage(cause)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [projectId, kind, objectName, sameName, source, query, page, retry])
  useEffect(() => {
    if (!selected) return
    let current = true
    setPictures([]); setPicturesLoading(true); setPictureError('')
    void readResourceImages(selected.source === 'library' && kind === 'character' ? 'actor' : kind, selected.id).then(value => { if (current) setPictures(value.filter(image => image.file_id)) })
      .catch(cause => { if (current) setPictureError(apiErrorMessage(cause)) })
      .finally(() => { if (current) setPicturesLoading(false) })
    return () => { current = false }
  }, [kind, selected, pictureRetry])
  const blocked = disabled || !selected || loading || selected.source === 'library' && !created && (!copyName.trim() || picturesLoading || !!pictureError || !pictures.length)
  const submit = async () => {
    if (lock.current || blocked || !selected) return false
    lock.current = true; setPending(true); setError('')
    try {
      const result = await onConfirm(selected, copyName.trim(), requestId.current)
      if (result.created) setCreated(true)
      if (result.complete) { accepted.current = true; return true }
      setError(result.error || uiText("操作未完成，请重试。"))
      return false
    } catch (cause) { setError(apiErrorMessage(cause)); return false }
    finally { lock.current = false; setPending(false) }
  }
  const title = uiText(importing ? '从资产库导入' : sameName ? '选用同名资源' : source === 'library' ? '选用资产库资源' : '选用项目资源')
  const dirty = !accepted.current && (created || selected?.source === 'library')
  const host = useWorkspaceDraftStatus()
  useWorkspaceDraft({ name: title, dirty, busy: pending, save: submit, discard: onClose })
  const close = () => { if (previewOpen || lock.current) return; if (dirty) setCloseRequested(true); else onClose() }
  const action = uiText(importing ? created ? '重试刷新' : '导入' : selected?.source === 'library' ? '导入并选用' : '确认选用')
  return <><ResourceEditorFrame id={id} open drawer drawerWidth={720} className="resource-selection-drawer" title={title} backLabel={uiText("返回")} onClose={close}
    actions={<Button type="primary" aria-label={action} loading={pending} disabled={blocked} onClick={async () => { if (await submit()) onClose() }}>{action}</Button>}>
    <div className="object-resource-picker resource-import-form resource-editor-fields">
      <div className="object-resource-picker-toolbar">
      {importing && <p>{uiText("复制全部有效图片，后续修改与资产库独立保存。")}</p>}
      {assetId && <Alert type="info" showIcon message={uiText("重新选用将更新本场及沿用它的画布动态参考。原资源、固定图片与已受理任务会保留。")} />}
      {!importing && !sameName && <Segmented aria-label={uiText("资源来源")} value={source} options={[{ value: 'project', label: uiText("项目资源") }, { value: 'library', label: uiText("资产库") }]} disabled={pending || created} onChange={value => {
        setSource(value as typeof source); setSearch(''); setQuery(''); setPage(1); setSelected(undefined); setPictures([])
      }} />}
      {!sameName && <Input.Search value={search} aria-label={importing ? uiText("搜索来源资产") : source === 'library' ? uiText("搜索资产库资源") : uiText("搜索项目资源")} placeholder={uiText("搜索名称或描述")} allowClear onSearch={value => { setQuery(value.trim()); setPage(1) }} onChange={event => { setSearch(event.target.value); if (!event.target.value) { setQuery(''); setPage(1) } }} disabled={pending || created} />}
      {sameName && <Button disabled={pending || created} onClick={() => { setSameName(false); setPage(1); setSelected(undefined); setPictures([]) }}>{uiText("选用其他资源")}</Button>}
      </div>
      <div className="object-resource-picker-content resource-import-content">
      {error && <Alert type="error" message={error} action={<Button disabled={pending} onClick={() => setRetry(value => value + 1)}>{importing ? uiText("重试来源") : uiText("重试资源")}</Button>} />}
      {loading ? <Skeleton active title={false} paragraph={{ rows: 3 }} /> : rows.length ? <>
        <div className="object-resource-grid" role="group" aria-label={sameName ? uiText("同名资源图片选择") : source === 'library' ? uiText("资产库图片选择") : uiText("项目资源图片选择")}>{rows.map(row => <DisplayImageCard key={`${row.source}:${row.id}`} variant="project"
          title={<span title={row.name}>{row.name}</span>} imageUrl={resolveAssetUrl(row.thumbnail)} imageAlt={row.name}
          imageFit={kind === 'scene' ? 'cover' : 'contain'} enablePreview={false}
          selection={{ label: uiText("选择{{name}}", { name: row.name }), selected: selected?.id === row.id && selected.source === row.source, disabled: pending || created,
            onSelect: () => { if (selected?.id === row.id && selected.source === row.source) return; setSelected(row); setCopyName(row.name); setPictures([]); setPicturesLoading(true); setPictureError(''); requestId.current = crypto.randomUUID() } }}
          extra={<><Tag>{row.source === 'project' ? uiText("项目资源") : uiText("资产库")}</Tag>{selected?.id === row.id && selected.source === row.source && <CheckCircleFilled aria-label={uiText("已选中")} />}</>}
          meta={<><ResourceCardMetadata asset={row} /><div className="project-resource-description" title={row.description ?? undefined}>{row.description?.trim() || uiText("未填写简介")}</div></>}
        />)}</div>
        {total > 12 && <Pagination size="small" current={page} pageSize={12} total={total} showSizeChanger={false} onChange={setPage} disabled={pending || created} />}
      </> : !error && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={sameName ? uiText("未找到同名资源") : source === 'library' ? importing ? query ? uiText("未找到匹配的资产") : uiText("资产库暂无可导入资产") : uiText("未找到匹配的资产库资源") : uiText("未找到匹配的项目资源")} />}
      {selected && <section className="resource-import-selection"><strong>{uiText("已选资源：")}{selected.name}</strong><p>{selected.description || uiText("未填写描述")}</p>
        {selected.source === 'library' && <><p>{uiText("将复制全部有效图片创建独立项目副本，后续修改与资产库独立保存。若项目已有同名对象，请修改副本名称或返回选用已有项目资源。")}</p><label>{importing ? uiText("名称") : uiText("副本名称")}<Input aria-label={importing ? uiText("名称") : uiText("副本名称")} maxLength={255} value={copyName} disabled={pending || created} onChange={event => setCopyName(event.target.value)} /></label></>}
        {picturesLoading ? <Skeleton active title={false} paragraph={{ rows: 1 }} /> : pictureError ? <Alert type="warning" message={pictureError} action={<Button disabled={pending} onClick={() => setPictureRetry(value => value + 1)}>{uiText("重试图片")}</Button>} /> : pictures.length ? <Image.PreviewGroup preview={{ visible: previewOpen, onVisibleChange: setPreviewOpen }}><div className="resource-import-pictures">{pictures.map(picture => <figure key={picture.id}><Image src={buildFileDownloadUrl(picture.file_id!)} alt={importing ? uiText("来源图片 {{id}}", { id: picture.id }) : uiText("{{name}}成员图片", { name: selected.name })} /><figcaption>{uiText(viewLabels[picture.view_angle ?? ''] ?? picture.view_angle ?? "图片")}{picture.is_primary ? uiText(" · 主图") : ''}</figcaption></figure>)}</div></Image.PreviewGroup> : <p>{selected.source === 'library' ? importing ? uiText("来源没有有效图片，暂时不能导入。") : uiText("来源没有有效图片，无法导入。") : uiText("暂无图片，选用后可进入详情准备图片。")}</p>}
      </section>}
      </div>
    </div>
  </ResourceEditorFrame>
    <AssetDetailLeaveGuard navigationManaged={host.managed} dirty={dirty} busy={pending} detecting={false} canCancelDetection={false} cancellingDetection={false} partialSave={false}
      closeRequested={closeRequested} onContinue={() => setCloseRequested(false)} onClose={onClose} save={submit} cancelDetection={async () => true} />
  </>
}
