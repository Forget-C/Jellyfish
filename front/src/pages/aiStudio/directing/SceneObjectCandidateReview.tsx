import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Spin } from 'antd'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { SceneObjectCandidate, SceneObjectCandidateReview as CandidateReview } from '../../../services/generated'
import { directingError } from './common'
import { WorkbenchDialogActions, WorkbenchModal } from './ui/WorkbenchModal'

function Changes({ label, objects, note }: {
  label: string; objects: SceneObjectCandidate[]; note?: (object: SceneObjectCandidate) => string;
}) {
  return <section>
    <h3>{label} {objects.length} 项</h3>
    {!!objects.length && <ul>{objects.map(object => <li key={object.id}>
      <strong>{object.name}</strong> · {object.excerpt}
      {note && note(object) && <div>{note(object)}</div>}
    </li>)}</ul>}
  </section>
}

function choiceLabel(object: SceneObjectCandidate) {
  return [object.asset_id && '资产关联', object.image_file_id && '参考图'].filter(Boolean).join('和')
}

/** 只确认当前预览，未知结果保留原命令，过期预览要求重新核对。 */
export function SceneObjectCandidateReview({ projectId, chapterId, sequenceId, taskId, editable, onClose }: {
  projectId: string; chapterId: string; sequenceId: string; taskId: string;
  editable: boolean; onClose: () => void;
}) {
  const [preview, setPreview] = useState<CandidateReview>()
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [readError, setReadError] = useState('')
  const [applyError, setApplyError] = useState('')
  const [applying, setApplying] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    let active = true
    const request = StudioDirectingService.directingSceneObjectCandidate({ projectId, chapterId, sequenceId, taskId })
    void request.then(({ data }) => {
      if (!data || data.task.task_id !== taskId) throw new Error('无法读取此对象提取结果')
      if (active) setPreview(data)
    }).catch(cause => { if (active) setReadError(directingError(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; request.cancel() }
  }, [projectId, chapterId, sequenceId, taskId, refresh])
  const reread = () => {
    setPreview(undefined); setLoading(true); setReadError(''); setUnknown(false)
    setRefresh(value => value + 1)
  }
  const apply = async () => {
    if (!editable || applying || !preview?.preview_token) return
    setApplying(true); setApplyError('')
    try {
      const response = await StudioDirectingService.directingSceneObjectCandidateApply({ projectId, chapterId, sequenceId, taskId,
        requestBody: { expected_revision: preview.revision, preview_token: preview.preview_token } })
      if (response.data?.task_id !== taskId || response.data.revision !== preview.revision + 1) throw new Error('无法核实应用回执')
      if (mounted.current) onClose()
    } catch (cause) {
      if (!mounted.current) return
      if (cause instanceof ApiError && [400, 404, 409, 422].includes(cause.status)) {
        setApplyError(directingError(cause)); reread()
      } else {
        setUnknown(true); setApplyError('应用结果待核实，可使用原确认再次核实。')
      }
    } finally { if (mounted.current) setApplying(false) }
  }
  const adopted = typeof preview?.applied_revision === 'number'
  return <WorkbenchModal title="核对对象差异" open width={660} closable={!applying} keyboard={!applying}
    maskClosable={false} onCancel={onClose}
    footer={<WorkbenchDialogActions secondary={<Button disabled={applying} onClick={onClose}>{adopted ? '关闭' : '暂不应用'}</Button>}>
      {!adopted && <Button type="primary" disabled={!editable || !preview?.preview_token} loading={applying}
        onClick={() => void apply()}>{unknown ? '核实应用结果' : '应用整批对象'}</Button>}
    </WorkbenchDialogActions>}>
    {loading && <Spin aria-label="正在核对对象差异" />}
    {readError && <Alert type="error" message={readError} action={<Button onClick={reread}>重新读取差异</Button>} />}
    {applyError && <Alert type="warning" showIcon message={applyError} />}
    {adopted && <Alert type="success" showIcon message="该结果已应用到本场对象准备" />}
    {preview && !adopted && <>
      {!preview.is_current && <Alert type="warning" showIcon message="历史场次可查看对象候选，恢复为当前场次后可重新核对。" />}
      {preview.source_changed && <Alert type="warning" showIcon message="已确认场次原文已变化，请重新提取对象。" />}
      <Changes label="新增" objects={preview.added} note={() => '待关联'} />
      <Changes label="移除" objects={preview.removed} note={object => choiceLabel(object) ? `本场${choiceLabel(object)}将移除` : ''} />
      <Changes label="修改" objects={preview.modified} note={object => object.description} />
      <Changes label="保留人工选择" objects={preview.retained_choices} note={object => `保留${choiceLabel(object)}`} />
      <p>确认后整批更新本场对象准备。项目资产仍可在资产库使用。</p>
    </>}
  </WorkbenchModal>
}
