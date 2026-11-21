import { useUiText } from '../../../../uiText'
import { useExperimentLeaveStatus } from '../ExperimentLeaveGuard'
import { forwardRef, useImperativeHandle, useRef, useState, type ChangeEvent } from 'react'
import { Alert, Button, Checkbox, Empty, Modal, Spin, Tabs } from 'antd'
import { CloseOutlined, UploadOutlined } from '@ant-design/icons'
import type { FileRead } from '../../../../services/generated'
import { useExperimentReferenceUpload } from '../hooks/useExperimentReferenceUpload'
import { ExperimentReferenceSummary } from './ExperimentReferenceSummary'
import { ExperimentReferenceImage } from './ExperimentReferenceImage'
import { ExperimentReferencePanel, type ExperimentReferenceHandle } from './ExperimentReferencePanel'

type ImageExperimentReferencesProps = {
  value: string[]
  onChange: (ids: string[]) => void
  files: FileRead[]
  libraryState: 'loading' | 'ready' | 'failed'
  onRetryLibrary: () => void
  onUploaded: (file: FileRead) => void
  disabled: boolean
}

/** 当前会话的应用值由图片模态持有，抽屉只编辑一次临时选择。 */
export const ImageExperimentReferences = forwardRef<ExperimentReferenceHandle, ImageExperimentReferencesProps>(function ImageExperimentReferences({ value, onChange, files, libraryState, onRetryLibrary, onUploaded, disabled }, ref) {
  const uiText = useUiText()
  const summaryRoot = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<string[] | null>(null)
  useExperimentLeaveStatus(draft !== null && (draft.length !== value.length || draft.some((id, index) => id !== value[index])))
  const [tab, setTab] = useState('selected')
  const [preview, setPreview] = useState<{ id: string; name: string }>()
  const { uploading, uploaded, uploadError, resetUpload, uploadFile, isUploadPending } =
    useExperimentReferenceUpload<undefined>(onUploaded, uiText("参考图上传失败"))
  const inputRef = useRef<HTMLInputElement>(null)

  const returnFocus = useRef<HTMLElement | null>(null)
  const open = (trigger?: HTMLElement | null) => {
    returnFocus.current = trigger ?? null
    setDraft([...value])
    setTab('selected')
    resetUpload()
  }

  useImperativeHandle(ref, () => ({ open }))

  const close = () => {
    setDraft(null)
    setPreview(undefined)
    resetUpload()
  }

  const toggle = (id: string, selected: boolean) => setDraft(current => {
    if (!current) return current
    return selected ? current.includes(id) ? current : [...current, id] : current.filter(item => item !== id)
  })

  const upload = (file: File) => {
    if (draft === null) return
    return uploadFile(file, undefined, (saved) => {
      toggle(saved.id, true)
      setTab('selected')
    }, file.type.startsWith('image/') ? undefined : uiText("只能上传图片作为参考图"))
  }

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void upload(file)
  }

  const referenceName = (id: string) => files.find(file => file.id === id)?.name ?? id
  const referenceRow = (id: string, onRemove: () => void) => {
    const name = referenceName(id)
    return <li key={id} className="experiment-reference-row">
      <button type="button" className="experiment-reference-thumb" aria-label={uiText("预览参考图：{{name}}", { name })} onClick={() => setPreview({ id, name })}>
        <ExperimentReferenceImage id={id} name={name} />
      </button>
      <span className="experiment-reference-name" title={name}>{name}</span>
      <button type="button" className="experiment-reference-remove" aria-label={uiText("移除参考图：{{name}}", { name })} disabled={disabled} onClick={onRemove}>
        <CloseOutlined aria-hidden="true" />
      </button>
    </li>
  }

  const library = <>
    {libraryState === 'loading' && <div role="status"><Spin size="small" /> {uiText("正在读取图片资料库")}</div>}
    {libraryState === 'failed' && <Alert type="error" message={uiText("图片资料库读取失败")} action={<Button size="small" onClick={onRetryLibrary}>{uiText("重试读取")}</Button>} />}
    {libraryState === 'ready' && !files.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={uiText("资料库中暂无图片")} />}
    <ul className="experiment-reference-list">
      {files.map(file => <li key={file.id} className="experiment-reference-row">
        <button type="button" className="experiment-reference-thumb" aria-label={uiText("预览资料库图片：{{name}}", { name: file.name })} onClick={() => setPreview({ id: file.id, name: file.name })}>
          <ExperimentReferenceImage id={file.id} name={file.name} />
        </button>
        <Checkbox checked={draft?.includes(file.id) ?? false} onChange={event => toggle(file.id, event.target.checked)}>{file.name}</Checkbox>
      </li>)}
    </ul>
  </>

  return <div ref={summaryRoot} className="experiment-image-references">
    <ExperimentReferenceSummary label={uiText("本轮参考图")} disabled={disabled}
      items={value.map(id => ({ key: id, id, name: referenceName(id), label: uiText("参考图：{{value1}}", { value1: referenceName(id) }), kind: 'image' }))}
      onOpen={open} onPreview={(item, trigger) => { returnFocus.current = trigger; setPreview({ id: item.id, name: item.name }) }} />
    <ExperimentReferencePanel
      open={draft !== null}
      title={uiText("配置参考图")}
      applyLabel={uiText("应用参考图")}
      applyDisabled={disabled || uploading}
      previewOpen={Boolean(preview)}
      onCancel={close}
      onAfterClose={() => returnFocus.current?.focus()}
      onApply={() => {
        if (draft === null || disabled || isUploadPending()) return
        onChange(draft)
        close()
      }}
    >
      <input ref={inputRef} type="file" accept="image/*" aria-label={uiText("上传参考图文件")} hidden onChange={pickFile} />
      <Button icon={<UploadOutlined aria-hidden="true" />} loading={uploading} disabled={disabled} onClick={() => inputRef.current?.click()}>{uiText("上传图片")}</Button>
      <p className="experiment-reference-hint">{uiText("上传文件保留在资料库，应用后用于本轮实验")}</p>
      {uploading && <p role="status">{uiText("正在上传参考图")}</p>}
      {uploaded && <p role="status">{uploaded} {uiText("已上传，尚未应用")}</p>}
      {uploadError && <Alert type="error" message={uploadError.message} action={uploadError.retryable && <Button size="small" onClick={() => void upload(uploadError.file)}>{uiText("重试上传")}</Button>} />}
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: 'selected', label: uiText("已选素材（{{value1}}）", { value1: draft?.length ?? 0 }), children: draft?.length ? <ul className="experiment-reference-list">
          {draft.map(id => referenceRow(id, () => toggle(id, false)))}
        </ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={uiText("尚未选择参考图")} /> },
        { key: 'library', label: uiText("资料库"), children: library },
      ]} />
    </ExperimentReferencePanel>
    <Modal title={preview ? uiText("预览参考图：{{name}}", { name: preview.name }) : uiText("预览参考图")} open={Boolean(preview)} onCancel={() => setPreview(undefined)} afterClose={() => { if (draft === null) returnFocus.current?.focus() }}
      footer={preview && draft === null && value.includes(preview.id) ? <Button disabled={disabled} onClick={() => {
        onChange(value.filter(id => id !== preview.id))
        setPreview(undefined)
        returnFocus.current = summaryRoot.current?.closest('.experiment-composer')?.querySelector<HTMLElement>('.experiment-add-trigger') ?? null
      }}>{uiText("移除参考图")}</Button> : null} width="min(820px, calc(100vw - 24px))" zIndex={1100}>
      {preview && <ExperimentReferenceImage key={preview.id} id={preview.id} name={preview.name} full />}
    </Modal>
  </div>
})
