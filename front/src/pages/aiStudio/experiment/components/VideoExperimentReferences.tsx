import { uiText, useUiText } from '../../../../uiText'
import { useExperimentLeaveStatus } from '../ExperimentLeaveGuard'
import { forwardRef, useImperativeHandle, useCallback, useEffect, useRef, useState, type ChangeEvent, type RefCallback } from 'react'
import { Alert, Button, Empty, Input, Modal, Spin } from 'antd'
import { CloseOutlined, FolderOpenOutlined, UploadOutlined, VideoCameraOutlined } from '@ant-design/icons'
import type { FileRead, VideoGenerationOptionsRead } from '../../../../services/generated'
import { useExperimentReferenceUpload } from '../hooks/useExperimentReferenceUpload'
import { buildFileDownloadUrl } from '../../assets/utils'
import { ExperimentReferenceSummary, type ReferenceSummaryItem } from './ExperimentReferenceSummary'
import { ExperimentReferenceImage } from './ExperimentReferenceImage'
import { ExperimentReferencePanel, type ExperimentReferenceHandle } from './ExperimentReferencePanel'
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
  if (!name || !subject.media.length) issues.push(uiText("请填写主体名称并添加至少一份参考素材"))
  if (name && subjects.some(item => item.id !== subject.id && item.name.trim().toLowerCase() === name)) issues.push(uiText("主体名称不能重复"))
  if (images && capability?.supports_subject_image_reference === false) issues.push(uiText("当前模型不支持主体图片"))
  if (videos && capability?.supports_subject_video_reference === false) issues.push(uiText("当前模型不支持主体视频"))
  if (typeof capability?.max_images_per_subject === 'number' && images > capability.max_images_per_subject) issues.push(uiText("单个主体最多 {{max_images_per_subject}} 张图片", { max_images_per_subject: capability.max_images_per_subject }))
  if (typeof capability?.max_videos_per_subject === 'number' && videos > capability.max_videos_per_subject) issues.push(uiText("单个主体最多 {{max_videos_per_subject}} 个视频", { max_videos_per_subject: capability.max_videos_per_subject }))
  if (typeof capability?.max_media_per_subject === 'number' && subject.media.length > capability.max_media_per_subject) issues.push(uiText("单个主体最多 {{max_media_per_subject}} 份素材", { max_media_per_subject: capability.max_media_per_subject }))
  return issues
}

