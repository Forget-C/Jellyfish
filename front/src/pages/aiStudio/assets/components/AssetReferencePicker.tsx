import { useState } from 'react'
import { Button, Image, Input, Modal, Pagination, Select, Space, Spin, Upload, message } from 'antd'
import { StudioFilesService, type AssetPromptReference, type FileRead } from '../../../../services/generated'
import { buildFileDownloadUrl } from '../utils'

const ROLE_OPTIONS: { value: AssetPromptReference['role']; label: string }[] = [
  { value: 'identity', label: '人物身份' }, { value: 'costume', label: '服装' },
  { value: 'prop', label: '道具' }, { value: 'layout', label: '场景布局' },
  { value: 'style', label: '画风' }, { value: 'design', label: '主体设计' },
]

/** 选择替代参考图并声明用途；仅更新生成表单，不提交生图任务。 */
export function AssetReferencePicker({ value, onChange }: {
  value: AssetPromptReference[] | null | undefined
  onChange: (next: AssetPromptReference[] | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<FileRead[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const fileIds = [...new Set((value ?? []).map((reference) => reference.file_id))]

  /** 分页查询已有文件，避免仅展示首批素材导致其他参考图无法选择。 */
  const loadFiles = async (nextPage: number, search = query) => {
    setLoading(true)
    try {
      const response = await StudioFilesService.listFilesApiApiV1StudioFilesGet({ page: nextPage, pageSize: 20, q: search })
      setFiles((response.data?.items ?? []).filter((file) => file.type === 'image'))
      setTotal(response.data?.pagination.total ?? 0)
      setPage(nextPage)
    } catch {
      message.error('读取图片素材失败')
    } finally {
      setLoading(false)
    }
  }

  /** 新增文件默认作为设计参考，用户可在可见控件中进一步指定用途。 */
  const addFile = (fileId: string) => {
    if (fileIds.includes(fileId)) return
    onChange([...(value ?? []), { file_id: fileId, role: 'design' }])
  }

  return (
    <div className="space-y-2">
      <Space wrap>
        <Button onClick={() => { setOpen(true); void loadFiles(1) }}>选择参考图</Button>
        <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => {
          void StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: file as unknown as string } })
            .then((response) => { if (response.data?.id) addFile(response.data.id) })
            .catch(() => message.error('上传参考图失败'))
          return false
        }}><Button>上传参考图</Button></Upload>
        <Button onClick={() => onChange([])}>不使用参考图</Button>
        <Button onClick={() => onChange(undefined)}>恢复推荐参考图</Button>
      </Space>
      {value == null ? <div className="text-xs text-gray-500">使用系统推荐图；自选图片会替换推荐集合。</div> : null}
      {fileIds.map((fileId, index) => (
        <div key={fileId} className="flex items-center gap-2">
          <Image width={48} height={48} src={buildFileDownloadUrl(fileId)} style={{ objectFit: 'cover' }} />
          <span className="text-xs">图 {index + 1}</span>
          <Select mode="multiple" className="flex-1" options={ROLE_OPTIONS}
            value={(value ?? []).filter((reference) => reference.file_id === fileId).map((reference) => reference.role)}
            onChange={(roles: AssetPromptReference['role'][]) => {
              if (!roles.length) return
              onChange(fileIds.flatMap((id) => id === fileId ? roles.map((role) => ({ file_id: id, role })) : (value ?? []).filter((reference) => reference.file_id === id)))
            }} />
          <Button size="small" onClick={() => onChange((value ?? []).filter((reference) => reference.file_id !== fileId))}>移除</Button>
        </div>
      ))}
      <Modal title="选择图片素材" open={open} footer={null} onCancel={() => setOpen(false)}>
        <Input.Search value={query} onChange={(event) => setQuery(event.target.value)} onSearch={(search) => void loadFiles(1, search)} placeholder="搜索图片名称" />
        <Spin spinning={loading}>
          <div className="grid grid-cols-4 gap-2 my-3">
            {files.map((file) => <Button key={file.id} className="h-auto p-1" disabled={fileIds.includes(file.id)} onClick={() => addFile(file.id)}>
              <img className="w-full h-20 object-cover" src={buildFileDownloadUrl(file.id)} alt={file.name} />
              <div className="truncate text-xs">{file.name}</div>
            </Button>)}
          </div>
        </Spin>
        <Pagination size="small" current={page} pageSize={20} total={total} showSizeChanger={false} onChange={(next) => void loadFiles(next)} />
      </Modal>
    </div>
  )
}
