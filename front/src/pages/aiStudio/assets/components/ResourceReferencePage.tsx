import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Image, Input, Pagination, Select, Space, Spin, Upload } from 'antd'
import { StudioEntitiesService, StudioFilesService, type AssetPromptReference } from '../../../../services/generated'
import { readResourceImages } from '../resourceImages'
import { buildFileDownloadUrl } from '../utils'
import type { ResourceKind } from './ResourceEditorDrawer'

type Source = { id: string; name: string; thumbnail?: string }
type Picture = { id: number; file_id?: string; view_angle?: string; is_primary?: boolean }
const labels = { actor: '演员', character: '角色', scene: '场所', prop: '道具', costume: '服装' }
const angleLabels: Record<string, string> = { FRONT: '正面', LEFT: '侧面', RIGHT: '右侧', TOP: '俯视', BACK: '背面', THREE_QUARTER: '3/4 侧面', DETAIL: '细节' }

/** 在当前抽屉中选来源及具体图片，提交前始终使用独立的临时选择。 */
export function ResourceReferencePage({ kind, projectId, purpose, value, onApply, onCancel }: {
  kind: ResourceKind; projectId?: string | null; purpose: 'subject' | 'costume' | 'prop'
  value: AssetPromptReference[]; onApply: (value: AssetPromptReference[]) => void; onCancel: () => void
}) {
  const [scope, setScope] = useState<'project' | 'library'>('library')
  const [sourceKind, setSourceKind] = useState<ResourceKind>(purpose === 'subject' ? kind === 'character' ? 'actor' : kind : purpose)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [sources, setSources] = useState<Source[]>([])
  const [source, setSource] = useState<Source>()
  const [pictures, setPictures] = useState<Picture[]>([])
  const [selected, setSelected] = useState(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const request = useRef(0)
  const role: AssetPromptReference['role'] = purpose !== 'subject' ? purpose
    : kind === 'actor' || kind === 'character' ? 'identity' : kind === 'scene' ? 'layout' : 'design'
  const belongs = (reference: AssetPromptReference) => purpose === 'subject'
    ? !['costume', 'prop'].includes(reference.role) : reference.role === purpose

  useEffect(() => {
    let active = true
    setBusy(true); setError(''); setSource(undefined); setPictures([]); request.current++
    void StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({ entityType: sourceKind,
      projectId: scope === 'project' ? projectId : undefined, q: query, page, pageSize: 12,
    }).then(response => {
      if (!active) return
      setSources((response.data?.items ?? []) as Source[]); setTotal(response.data?.pagination.total ?? 0)
    }).catch(() => { if (active) setError('读取参考对象失败') }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [sourceKind, scope, projectId, query, page, retry])

  const chooseSource = async (next: Source) => {
    const token = ++request.current
    setSource(next); setPictures([]); setBusy(true); setError('')
    try {
      const rows = await readResourceImages(sourceKind, next.id)
      if (token !== request.current) return
      const images = rows.filter(image => image.file_id) as Picture[]
      setPictures(images)
      if (!selected.some(reference => reference.source_id === next.id && reference.source_kind === sourceKind)) {
        const main = images.find(image => image.is_primary) ?? images[0]
        setSelected(current => [...current.filter(reference => purpose === 'prop' || !belongs(reference)),
          ...(main?.file_id ? [{ file_id: main.file_id, role, source_kind: sourceKind, source_id: next.id, source_image_id: main.id, view_angle: main.view_angle as AssetPromptReference['view_angle'] }] : [])])
      }
    } catch { if (token === request.current) setError('读取对象图片失败，请重新选择或重试') }
    finally { if (token === request.current) setBusy(false) }
  }
  return <div className="resource-editor-fields">
    <Space wrap>
      <Button onClick={onCancel}>返回</Button>
      <Select aria-label="参考来源范围" value={scope} options={[
        ...(projectId ? [{ value: 'project', label: '项目资源' }] : []), { value: 'library', label: '资产库' },
      ]} onChange={next => { setScope(next); setPage(1); if (next === 'library' && sourceKind === 'character') setSourceKind('actor') }} />
      {purpose === 'subject' && (kind === 'actor' || kind === 'character') && <Select aria-label="参考主体类别" value={sourceKind}
        options={[{ value: 'actor', label: '演员' }, ...(projectId && scope === 'project' ? [{ value: 'character', label: '角色' }] : [])]}
        onChange={next => { setSourceKind(next); setPage(1) }} />}
      <Upload accept="image/*" showUploadList={false} beforeUpload={file => {
        setBusy(true); setError('')
        void StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: file as unknown as string } })
          .then(response => { if (response.data) setSelected(current => [...current, { file_id: response.data!.id, role }]) })
          .catch(() => setError('上传参考图失败，请重试')).finally(() => setBusy(false))
        return false
      }}><Button disabled={busy}>上传参考图</Button></Upload>
    </Space>
    <Input.Search aria-label="搜索参考对象" placeholder="搜索参考对象" onSearch={text => { setQuery(text); setPage(1) }} />
    {error && <Alert type="error" message={error} action={<Button onClick={() => source ? void chooseSource(source) : setRetry(value => value + 1)}>重试</Button>} />}
    <Spin spinning={busy}>
      <div className="resource-reference-grid">{sources.map(item => <Button key={item.id} className="resource-reference-tile"
        aria-label={`选择参考${labels[sourceKind]} ${item.name}`} onClick={() => void chooseSource(item)}>
        {item.thumbnail && <img src={item.thumbnail} alt="" />}<span>{item.name}</span>
      </Button>)}</div>
      <Pagination size="small" current={page} pageSize={12} total={total} onChange={setPage} showSizeChanger={false} />
      {source && <><h3>{source.name} · 选择具体图片</h3>{!pictures.length && !busy && <p>当前对象还没有可用图片。</p>}
        <div className="resource-reference-grid">{pictures.map((picture, index) => {
          const checked = selected.some(reference => reference.file_id === picture.file_id && reference.source_id === source.id && reference.source_image_id === picture.id && reference.role === role)
          return <Button key={picture.id} className="resource-reference-tile" aria-pressed={checked}
            aria-label={`选择${angleLabels[picture.view_angle ?? 'FRONT'] ?? picture.view_angle}图片 ${index + 1}`}
            onClick={() => setSelected(current => checked ? current.filter(reference => !(reference.file_id === picture.file_id && reference.source_id === source.id && reference.source_image_id === picture.id && reference.role === role))
              : [...current, { file_id: picture.file_id!, role, source_kind: sourceKind, source_id: source.id, source_image_id: picture.id, view_angle: picture.view_angle as AssetPromptReference['view_angle'] }])}>
            <Image preview={false} src={buildFileDownloadUrl(picture.file_id!)} alt="" />
            <span>{angleLabels[picture.view_angle ?? 'FRONT'] ?? picture.view_angle}{picture.is_primary ? ' · 主图' : ''}{checked ? ' · 已选' : ''}</span>
          </Button>
        })}</div></>}
    </Spin>
    <p>已选择 {selected.filter(belongs).length} 张图片；点击使用后回填草稿。</p>
    <Space><Button aria-label="取消" onClick={onCancel}>取消</Button><Button type="primary" disabled={busy} onClick={() => onApply(selected)}>使用所选图片</Button></Space>
  </div>
}
