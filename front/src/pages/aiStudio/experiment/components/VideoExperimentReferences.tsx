import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Alert, Button, Empty, Input, Modal, Spin } from 'antd'
import { CloseOutlined, FolderOpenOutlined, PictureOutlined, UploadOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { StudioFilesService, type FileRead, type VideoGenerationOptionsRead } from '../../../../services/generated'
import { buildFileDownloadUrl } from '../../assets/utils'
import { ExperimentReferenceImage } from './ExperimentReferenceImage'
import { ExperimentReferencePanel } from './ExperimentReferencePanel'
import './experiment-video-references.css'

export const frameLabels = { first: '首帧', last: '尾帧', key: '关键帧' }
export type FrameSlot = keyof typeof frameLabels
type MediaKind = 'image' | 'video'
type SubjectMedia = { id: string; kind: MediaKind }
export type VideoSubjectDraft = { id: string; name: string; media: SubjectMedia[] }
type Frames = Partial<Record<FrameSlot, string>>
type References = { frames: Frames; subjects: VideoSubjectDraft[] }
type Target = { slot: FrameSlot; kind: 'image' } | { subjectId: string; kind: MediaKind }

const frameSlots = Object.keys(frameLabels) as FrameSlot[]
const kindLabel = { image: '图片', video: '视频' }

/** 只执行能力响应明确提供的限制，保留未知字段由提交服务校验。 */
function subjectIssues(subject: VideoSubjectDraft, subjects: VideoSubjectDraft[], capability?: VideoGenerationOptionsRead) {
  const name = subject.name.trim().toLowerCase()
  const images = subject.media.filter(item => item.kind === 'image').length
  const videos = subject.media.length - images
  const issues: string[] = []
  if (!name || !subject.media.length) issues.push('请填写主体名称并添加至少一份参考素材')
  if (name && subjects.some(item => item.id !== subject.id && item.name.trim().toLowerCase() === name)) issues.push('主体名称不能重复')
  if (images && capability?.supports_subject_image_reference === false) issues.push('当前模型不支持主体图片')
  if (videos && capability?.supports_subject_video_reference === false) issues.push('当前模型不支持主体视频')
  if (typeof capability?.max_images_per_subject === 'number' && images > capability.max_images_per_subject) issues.push(`单个主体最多 ${capability.max_images_per_subject} 张图片`)
  if (typeof capability?.max_videos_per_subject === 'number' && videos > capability.max_videos_per_subject) issues.push(`单个主体最多 ${capability.max_videos_per_subject} 个视频`)
  if (typeof capability?.max_media_per_subject === 'number' && subject.media.length > capability.max_media_per_subject) issues.push(`单个主体最多 ${capability.max_media_per_subject} 份素材`)
  return issues
}

function groupIssues({ frames, subjects }: References, capability?: VideoGenerationOptionsRead) {
  const issues: string[] = []
  if (subjects.length && Object.values(frames).some(Boolean) && capability?.supports_subject_reference_with_frame_reference === false) issues.push('当前模型不支持帧参考与主体参考同时使用')
  if (typeof capability?.max_subjects === 'number' && subjects.length > capability.max_subjects) issues.push(`当前模型最多支持 ${capability.max_subjects} 个主体`)
  const totalVideos = subjects.reduce((count, subject) => count + subject.media.filter(item => item.kind === 'video').length, 0)
  if (typeof capability?.max_total_subject_videos === 'number' && totalVideos > capability.max_total_subject_videos) issues.push(`当前模型最多支持 ${capability.max_total_subject_videos} 个主体视频`)
  return issues
}

/** 输入区、配置面板与提交共用同一套已知冲突规则。 */
export function videoReferenceIssues(value: References, capability?: VideoGenerationOptionsRead) {
  return [...groupIssues(value, capability), ...new Set(value.subjects.flatMap(subject => subjectIssues(subject, value.subjects, capability)))]
}

type Props = {
  value: References
  onChange: (value: References) => void
  files: FileRead[]
  libraryState: 'loading' | 'ready' | 'failed'
  onRetryLibrary: () => void
  onUploaded: (file: FileRead) => void
  capability?: VideoGenerationOptionsRead
  disabled: boolean
}

function VideoReferencePreview({ file }: { file: FileRead }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  return <>
    {state === 'loading' && <p role="status">正在加载视频</p>}
    {state === 'failed' ? <Alert type="error" message="视频不可用" action={<Button onClick={() => setState('loading')}>重试加载</Button>} /> :
      <video aria-label={file.name} className="experiment-reference-video" src={buildFileDownloadUrl(file.id)} controls playsInline preload="metadata" onLoadedMetadata={() => setState('ready')} onError={() => setState('failed')} />}
  </>
}

/** 参考素材按角色编辑，抽屉内的临时选择在应用前不会改变本轮生成。 */
export function VideoExperimentReferences({ value, onChange, files, libraryState, onRetryLibrary, onUploaded, capability, disabled }: Props) {
  const [draft, setDraft] = useState<References | null>(null)
  const [target, setTarget] = useState<Target>()
  const [preview, setPreview] = useState<FileRead>()
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState<string>()
  const [uploadError, setUploadError] = useState<{ target: Target; file: File; retryable: boolean }>()
  const panelEpoch = useRef(0)
  const uploadPending = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const libraryHeadingRef = useRef<HTMLHeadingElement>(null)
  const libraryTriggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => () => { panelEpoch.current += 1 }, [])
  useEffect(() => {
    if (target) libraryHeadingRef.current?.focus()
  }, [target])

  const reset = () => {
    panelEpoch.current += 1
    uploadPending.current = false
    setUploading(false)
    setTarget(undefined)
    setPreview(undefined)
    setUploadError(undefined)
    setUploaded(undefined)
  }

  const updateSubject = (id: string, update: (subject: VideoSubjectDraft) => VideoSubjectDraft) => {
    setDraft(current => current && ({ ...current, subjects: current.subjects.map(item => item.id === id ? update(item) : item) }))
  }

  const toggle = (destination: Target, id: string, selected: boolean) => {
    if ('slot' in destination) {
      setDraft(current => current && ({ ...current, frames: { ...current.frames, [destination.slot]: selected ? id : undefined } }))
      return
    }
    updateSubject(destination.subjectId, subject => ({
      ...subject,
      media: selected
        ? subject.media.some(item => item.id === id) ? subject.media : [...subject.media, { id, kind: destination.kind }]
        : subject.media.filter(item => item.id !== id),
    }))
  }

  const upload = async (destination: Target, file: File) => {
    if (uploadPending.current || draft === null) return
    setUploaded(undefined)
    if (!file.type.startsWith(`${destination.kind}/`)) {
      setUploadError({ target: destination, file, retryable: false })
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
      toggle(destination, saved.id, true)
      setUploaded(saved.name)
    } catch {
      if (panelEpoch.current === epoch) setUploadError({ target: destination, file, retryable: true })
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
    if (target && file) void upload(target, file)
  }

  const thumbnail = (file: FileRead, label: string) => <button type="button" className="experiment-reference-thumb" aria-label={`预览${label}：${file.name}`} onClick={() => setPreview(file)}>
    {file.type === 'video' ? <VideoCameraOutlined aria-hidden="true" /> : <ExperimentReferenceImage id={file.id} name={file.name} />}
  </button>

  const row = (id: string, label: string, remove: () => void) => {
    const file = files.find(item => item.id === id)
    const name = file?.name ?? id
    return <li key={id} className="experiment-reference-row">
      {file && thumbnail(file, label)}
      <span className="experiment-reference-name" title={name}>{name}</span>
      <button type="button" className="experiment-reference-remove" aria-label={`移除${label}：${name}`} onClick={remove}>
        <CloseOutlined aria-hidden="true" />
      </button>
    </li>
  }

  const openLibrary = (destination: Target, trigger: HTMLElement) => {
    libraryTriggerRef.current = trigger
    setUploadError(undefined)
    setUploaded(undefined)
    setTarget(destination)
  }

  const backToSelected = () => {
    setTarget(undefined)
    requestAnimationFrame(() => libraryTriggerRef.current?.focus({ preventScroll: true }))
  }

  const close = () => {
    reset()
    setDraft(null)
  }

  const noSubjectSupport = capability?.supports_subject_image_reference === false && capability?.supports_subject_video_reference === false
  const draftIssues = draft ? videoReferenceIssues(draft, capability) : []
  const summary = [...frameSlots.filter(slot => value.frames[slot]).map(slot => `${frameLabels[slot]}已选`),
    ...(value.subjects.length ? [`主体 ${value.subjects.length} 个`] : [])].join(' · ')

  const limits = [
    typeof capability?.max_subjects === 'number' ? `主体最多 ${capability.max_subjects} 个` : '',
    typeof capability?.max_images_per_subject === 'number' ? `每主体图片最多 ${capability.max_images_per_subject} 张` : '',
    typeof capability?.max_videos_per_subject === 'number' ? `每主体视频最多 ${capability.max_videos_per_subject} 个` : '',
    typeof capability?.max_media_per_subject === 'number' ? `每主体素材最多 ${capability.max_media_per_subject} 份` : '',
    typeof capability?.max_total_subject_videos === 'number' ? `主体视频合计最多 ${capability.max_total_subject_videos} 个` : '',
  ].filter(Boolean).join(' · ')

  const targetLabel = target && ('slot' in target ? frameLabels[target.slot] : `主体${kindLabel[target.kind]}`)
  const targetFiles = target ? files.filter(file => file.type === target.kind) : []
  const selectedIds = draft && target ? 'slot' in target
    ? [draft.frames[target.slot]]
    : draft.subjects.find(subject => subject.id === target.subjectId)?.media.map(item => item.id) ?? [] : []

  return <>
    <Button icon={<PictureOutlined aria-hidden="true" />} disabled={disabled} onClick={() => {
      reset()
      setDraft(value)
    }}>参考素材</Button>
    {summary && <span className="experiment-video-reference-summary">{summary}</span>}
    <ExperimentReferencePanel
      open={draft !== null}
      title="配置视频参考素材"
      applyLabel="应用参考素材"
      applyDisabled={disabled || uploading || draftIssues.length > 0}
      previewOpen={Boolean(preview)}
      onCancel={close}
      onApply={() => {
        if (!draft || disabled || uploadPending.current || draftIssues.length) return
        onChange(draft)
        close()
      }}
    >
      {draft && <div className="experiment-video-reference-editor">
        {target && <section aria-label="资料库">
          <Button disabled={uploading} onClick={backToSelected}>返回已选素材</Button>
          <h3 ref={libraryHeadingRef} tabIndex={-1}>{targetLabel}资料库</h3>
          <input ref={inputRef} type="file" accept={`${target.kind}/*`} aria-label={`上传${targetLabel}文件`} hidden onChange={pickFile} />
          <Button icon={<UploadOutlined aria-hidden="true" />} loading={uploading} disabled={disabled} onClick={() => inputRef.current?.click()}>上传{kindLabel[target.kind]}</Button>
          <p className="experiment-reference-hint">上传文件保留在资料库，应用后用于本轮实验</p>
          {uploading && <p role="status">正在上传参考素材</p>}
          {uploaded && <p role="status">{uploaded} 已上传，尚未应用</p>}
          {uploadError && <Alert type="error"
            message={uploadError.retryable ? '参考素材上传失败' : `请选择${kindLabel[uploadError.target.kind]}文件`}
            action={uploadError.retryable && <Button size="small" onClick={() => void upload(uploadError.target, uploadError.file)}>重试上传</Button>}
          />}
          {libraryState === 'loading' && <p role="status"><Spin size="small" /> 正在读取资料库</p>}
          {libraryState === 'failed' && <Alert type="error" message="视频参考资料库读取失败" action={<Button size="small" onClick={onRetryLibrary}>重试读取</Button>} />}
          {libraryState === 'ready' && !targetFiles.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`资料库中暂无${kindLabel[target.kind]}`} />}
          <ul className="experiment-reference-list">{targetFiles.map(file => <li key={file.id} className="experiment-reference-row">
            {thumbnail(file, `资料库${kindLabel[target.kind]}`)}
            <Button type="text" className="experiment-video-file-choice" title={file.name} aria-pressed={selectedIds.includes(file.id)}
              disabled={disabled || uploading}
              onClick={() => toggle(target, file.id, !selectedIds.includes(file.id))}>{file.name}</Button>
          </li>)}</ul>
        </section>}
        <div hidden={Boolean(target)}>
          <section>
            <h3>帧参考</h3>
            <div className="experiment-video-frame-list">{frameSlots.map(slot => {
              const label = frameLabels[slot]
              const id = draft.frames[slot]
              return <div key={slot}>
                <div className="experiment-video-reference-actions">
                  <strong>{label}</strong>
                  <Button size="small" icon={<FolderOpenOutlined aria-hidden="true" />} onClick={event => openLibrary({ slot, kind: 'image' }, event.currentTarget)}>选择{label}</Button>
                </div>
                {id && <ul className="experiment-reference-list">{row(id, label, () => toggle({ slot, kind: 'image' }, id, false))}</ul>}
              </div>
            })}</div>
          </section>
          <section>
            <div className="experiment-video-reference-actions">
              <h3>主体参考</h3>
              <Button size="small" disabled={noSubjectSupport || (typeof capability?.max_subjects === 'number' && draft.subjects.length >= capability.max_subjects)} onClick={() => {
                const subject = { id: crypto.randomUUID(), name: '', media: [] }
                setDraft(current => current && ({ ...current, subjects: [...current.subjects, subject] }))
              }}>添加主体</Button>
            </div>
            {noSubjectSupport && <p className="experiment-reference-hint">当前模型不支持主体参考</p>}
            {limits && <p className="experiment-reference-hint">{limits}</p>}
            {groupIssues(draft, capability).map(issue => <p key={issue} role="alert" className="experiment-video-reference-issue">{issue}</p>)}
            {!draft.subjects.length && <p className="experiment-reference-hint">尚未添加主体参考</p>}
            {draft.subjects.map((subject, index) => <fieldset key={subject.id} className="experiment-video-subject">
              <legend>主体 {index + 1}</legend>
              <div className="experiment-video-reference-actions">
                <Input value={subject.name} aria-label={`主体 ${index + 1} 名称`} placeholder="输入主体名称"
                  onChange={event => {
                    const name = event.target.value
                    updateSubject(subject.id, item => ({ ...item, name }))
                  }} />
                <Button type="text" danger aria-label={`移除主体 ${index + 1}`} onClick={() => {
                  setDraft(current => current && ({ ...current, subjects: current.subjects.filter(item => item.id !== subject.id) }))
                }}>移除</Button>
              </div>
              <div className="experiment-video-reference-actions">
                {(['image', 'video'] as const).map(kind => <Button key={kind} size="small"
                  disabled={(kind === 'image' ? capability?.supports_subject_image_reference : capability?.supports_subject_video_reference) === false}
                  onClick={event => openLibrary({ subjectId: subject.id, kind }, event.currentTarget)}>选择主体{index + 1}{kindLabel[kind]}</Button>)}
              </div>
              {capability?.supports_subject_image_reference === false && !subject.media.some(item => item.kind === 'image') && <p className="experiment-reference-hint">当前模型不支持主体图片</p>}
              {capability?.supports_subject_video_reference === false && !subject.media.some(item => item.kind === 'video') && <p className="experiment-reference-hint">当前模型不支持主体视频</p>}
              <ul className="experiment-reference-list">{subject.media.map(({ id, kind }) => row(id, `主体${index + 1}${kindLabel[kind]}`, () => toggle({ subjectId: subject.id, kind }, id, false)))}</ul>
              {subjectIssues(subject, draft.subjects, capability).map(issue => <p key={issue} role="alert" className="experiment-video-reference-issue">{issue}</p>)}
            </fieldset>)}
          </section>
        </div>
        {target && draftIssues.length > 0 && <p role="status" className="experiment-video-reference-issue">{draftIssues.join('；')}</p>}
      </div>}
    </ExperimentReferencePanel>
    <Modal title={preview ? `预览参考素材：${preview.name}` : '预览参考素材'} open={Boolean(preview)} onCancel={() => setPreview(undefined)} footer={null} width="min(820px, calc(100vw - 24px))" zIndex={1100}>
      {preview && (preview.type === 'video' ? <VideoReferencePreview key={preview.id} file={preview} /> : <ExperimentReferenceImage key={preview.id} id={preview.id} name={preview.name} full />)}
    </Modal>
  </>
}
