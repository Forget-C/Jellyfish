import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button, Descriptions, Dropdown, Input, Modal, Radio, Space, Spin } from 'antd'
import { MoreOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { ApiError, StudioDirectingService as Directing } from '../../../services/generated'
import type { SceneCanvasCreate, StoryboardBasis, StoryboardRequest } from '../../../services/generated'
import { workbenchManagementLocation } from './chapterNavigation'
import { directingError } from './common'
import { StoryboardBasisPreview } from './StoryboardBasisPreview'
import './workbench-canvas-creation.css'
import { useWorkspaceDraft, useWorkspaceDraftStatus } from './WorkspaceDrafts'

type Intent = { kind: 'storyboard'; body: StoryboardRequest } | { kind: 'blank'; body: SceneCanvasCreate }
type Kind = Intent['kind']
type Draft = {
  kind: Kind; defaultName: string; name: string; mode: NonNullable<StoryboardRequest['mode']>
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
export function WorkbenchCanvasCreation({ projectId, chapterId, sequenceId, sceneName, editable, actionHost, onAccepted, onReviewSource }: {
  projectId: string; chapterId: string; sequenceId: string; sceneName: string; editable: boolean
  actionHost: HTMLDivElement | null; onAccepted: (canvasId: string) => void
  onReviewSource: () => void
}) {
  const scope = { projectId, chapterId, sequenceId }
  const navigate = useNavigate()
  const nameId = useId()
  const key = 'jellyfish:management-canvas-submission:' + JSON.stringify([projectId, chapterId, sequenceId])
  const [pending, setPending] = useState(() => savedIntent(key))
  const [draft, setDraft] = useState<Draft>()
  const [stage, setStage] = useState<'configure' | 'confirm'>('configure')
  const [menuOpen, setMenuOpen] = useState(false)
  const moreButton = useRef<HTMLButtonElement>(null)
  const [basis, setBasis] = useState<StoryboardBasis>()
  const [basisLoading, setBasisLoading] = useState(false)
  const [basisError, setBasisError] = useState('')
  const [useSaved, setUseSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(false), sending = useRef(false), confirming = useRef(false)
  const needsBasis = draft?.kind === 'storyboard'
  const dirty = !!draft && !pending && (draft.name !== draft.defaultName || draft.mode !== 'complete' || needsBasis && useSaved)
  const { pendingNavigation } = useWorkspaceDraftStatus()
  const transition = useWorkspaceDraft({ name: '分镜画布配置', dirty, busy: submitting, discard: () => setDraft(undefined) })

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
  }, [projectId, chapterId, sequenceId, needsBasis])

  const start = (kind: Kind) => {
    const name = defaultCanvasName()
    setUseSaved(false); setStage('configure'); setDraft({ kind, defaultName: name, name, mode: 'complete' })
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
        if (mounted.current && !draft) {
          const restoredName = intent.body.name?.trim() || defaultCanvasName()
          setDraft({ kind: intent.kind, name: restoredName, defaultName: restoredName, mode: intent.kind === 'storyboard' ? intent.body.mode ?? 'complete' : 'complete' })
          setStage('configure')
        }
        if (mounted.current && cause.status === 409 && intent.kind === 'storyboard') {
          setBasis(undefined); setUseSaved(false); setStage('configure')
        }
      }
      if (mounted.current) setError(cause instanceof ApiError && cause.status === 409 && intent.kind === 'storyboard' ? '依据已变化，请关闭后重新打开核对。' : directingError(cause))
    } finally {
      sending.current = false
      if (mounted.current) setSubmitting(false)
    }
  }
  const title = needsBasis ? '生成新分镜画布' : '新建空白画布'
  const eligible = !needsBasis || !!basis && !basis.preparation_stale
    && (!basis.object_task_active || basis.preparation_revision > 0 && useSaved)
  const change = (values: Partial<Draft>) => setDraft(current => current && { ...current, ...values })
  const confirm = async () => {
    if (!editable || !draft || !eligible || pending || sending.current || confirming.current) return
    confirming.current = true
    try {
      const body = { name: draft.name.trim() || draft.defaultName, request_id: crypto.randomUUID() }
      if (draft.kind === 'blank') await submit({ kind: 'blank', body })
      else if (basis) await submit({ kind: 'storyboard', body: { ...body, mode: draft.mode,
        pending_modality: 'video', basis_token: basis.token, use_saved_objects: basis.object_task_active && useSaved } })
    } finally { confirming.current = false }
  }
  const close = () => {
    if (submitting) return
    transition(() => { setDraft(undefined); setError(''); if (draft?.kind === 'blank') requestAnimationFrame(() => moreButton.current?.focus()) })
  }
  const leave = (action: () => void) => transition(() => { setDraft(undefined); action() })
  const actions = <Space wrap>
    {pending ? !draft && <Button type="primary" loading={submitting} onClick={() => void submit(pending)}>核实提交</Button>
      : <>
        <Button type="primary" icon={<PlusOutlined aria-hidden />} disabled={!editable || !!draft} onClick={() => start('storyboard')}>生成新分镜画布</Button>
        <Dropdown trigger={['click']} open={menuOpen} onOpenChange={setMenuOpen} menu={{ items: [
          { key: 'blank', label: '新建空白画布', disabled: !editable || !!draft, onClick: () => {
            setMenuOpen(false)
            requestAnimationFrame(() => start('blank'))
          } },
        ] }}>
          <Button ref={moreButton} aria-label="画布更多操作" icon={<MoreOutlined />} disabled={!editable || !!draft}>更多</Button>
        </Dropdown>
      </>}
  </Space>
  return <>
    {actionHost && (editable || pending) && createPortal(actions, actionHost)}
    {pending && !draft && !submitting && <Alert type="warning" showIcon message="画布提交结果待核实，将使用原请求身份。" />}
    {!draft && error && <Alert type="error" showIcon message={error} />}
    <Modal wrapClassName="canvas-creation-wrap" className={`canvas-creation-dialog${needsBasis ? ' canvas-creation-storyboard' : ''}`} title={title} width={720} centered open={!!draft}
      maskClosable={false} closable={!submitting} keyboard={!submitting && !pendingNavigation} onCancel={close}
      footer={<Space wrap>
        <Button aria-label="取消" disabled={submitting} onClick={close}>取消</Button>
        {needsBasis && stage === 'confirm' && <Button disabled={submitting || !!pending} onClick={() => setStage('configure')}>返回配置</Button>}
        {pending ? <Button type="primary" loading={submitting} onClick={() => void submit(pending)}>{submitting ? '正在提交' : '核实提交'}</Button>
          : needsBasis && stage === 'configure' ? <Button type="primary" disabled={!eligible || !editable || basisLoading} onClick={() => setStage('confirm')}>下一步：确认生成</Button>
            : <Button type="primary" loading={submitting} disabled={!eligible || !editable} onClick={() => void confirm()}>{needsBasis ? '确认生成' : '创建画布'}</Button>}
      </Space>}>
      {error && <Alert type="error" showIcon message={error} />}
      {pending && !submitting && <Alert type="warning" showIcon message="提交结果待核实，请核实原请求，避免重复生成。" />}
      {draft && <div className="canvas-creation-fields">
        {needsBasis && stage === 'confirm' ? <>
          <p>将调用 AI 创建新的分镜画布，已有画布保持不变。</p>
          <Descriptions column={1} size="small" items={[
            { key: 'name', label: '画布名称', children: draft.name.trim() || draft.defaultName },
            { key: 'scene', label: '场次', children: sceneName },
            { key: 'mode', label: '分镜模式', children: draft.mode === 'faithful' ? '忠实提取' : '自动产出完整分镜' },
            { key: 'references', label: '采用依据', children: `${basis?.objects.length ?? 0} 个对象，其中 ${basis?.objects.filter(object => object.asset_id && !object.reference_unavailable).length ?? 0} 个已选用资源` },
          ]} />
        </> : <fieldset disabled={submitting || !!pending}>
          <label htmlFor={nameId}>画布名称</label>
          <Input id={nameId} value={draft.name} maxLength={255} onChange={event => change({ name: event.target.value })} />
          {needsBasis ? <><Radio.Group aria-label="分镜模式" value={draft.mode} options={[
            { value: 'complete', label: '自动产出完整分镜' }, { value: 'faithful', label: '忠实提取' },
          ]} onChange={event => change({ mode: event.target.value })} />
          <p>生成分镜设计和视频模型卡。打开卡片后可选择生产模型。</p></> : <p>画布从本场已确认摘录开始，保留固定原文卡片。</p>}
        </fieldset>}
        {needsBasis && (basisLoading ? <Spin aria-label="正在读取分镜依据" /> : basis
          ? <StoryboardBasisPreview basis={basis} compact readOnly={stage === 'confirm' || !!pending || submitting} useSaved={useSaved} onUseSaved={setUseSaved}
            onOpenSource={() => leave(onReviewSource)} onOpenObjects={() => leave(() => navigate(workbenchManagementLocation(projectId, chapterId, sequenceId, 'objects')))} />
          : <Alert type="warning" showIcon message={basisError || '请关闭后重新打开核对本次采用依据'} />)}
      </div>}
    </Modal>
  </>
}
