import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button, Card, Input, Radio, Select, Space, Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import { ApiError, LlmService, StudioDirectingService as Directing } from '../../../services/generated'
import type { ModelRead, SceneCanvasCreate, StoryboardBasis, StoryboardRequest } from '../../../services/generated'
import { workbenchManagementLocation } from './chapterNavigation'
import { directingError } from './common'
import { StoryboardBasisPreview } from './StoryboardBasisPreview'
import { useWorkspaceDraft } from './WorkspaceDrafts'

type Intent = { kind: 'storyboard'; body: StoryboardRequest } | { kind: 'blank'; body: SceneCanvasCreate }
type Kind = Intent['kind']
type Draft = {
  kind: Kind; defaultName: string; name: string; mode: NonNullable<StoryboardRequest['mode']>
  productionModel?: string; modality: NonNullable<StoryboardRequest['pending_modality']>
}

function defaultCanvasName() {
  const date = new Date()
  const pair = (number: number) => String(number).padStart(2, '0')
  return `分镜画布-${date.getFullYear()}${pair(date.getMonth() + 1)}${pair(date.getDate())}-${pair(date.getHours())}${pair(date.getMinutes())}${pair(date.getSeconds())}`
}

function savedIntent(key: string): Intent | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null') as Intent | null
    return value?.body.request_id && (value.kind === 'blank' || value.kind === 'storyboard') ? value : undefined
  } catch { return undefined }
}