function groupIssues({ frames, subjects }: References, capability?: VideoGenerationOptionsRead) {
  const issues: string[] = []
  if (subjects.length && Object.values(frames).some(Boolean) && capability?.supports_subject_reference_with_frame_reference === false) issues.push(uiText("当前模型不支持帧参考与主体参考同时使用"))
  if (typeof capability?.max_subjects === 'number' && subjects.length > capability.max_subjects) issues.push(uiText("当前模型最多支持 {{max_subjects}} 个主体", { max_subjects: capability.max_subjects }))
  const totalVideos = subjects.reduce((count, subject) => count + subject.media.filter(item => item.kind === 'video').length, 0)
  if (typeof capability?.max_total_subject_videos === 'number' && totalVideos > capability.max_total_subject_videos) issues.push(uiText("当前模型最多支持 {{max_total_subject_videos}} 个主体视频", { max_total_subject_videos: capability.max_total_subject_videos }))
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

function VideoReferencePreview({ file, playerRef }: { file: FileRead; playerRef: RefCallback<HTMLVideoElement> }) {
  useUiText()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  return <>
    {state === 'loading' && <p role="status">{uiText("正在加载视频")}</p>}
    {state === 'failed' ? <Alert type="error" message={uiText("视频不可用")} action={<Button onClick={() => setState('loading')}>{uiText("重试加载")}</Button>} /> :
      <video ref={playerRef} aria-label={file.name} className="experiment-reference-video" src={buildFileDownloadUrl(file.id)} controls playsInline preload="metadata" onLoadedMetadata={() => setState('ready')} onError={() => setState('failed')} />}
  </>
}

/** 参考素材按角色编辑，抽屉内的临时选择在应用前不会改变本轮生成。 */
export const VideoExperimentReferences = forwardRef<ExperimentReferenceHandle, Props>(function VideoExperimentReferences({ value, onChange, files, libraryState, onRetryLibrary, onUploaded, capability, disabled }, ref) {
  useUiText()
  const summaryRoot = useRef<HTMLDivElement>(null)
  const [previewTarget, setPreviewTarget] = useState<Target>()
  const [draft, setDraft] = useState<References | null>(null)
  useExperimentLeaveStatus(draft !== null && JSON.stringify(draft) !== JSON.stringify(value))
  const [target, setTarget] = useState<Target>()
  const [preview, setPreview] = useState<FileRead>()
  const [previewContext, setPreviewContext] = useState('')
  const previewPlayer = useRef<HTMLVideoElement | null>(null)
  const attachPlayer = useCallback((element: HTMLVideoElement | null) => {
    if (!element) previewPlayer.current?.pause()
    previewPlayer.current = element
  }, [])
  const { uploading, uploaded, uploadError, clearFeedback, resetUpload, uploadFile, isUploadPending } =
    useExperimentReferenceUpload<Target>(onUploaded, uiText("参考素材上传失败"))
  const inputRef = useRef<HTMLInputElement>(null)
  const libraryHeadingRef = useRef<HTMLHeadingElement>(null)
  const libraryTriggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (target) libraryHeadingRef.current?.focus()
  }, [target])

  const closePreview = () => {
    previewPlayer.current?.pause()
    setPreview(undefined)
    setPreviewTarget(undefined)
  }

  const reset = () => {
    resetUpload()
    setTarget(undefined)
    closePreview()
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

  const upload = (destination: Target, file: File) => {
    if (draft === null) return
    return uploadFile(file, destination, saved => toggle(destination, saved.id, true),
      file.type.startsWith(`${destination.kind}/`) ? undefined : uiText("请选择{{kind}}文件", { kind: uiText(kindLabel[destination.kind]) }))
  }

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (target && file) void upload(target, file)
  }

  const thumbnail = (file: FileRead, label: string, context = label) => <button type="button" className="experiment-reference-thumb" aria-label={uiText("预览{{label}}：{{name}}", { label, name: file.name })} onClick={() => { setPreviewTarget(undefined); setPreviewContext(`${context}：${file.name}`); setPreview(file) }}>
    {file.type === 'video' ? <VideoCameraOutlined aria-hidden="true" /> : <ExperimentReferenceImage id={file.id} name={file.name} />}
  </button>

  const row = (id: string, label: string, remove: () => void, context = label) => {
    const file = files.find(item => item.id === id)
    const name = file?.name ?? id
    return <li key={id} className="experiment-reference-row">
      {file && thumbnail(file, label, context)}
      <span className="experiment-reference-name" title={name}>{name}</span>
      <button type="button" className="experiment-reference-remove" aria-label={uiText("移除{{label}}：{{name}}", { label, name })} onClick={remove}>
        <CloseOutlined aria-hidden="true" />
      </button>
    </li>
  }

  const openLibrary = (destination: Target, trigger: HTMLElement) => {
    libraryTriggerRef.current = trigger
    clearFeedback()
    setTarget(destination)
  }

  const backToSelected = () => {
    setTarget(undefined)
    requestAnimationFrame(() => libraryTriggerRef.current?.focus({ preventScroll: true }))
  }

  const returnFocus = useRef<HTMLElement | null>(null)
  const open = (trigger?: HTMLElement | null) => {
    returnFocus.current = trigger ?? null
    reset()
    setDraft(value)
  }
  useImperativeHandle(ref, () => ({ open }))

  const close = () => {
    reset()
    setDraft(null)
  }

  const noSubjectSupport = capability?.supports_subject_image_reference === false && capability?.supports_subject_video_reference === false
  const draftIssues = draft ? videoReferenceIssues(draft, capability) : []
  const summary: (ReferenceSummaryItem & { target: Target })[] = [
    ...frameSlots.flatMap(slot => {
      const id = value.frames[slot]
      if (!id) return []
      const file = files.find(item => item.id === id)
      const name = file?.name ?? id
      return [{ key: slot, id, name, label: `${uiText(frameLabels[slot])}：${name}`, kind: 'image' as const,
        badge: uiText({ first: "首", last: "尾", key: "关" }[slot]), target: { slot, kind: 'image' as const } }]
    }),
    ...value.subjects.flatMap(subject => subject.media.map((media, index) => {
      const file = files.find(item => item.id === media.id)
      const name = file?.name ?? media.id
      return { key: `${subject.id}:${media.id}`, id: media.id, name, label: uiText("主体 {{value1}} · 第 {{value2}} 项：{{value3}}", { value1: subject.name, value2: index + 1, value3: name }),
        kind: media.kind, thumbnail: file?.thumbnail, target: { subjectId: subject.id, kind: media.kind } }
    })),
  ]
  const removePreview = () => {
    if (!previewTarget || !preview || disabled) return
    onChange('slot' in previewTarget ? { ...value, frames: { ...value.frames, [previewTarget.slot]: undefined } } : {
      ...value, subjects: value.subjects.map(subject => subject.id === previewTarget.subjectId
        ? { ...subject, media: subject.media.filter(media => media.id !== preview.id) } : subject),
    })
    closePreview()
    returnFocus.current = summaryRoot.current?.closest('.experiment-composer')?.querySelector<HTMLElement>('.experiment-add-trigger') ?? null
  }

  const limits = [
    typeof capability?.max_subjects === 'number' ? uiText("主体最多 {{count}} 个", { count: capability.max_subjects }) : '',
    typeof capability?.max_images_per_subject === 'number' ? uiText("每主体图片最多 {{count}} 张", { count: capability.max_images_per_subject }) : '',
    typeof capability?.max_videos_per_subject === 'number' ? uiText("每主体视频最多 {{count}} 个", { count: capability.max_videos_per_subject }) : '',
    typeof capability?.max_media_per_subject === 'number' ? uiText("每主体素材最多 {{count}} 份", { count: capability.max_media_per_subject }) : '',
    typeof capability?.max_total_subject_videos === 'number' ? uiText("主体视频合计最多 {{count}} 个", { count: capability.max_total_subject_videos }) : '',
  ].filter(Boolean).join(' · ')

  const targetLabel = target && ('slot' in target ? uiText(frameLabels[target.slot]) : uiText("主体{{value1}}", { value1: uiText(kindLabel[target.kind]) }))
  const targetFiles = target ? files.filter(file => file.type === target.kind) : []
  const selectedIds = draft && target ? 'slot' in target
    ? [draft.frames[target.slot]]
    : draft.subjects.find(subject => subject.id === target.subjectId)?.media.map(item => item.id) ?? [] : []

  return <div ref={summaryRoot} className="experiment-video-references">
    <ExperimentReferenceSummary items={summary} label={uiText("本轮参考素材")} disabled={disabled} onOpen={open}
      onPreview={(item, trigger) => {
        returnFocus.current = trigger
        setPreviewContext(item.label)
        setPreviewTarget(summary.find(candidate => candidate.key === item.key)?.target)
        setPreview(files.find(file => file.id === item.id) ?? { id: item.id, name: item.name, type: item.kind })
      }} />
    <ExperimentReferencePanel
      open={draft !== null}
      title={uiText("配置视频参考素材")}
      applyLabel={uiText("应用参考素材")}
      applyDisabled={disabled || uploading || draftIssues.length > 0}
      previewOpen={Boolean(preview)}
      onCancel={close}
      onAfterClose={() => returnFocus.current?.focus()}
      onApply={() => {
        if (!draft || disabled || isUploadPending() || draftIssues.length) return
        onChange(draft)
        close()
      }}
    >
      {draft && <div className="experiment-video-reference-editor">
        {target && <section aria-label={uiText("资料库")}>
          <Button disabled={uploading} onClick={backToSelected}>{uiText("返回已选素材")}</Button>
          <h3 ref={libraryHeadingRef} tabIndex={-1}>{targetLabel}{uiText("资料库")}</h3>
          <input ref={inputRef} type="file" accept={`${target.kind}/*`} aria-label={uiText("上传{{targetLabel}}文件", { targetLabel })} hidden onChange={pickFile} />
          <Button icon={<UploadOutlined aria-hidden="true" />} loading={uploading} disabled={disabled} onClick={() => inputRef.current?.click()}>{uiText("上传")}{uiText(kindLabel[target.kind])}</Button>
          <p className="experiment-reference-hint">{uiText("上传文件保留在资料库，应用后用于本轮实验")}</p>
          {uploading && <p role="status">{uiText("正在上传参考素材")}</p>}
          {uploaded && <p role="status">{uploaded} {uiText("已上传，尚未应用")}</p>}
          {uploadError && <Alert type="error"
            message={uploadError.message}
            action={uploadError.retryable && <Button size="small" onClick={() => void upload(uploadError.target, uploadError.file)}>{uiText("重试上传")}</Button>}
          />}
          {libraryState === 'loading' && <p role="status"><Spin size="small" /> {uiText("正在读取资料库")}</p>}
          {libraryState === 'failed' && <Alert type="error" message={uiText("视频参考资料库读取失败")} action={<Button size="small" onClick={onRetryLibrary}>{uiText("重试读取")}</Button>} />}
          {libraryState === 'ready' && !targetFiles.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={uiText("资料库中暂无{{value1}}", { value1: uiText(kindLabel[target.kind]) })} />}
          <ul className="experiment-reference-list">{targetFiles.map(file => <li key={file.id} className="experiment-reference-row">
            {thumbnail(file, `资料库${uiText(kindLabel[target.kind])}`)}
            <Button type="text" className="experiment-video-file-choice" title={file.name} aria-pressed={selectedIds.includes(file.id)}
              disabled={disabled || uploading}
              onClick={() => toggle(target, file.id, !selectedIds.includes(file.id))}>{file.name}</Button>
          </li>)}</ul>
        </section>}
        <div hidden={Boolean(target)}>
          <section>
            <h3>{uiText("帧参考")}</h3>
            <div className="experiment-video-frame-list">{frameSlots.map(slot => {
              const label = uiText(frameLabels[slot])
              const id = draft.frames[slot]
              return <div key={slot}>
                <div className="experiment-video-reference-actions">
                  <strong>{label}</strong>
                  <Button size="small" icon={<FolderOpenOutlined aria-hidden="true" />} onClick={event => openLibrary({ slot, kind: 'image' }, event.currentTarget)}>{uiText("选择")}{label}</Button>
                </div>
                {id && <ul className="experiment-reference-list">{row(id, label, () => toggle({ slot, kind: 'image' }, id, false))}</ul>}
              </div>
            })}</div>
          </section>
          <section>
            <div className="experiment-video-reference-actions">
              <h3>{uiText("主体参考")}</h3>
              <Button size="small" disabled={noSubjectSupport || (typeof capability?.max_subjects === 'number' && draft.subjects.length >= capability.max_subjects)} onClick={() => {
                const subject = { id: crypto.randomUUID(), name: '', media: [] }
                setDraft(current => current && ({ ...current, subjects: [...current.subjects, subject] }))
              }}>{uiText("添加主体")}</Button>
            </div>
            {noSubjectSupport && <p className="experiment-reference-hint">{uiText("当前模型不支持主体参考")}</p>}
            {limits && <p className="experiment-reference-hint">{limits}</p>}
            {groupIssues(draft, capability).map(issue => <p key={issue} role="alert" className="experiment-video-reference-issue">{issue}</p>)}
            {!draft.subjects.length && <p className="experiment-reference-hint">{uiText("尚未添加主体参考")}</p>}
            {draft.subjects.map((subject, index) => <fieldset key={subject.id} className="experiment-video-subject">
              <legend>{uiText("主体")} {index + 1}</legend>
              <div className="experiment-video-reference-actions">
                <Input value={subject.name} aria-label={uiText("主体 {{value1}} 名称", { value1: index + 1 })} placeholder={uiText("输入主体名称")}
                  onChange={event => {
                    const name = event.target.value
                    updateSubject(subject.id, item => ({ ...item, name }))
                  }} />
                <Button type="text" danger aria-label={uiText("移除主体 {{value1}}", { value1: index + 1 })} onClick={() => {
                  setDraft(current => current && ({ ...current, subjects: current.subjects.filter(item => item.id !== subject.id) }))
                }}>{uiText("移除")}</Button>
              </div>
              <div className="experiment-video-reference-actions">
                {(['image', 'video'] as const).map(kind => <Button key={kind} size="small"
                  disabled={(kind === 'image' ? capability?.supports_subject_image_reference : capability?.supports_subject_video_reference) === false}
                  onClick={event => openLibrary({ subjectId: subject.id, kind }, event.currentTarget)}>{uiText("选择主体")}{index + 1}{uiText(kindLabel[kind])}</Button>)}
              </div>
              {capability?.supports_subject_image_reference === false && !subject.media.some(item => item.kind === 'image') && <p className="experiment-reference-hint">{uiText("当前模型不支持主体图片")}</p>}
              {capability?.supports_subject_video_reference === false && !subject.media.some(item => item.kind === 'video') && <p className="experiment-reference-hint">{uiText("当前模型不支持主体视频")}</p>}
              <ul className="experiment-reference-list">{subject.media.map(({ id, kind }, mediaIndex) => row(id, `主体${index + 1}${uiText(kindLabel[kind])}`, () => toggle({ subjectId: subject.id, kind }, id, false), `主体 ${subject.name} · 第 ${mediaIndex + 1} 项`))}</ul>
              {subjectIssues(subject, draft.subjects, capability).map(issue => <p key={issue} role="alert" className="experiment-video-reference-issue">{issue}</p>)}
            </fieldset>)}
          </section>
        </div>
        {target && draftIssues.length > 0 && <p role="status" className="experiment-video-reference-issue">{draftIssues.join('；')}</p>}
      </div>}
    </ExperimentReferencePanel>
    <Modal title={preview ? uiText("预览参考素材：{{name}}", { name: preview.name }) : uiText("预览参考素材")} open={Boolean(preview)} onCancel={closePreview} afterClose={() => { if (draft === null) returnFocus.current?.focus() }}
      footer={previewTarget && draft === null ? <Button disabled={disabled} onClick={removePreview}>{uiText("移除本项参考素材")}</Button> : null} width="min(820px, calc(100vw - 24px))" zIndex={1100}>
      {preview && <p className="experiment-reference-hint">{previewContext}</p>}
      {preview && (preview.type === 'video' ? <VideoReferencePreview key={preview.id} file={preview} playerRef={attachPlayer} /> : <ExperimentReferenceImage key={preview.id} id={preview.id} name={preview.name} full />)}
    </Modal>
  </div>
})
