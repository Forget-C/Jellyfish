import { useExperimentLeaveStatus } from '../ExperimentLeaveGuard'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Alert, Button, Checkbox, Empty, Modal, Spin, Tabs } from 'antd'
import { CloseOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons'
import { StudioFilesService, type FileRead } from '../../../../services/generated'
import { ExperimentReferenceImage } from './ExperimentReferenceImage'
import { ExperimentReferencePanel } from './ExperimentReferencePanel'

type ImageExperimentReferencesProps = {
  value: string[]
  onChange: (ids: string[]) => void
  files: FileRead[]
  libraryState: 'loading' | 'ready' | 'failed'
  onRetryLibrary: () => void
  onUploaded: (file: FileRead) => void
  disabled: boolean
}

const summaryLimit = 4

/** 当前会话的应用值由图片模态持有，抽屉只编辑一次临时选择。 */
export function ImageExperimentReferences({ value, onChange, files, libraryState, onRetryLibrary, onUploaded, disabled }: ImageExperimentReferencesProps) {
  const [draft, setDraft] = useState<string[] | null>(null)
  useExperimentLeaveStatus(draft !== null && (draft.length !== value.length || draft.some((id, index) => id !== value[index])))
  const [tab, setTab] = useState('selected')
  const [preview, setPreview] = useState<{ id: string; name: string }>()
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState<string>()
  const [uploadError, setUploadError] = useState<{ file: File; message: string; retryable: boolean }>()
  const inputRef = useRef<HTMLInputElement>(null)
  const panelEpoch = useRef(0)
  const uploadPending = useRef(false)

  // 模态按会话身份挂载；跨会话或退出后，旧上传只能更新资料库。
  useEffect(() => () => { panelEpoch.current += 1 }, [])

  const resetUpload = () => {
    uploadPending.current = false
    setUploading(false)
    setUploaded(undefined)
    setUploadError(undefined)
  }

  const open = () => {
    panelEpoch.current += 1
    setDraft([...value])
    setTab('selected')
    resetUpload()
  }

  const close = () => {
    panelEpoch.current += 1
    setDraft(null)
    setPreview(undefined)
    resetUpload()
  }

  const toggle = (id: string, selected: boolean) => setDraft(current => {
    if (!current) return current
    return selected ? current.includes(id) ? current : [...current, id] : current.filter(item => item !== id)
  })

  const upload = async (file: File) => {
    if (uploadPending.current || draft === null) return
    setUploaded(undefined)
    if (!file.type.startsWith('image/')) {
      setUploadError({ file, message: '只能上传图片作为参考图', retryable: false })
      return
    }
    const epoch = panelEpoch.current
    uploadPending.current = true
    setUploading(true)
    setUploadError(undefined)
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: file as unknown as string } })
      const saved = response.data
      if (!saved) throw new Error('上传未返回文件信息')
      onUploaded(saved)
      if (panelEpoch.current !== epoch) return
      toggle(saved.id, true)
      setUploaded(saved.name)
      setTab('selected')
    } catch {
      if (panelEpoch.current === epoch) setUploadError({ file, message: '参考图上传失败', retryable: true })
    } finally {
      if (panelEpoch.current === epoch) {
        uploadPending.current = false
        setUploading(false)
      }
    }
  }

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void upload(file)
  }

  const referenceName = (id: string) => files.find(file => file.id === id)?.name ?? id
  const referenceRow = (id: string, onRemove: () => void, summary = false) => {
    const name = referenceName(id)
    return <li key={id} className="experiment-reference-row">
      <button type="button" className="experiment-reference-thumb" aria-label={`预览参考图：${name}`} onClick={() => setPreview({ id, name })}>
        <ExperimentReferenceImage id={id} name={name} />
      </button>
      <span className="experiment-reference-name" title={name}>{name}</span>
      <button type="button" className="experiment-reference-remove" aria-label={`移除参考图：${name}`} disabled={summary && disabled} onClick={onRemove}>
        <CloseOutlined aria-hidden="true" />
      </button>
    </li>
  }

  const library = <>
    {libraryState === 'loading' && <div role="status"><Spin size="small" /> 正在读取图片资料库</div>}
    {libraryState === 'failed' && <Alert type="error" message="图片资料库读取失败" action={<Button size="small" onClick={onRetryLibrary}>重试读取</Button>} />}
    {libraryState === 'ready' && !files.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="资料库中暂无图片" />}
    <ul className="experiment-reference-list">
      {files.map(file => <li key={file.id} className="experiment-reference-row">
        <button type="button" className="experiment-reference-thumb" aria-label={`预览资料库图片：${file.name}`} onClick={() => setPreview({ id: file.id, name: file.name })}>
          <ExperimentReferenceImage id={file.id} name={file.name} />
        </button>
        <Checkbox checked={draft?.includes(file.id) ?? false} onChange={event => toggle(file.id, event.target.checked)}>{file.name}</Checkbox>
      </li>)}
    </ul>
  </>

  return <div className="experiment-image-references">
    <Button icon={<PictureOutlined aria-hidden="true" />} disabled={disabled} onClick={open}>参考图</Button>
    {value.length > 0 && <>
      <ul aria-label="本轮参考图" className="experiment-reference-summary experiment-reference-list">
        {value.slice(0, summaryLimit).map(id => referenceRow(id, () => onChange(value.filter(item => item !== id)), true))}
      </ul>
      {value.length > summaryLimit && <Button className="experiment-reference-summary" type="text" disabled={disabled} onClick={open}>查看全部（{value.length}）</Button>}
      <Button className="experiment-reference-count" type="text" disabled={disabled} onClick={open}>已选 {value.length} 张参考图</Button>
    </>}
    <ExperimentReferencePanel
      open={draft !== null}
      title="配置参考图"
      applyLabel="应用参考图"
      applyDisabled={disabled || uploading}
      previewOpen={Boolean(preview)}
      onCancel={close}
      onApply={() => {
        if (draft === null || disabled || uploadPending.current) return
        onChange(draft)
        close()
      }}
    >
      <input ref={inputRef} type="file" accept="image/*" aria-label="上传参考图文件" hidden onChange={pickFile} />
      <Button icon={<UploadOutlined aria-hidden="true" />} loading={uploading} disabled={disabled} onClick={() => inputRef.current?.click()}>上传图片</Button>
      <p className="experiment-reference-hint">上传文件保留在资料库，应用后用于本轮实验</p>
      {uploading && <p role="status">正在上传参考图</p>}
      {uploaded && <p role="status">{uploaded} 已上传，尚未应用</p>}
      {uploadError && <Alert type="error" message={uploadError.message} action={uploadError.retryable && <Button size="small" onClick={() => void upload(uploadError.file)}>重试上传</Button>} />}
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: 'selected', label: `已选素材（${draft?.length ?? 0}）`, children: draft?.length ? <ul className="experiment-reference-list">
          {draft.map(id => referenceRow(id, () => toggle(id, false)))}
        </ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择参考图" /> },
        { key: 'library', label: '资料库', children: library },
      ]} />
    </ExperimentReferencePanel>
    <Modal title={preview ? `预览参考图：${preview.name}` : '预览参考图'} open={Boolean(preview)} onCancel={() => setPreview(undefined)} footer={null} width="min(820px, calc(100vw - 24px))" zIndex={1100}>
      {preview && <ExperimentReferenceImage key={preview.id} id={preview.id} name={preview.name} full />}
    </Modal>
  </div>
}