/** 固定请求身份后提交，确认只刷新列表，离开配置不取消后台任务。 */
export function WorkbenchCanvasCreation({ projectId, chapterId, sequenceId, editable, actionHost, onAccepted }: {
  projectId: string; chapterId: string; sequenceId: string; editable: boolean
  actionHost: HTMLDivElement | null; onAccepted: (canvasId: string) => void
}) {
  const scope = { projectId, chapterId, sequenceId }
  const navigate = useNavigate()
  const headingId = useId(), nameId = useId()
  const key = 'jellyfish:management-canvas-submission:' + JSON.stringify([projectId, chapterId, sequenceId])
  const [pending, setPending] = useState(() => savedIntent(key))
  const [draft, setDraft] = useState<Draft>()
  const [basis, setBasis] = useState<StoryboardBasis>()
  const [basisLoading, setBasisLoading] = useState(false)
  const [basisError, setBasisError] = useState('')
  const [basisRevision, setBasisRevision] = useState(0)
  const [models, setModels] = useState<ModelRead[]>([])
  const [modelError, setModelError] = useState(false)
  const [useSaved, setUseSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(false), sending = useRef(false)
  const needsBasis = draft?.kind === 'storyboard'
  const dirty = !!draft && !pending && (draft.name !== draft.defaultName || draft.mode !== 'complete'
    || !!draft.productionModel || draft.modality !== 'image')
  useWorkspaceDraft({ name: '分镜画布配置', dirty, discard: () => setDraft(undefined) })

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!needsBasis) return
    let active = true
    setBasis(undefined); setBasisError(''); setBasisLoading(true); setUseSaved(false)
    const request = Directing.directingStoryboardBasis({ projectId, chapterId, sequenceId })
    void request.then(response => {
      if (!active) return
      if (!response.data) throw new Error('无法读取分镜依据')
      setBasis(response.data)
    }).catch(cause => { if (active) setBasisError(directingError(cause)) })
      .finally(() => { if (active) setBasisLoading(false) })
    return () => { active = false; request.cancel() }
  }, [projectId, chapterId, sequenceId, needsBasis, basisRevision])

  useEffect(() => {
    if (!needsBasis) return
    let active = true
    setModelError(false)
    const request = LlmService.listModelsApiV1LlmModelsGet({ pageSize: 100 })
    void request.then(response => {
      if (active) setModels(response.data?.items.filter(model => model.category === 'image' || model.category === 'video') ?? [])
    }).catch(() => { if (active) setModelError(true) })
    return () => { active = false; request.cancel() }
  }, [needsBasis])

  const start = (kind: Kind) => {
    const name = defaultCanvasName()
    setDraft({ kind, defaultName: name, name, mode: 'complete', modality: 'image' })
    setError('')
  }
  const submit = async (intent: Intent) => {
    if (sending.current) return
    const clear = () => {
      try {
        if (savedIntent(key)?.body.request_id === intent.body.request_id) localStorage.removeItem(key)
      } catch { /* 原请求仍可安全核实。 */ }
      if (mounted.current) setPending(savedIntent(key))
    }
    try {
      const previous = savedIntent(key)
      if (previous && previous.body.request_id !== intent.body.request_id) {
        setPending(previous)
        throw new Error('请先核实此前的画布提交')
      }
      localStorage.setItem(key, JSON.stringify(intent))
    } catch (cause) { setError(directingError(cause)); return }
    sending.current = true
    setSubmitting(true); setPending(intent); setError('')
    try {
      const id = intent.kind === 'storyboard'
        ? (await Directing.directingStoryboardSubmit({ ...scope, requestBody: intent.body })).data?.canvas_id
        : (await Directing.directingSceneCanvasCreate({ ...scope, requestBody: intent.body })).data?.id
      if (!id) throw new Error('画布提交结果待核实')
      clear()
      if (!mounted.current) return
      setDraft(undefined)
      onAccepted(id)
    } catch (cause) {
      if (cause instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(cause.status)) {
        clear()
        if (mounted.current && cause.status === 409 && intent.kind === 'storyboard') {
          setBasis(undefined); setUseSaved(false)
        }
      }
      if (mounted.current) setError(directingError(cause))
    } finally {
      sending.current = false
      if (mounted.current) setSubmitting(false)
    }
  }
  const title = needsBasis ? '生成新分镜画布' : '新建空白画布'
  const eligible = !needsBasis || !!basis && !basis.preparation_stale
    && (!basis.object_task_active || basis.preparation_revision > 0 && useSaved)
  const change = (values: Partial<Draft>) => setDraft(current => current && { ...current, ...values })
  const confirm = () => {
    if (!editable || !draft || !eligible || pending || sending.current) return
    const body = { name: draft.name.trim() || draft.defaultName, request_id: crypto.randomUUID() }
    if (draft.kind === 'blank') void submit({ kind: 'blank', body })
    else if (basis) void submit({ kind: 'storyboard', body: { ...body, mode: draft.mode,
      production_model_id: draft.productionModel, pending_modality: draft.productionModel ? undefined : draft.modality,
      basis_token: basis.token, use_saved_objects: basis.object_task_active && useSaved } })
  }
  const refreshBasis = () => setBasisRevision(value => value + 1)
  const actions = <Space wrap>
    {pending ? <Button type="primary" loading={submitting} onClick={() => void submit(pending)}>核实提交</Button>
      : <>
        <Button type="primary" disabled={!editable || !!draft} onClick={() => start('storyboard')}>生成新分镜画布</Button>
        <Button disabled={!editable || !!draft} onClick={() => start('blank')}>新建空白画布</Button>
      </>}
  </Space>
  return <>
    {actionHost && (editable || pending) && createPortal(actions, actionHost)}
    {pending && !submitting && <Alert type="warning" showIcon message="画布提交结果待核实，将使用原请求身份。" />}
    {error && <Alert type="error" showIcon message={error} />}
    {draft && (!pending || submitting) && <section aria-labelledby={headingId} className="management-canvas-configuration">
      <Card size="small">
        <h3 id={headingId}>{title}配置</h3>
        <fieldset disabled={submitting}>
          <label htmlFor={nameId}>画布名称</label>
          <Input id={nameId} value={draft.name} maxLength={255} onChange={event => change({ name: event.target.value })} />
          {needsBasis ? <>
            <Radio.Group aria-label="分镜模式" value={draft.mode} options={[
              { value: 'complete', label: '自动产出完整分镜' },
              { value: 'faithful', label: '忠实提取' },
            ]} onChange={event => change({ mode: event.target.value })} />
            <Select aria-label="生产模型" placeholder="稍后配置生产模型" allowClear value={draft.productionModel}
              options={models.map(model => ({ value: model.id, label: model.name }))}
              onChange={productionModel => change({ productionModel })} />
            {!draft.productionModel && <Radio.Group aria-label="待配置卡片类型" value={draft.modality} options={[
              { value: 'image', label: '图片模型卡' }, { value: 'video', label: '视频模型卡' },
            ]} onChange={event => change({ modality: event.target.value })} />}
            <p>生产模型用于后续制作，提交分镜只生成设计。</p>
            {modelError && <Alert type="warning" showIcon message="无法读取生产模型，可以稍后在画布中选择。" />}
            {basisLoading ? <Spin aria-label="正在读取分镜依据" /> : basis
              ? <StoryboardBasisPreview basis={basis} useSaved={useSaved} onUseSaved={setUseSaved} onRefresh={refreshBasis}
                onOpenSource={() => navigate(workbenchManagementLocation(projectId, chapterId, sequenceId, 'division'))}
                onOpenObjects={() => navigate(workbenchManagementLocation(projectId, chapterId, sequenceId, 'objects'))} />
              : <Alert type="warning" showIcon message={basisError || '请重新核对本次采用依据'}
                action={<Button size="small" onClick={refreshBasis}>重新读取依据</Button>} />}
          </> : <p>画布从本场已确认摘录开始，保留固定原文卡片。</p>}
        </fieldset>
        <Space wrap>
          <Button onClick={() => { setDraft(undefined); setError('') }} disabled={submitting}>取消</Button>
          <Button type="primary" loading={submitting} disabled={!eligible || !editable} onClick={confirm}>
            {needsBasis ? '开始提取' : '创建画布'}
          </Button>
        </Space>
      </Card>
    </section>}
  </>
}
