import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Empty, Input, Modal, Pagination, Space, Spin } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { StudioFilesService, type FileRead } from '../../../../../services/generated'
import { buildFileDownloadUrl } from '../../../assets/utils'
import { ProjectCover } from '../../ProjectCover'

export type CoverDraft = File | string | null | undefined

/** 展示封面草稿，上传与采用均由设置表单保存。 */
export function ProjectCoverField({ projectId, savedId, draft, disabled, onChange }: {
  projectId: string
  savedId?: string | null
  draft: CoverDraft
  disabled: boolean
  onChange: (draft: CoverDraft) => void
}) {
  const upload = useRef<HTMLInputElement>(null)
  const [library, setLibrary] = useState(false)
  const [preview, setPreview] = useState<string>()
  const [error, setError] = useState('')
  const localFile = draft instanceof File ? draft : undefined
  const fileId = draft === undefined ? savedId : typeof draft === 'string' ? draft : undefined
  const hasCover = Boolean(fileId || localFile)

  useEffect(() => {
    if (!localFile) return
    const url = URL.createObjectURL(localFile)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [localFile])

  useEffect(() => { setError('') }, [draft])

  return <div className="project-settings-cover">
    <h3>项目封面</h3>
    <ProjectCover projectId={projectId} source={localFile ? preview : buildFileDownloadUrl(fileId)}
      alt={hasCover ? '项目封面预览' : undefined} />
    <Space wrap size={4}>
      <Dropdown trigger={['click']} disabled={disabled} menu={{
        items: [{ key: 'upload', label: '上传图片' }, { key: 'library', label: '从文件管理选择' }],
        onClick: ({ key }) => {
          if (key === 'upload') upload.current?.click()
          else setLibrary(true)
        },
      }}>
        <Button disabled={disabled}>{hasCover ? '更换封面' : '设置封面'} <DownOutlined aria-hidden /></Button>
      </Dropdown>
      {hasCover && <Button type="link" disabled={disabled} onClick={() => onChange(savedId ? null : undefined)}>恢复默认封面</Button>}
    </Space>
    {error && <Alert type="error" message={error} />}
    <input ref={upload} type="file" hidden disabled={disabled} aria-label="上传项目封面" accept=".jpg,.jpeg,.png,.webp,.gif"
      onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        if (file.size > 20 * 1024 * 1024) { setError('封面图片不能超过 20 MB'); return }
        if (!/\.(jpe?g|png|webp|gif)$/i.test(file.name)) { setError('请选择 JPG、PNG、WebP 或 GIF 图片'); return }
        setError('')
        onChange(file)
      }} />
    <Modal open={library} title="从文件管理选择图片" onCancel={() => setLibrary(false)} footer={null} destroyOnClose>
      {library && <CoverLibrary onSelect={id => { onChange(id); setLibrary(false) }} disabled={disabled} />}
    </Modal>
  </div>
}

function CoverLibrary({ onSelect, disabled }: { onSelect: (id: string) => void; disabled: boolean }) {
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

  return <div className="project-cover-library">
    <Input.Search aria-label="搜索图片" placeholder="搜索图片名称" onSearch={value => { setQuery(value.trim()); setPage(1) }} />
    {failed ? <Alert type="error" message="图片列表加载失败"
      action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />
      : !result ? <Spin aria-label="正在加载图片" />
        : result.rows.length ? <div className="project-cover-library-grid">
          {result.rows.map(file => <Button key={file.id} disabled={disabled} onClick={() => onSelect(file.id)} title={file.name}>
            <img src={buildFileDownloadUrl(file.id)} loading="lazy" alt="" />
            <span>{file.name}</span>
          </Button>)}
        </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配图片" />}
    {result && result.total > pageSize && <Pagination current={page} pageSize={pageSize} total={result.total}
      showSizeChanger={false} onChange={setPage} />}
  </div>
}
