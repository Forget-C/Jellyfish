import { useUiText } from '../../../uiText'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, ConfigProvider, Modal, Space, Spin, theme } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { SceneObjectCandidate, SceneObjectCandidateReview as CandidateReview } from '../../../services/generated'
import { apiErrorMessage } from '../../../services/apiErrorMessage'

function Changes({ label, objects, note }: {
  label: string; objects: SceneObjectCandidate[]; note?: (object: SceneObjectCandidate) => string;
}) {
  const uiText = useUiText()
  return <section>
    <h3>{label} {objects.length} {uiText("项")}</h3>
    {!!objects.length && <ul>{objects.map(object => <li key={object.id}>
      <strong>{object.name}</strong> · {object.excerpt}
      {note && note(object) && <div>{note(object)}</div>}
    </li>)}</ul>}
  </section>
}

function choiceLabel(object: SceneObjectCandidate) {
  return [object.asset_id && '资源选用'].filter(Boolean).join('和')
}

const taskStatus = { queued: '对象提取排队中', running: '正在提取对象', failed: '对象提取失败',
  cancelled: '对象提取已取消', succeeded: '对象提取已完成，暂无可核对差异' }

/** 只确认当前预览，未知结果保留原命令，过期预览要求重新核对。 */
export function SceneObjectCandidateReview({ projectId, chapterId, sequenceId, taskId, editable, onClose, management = false }: {
  projectId: string; chapterId: string; sequenceId: string; taskId: string;
  editable: boolean; onClose: () => void; management?: boolean;
}) {
  const uiText = useUiText()
  const { token } = theme.useToken()
  const warningStyle = { color: token.colorWarningTextActive, borderColor: token.colorWarningBorder, backgroundColor: token.colorWarningBg }
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
    let timer: number | undefined
    const request = StudioDirectingService.directingSceneObjectCandidate({ projectId, chapterId, sequenceId, taskId })
    void request.then(({ data }) => {
      if (!data || data.task.task_id !== taskId) throw new Error(uiText("无法读取此对象提取结果"))
      if (active) {
        setPreview(data); setReadError('')
        if (data.task.status === 'queued' || data.task.status === 'running') {
          timer = window.setTimeout(() => setRefresh(value => value + 1), 1200)
        }
      }
    }).catch(cause => { if (active) setReadError(apiErrorMessage(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; window.clearTimeout(timer); request.cancel() }
  }, [uiText, projectId, chapterId, sequenceId, taskId, refresh])
  const reread = () => {
    setPreview(undefined); setLoading(true); setReadError(''); setUnknown(false)
    setRefresh(value => value + 1)
  }
  const status = preview?.task.status
  const apply = async () => {
    if (!editable || applying || !preview?.preview_token) return
    setApplying(true); setApplyError('')
    try {
      const response = await StudioDirectingService.directingSceneObjectCandidateApply({ projectId, chapterId, sequenceId, taskId,
        requestBody: { expected_revision: preview.revision, preview_token: preview.preview_token } })
      if (response.data?.task_id !== taskId || response.data.revision !== preview.revision + 1) throw new Error(uiText("无法核实应用回执"))
      if (mounted.current) onClose()
    } catch (cause) {
      if (!mounted.current) return
      if (cause instanceof ApiError && [400, 404, 409, 422].includes(cause.status)) {
        setApplyError(apiErrorMessage(cause)); reread()
      } else {
        setUnknown(true); setApplyError(uiText("应用结果待核实，可使用原确认再次核实。"))
      }
    } finally { if (mounted.current) setApplying(false) }
  }
  const discard = async () => {
    if (!editable || applying || unknown) return
    setApplying(true); setApplyError('')
    try {
      await StudioDirectingService.directingSceneObjectCandidateDiscard({ projectId, chapterId, sequenceId, taskId })
      if (mounted.current) onClose()
    } catch (cause) { if (mounted.current) setApplyError(apiErrorMessage(cause)) }
    finally { if (mounted.current) setApplying(false) }
  }
  const adopted = typeof preview?.applied_revision === 'number'
  const hasCandidate = preview?.candidate_available
  return <Modal className={management ? 'management-object-dialog management-object-review-dialog' : undefined} title={hasCandidate ? uiText("核对对象差异") : uiText("对象提取任务")} open width={660} closable={!applying} keyboard={!applying}
    maskClosable={false} onCancel={onClose}
    styles={{ body: { maxHeight: 'calc(100dvh - 240px)', overflowY: 'auto' } }}
    footer={<Space wrap><Button disabled={applying} onClick={onClose}>{adopted || !hasCandidate ? uiText("关闭") : uiText("暂不应用")}</Button>
      {hasCandidate && !adopted && <ConfigProvider theme={{ token: { colorPrimary: token.colorWarning, colorPrimaryHover: token.colorWarningTextActive, colorPrimaryActive: token.colorWarningActive }, components: { Button: { defaultColor: token.colorWarningTextActive, defaultBorderColor: token.colorWarningBorder, defaultBg: token.colorWarningBg } } }}><Button icon={<ExclamationCircleOutlined />} aria-label={uiText("退出本次提取")} disabled={!editable || applying || unknown} onClick={() => Modal.confirm({
        title: uiText("确认退出本次提取？"), content: uiText("本轮未应用的提取结果将被忽略，已有对象和资源引用保持不变。退出后可重新提取。"),
        okText: uiText("确认退出"), cancelText: uiText("继续核对"), okType: 'default', okButtonProps: { style: warningStyle }, onOk: discard,
      })}>{uiText("退出本次提取")}</Button></ConfigProvider>}
      {hasCandidate && !adopted && <Button type="primary" disabled={!editable || !preview?.preview_token} loading={applying}
        onClick={() => void apply()}>{unknown ? uiText("核实应用结果") : uiText("应用整批对象")}</Button>}
    </Space>}>
    {loading && <Spin aria-label={uiText("正在核对对象差异")} />}
    {readError && <Alert type="error" message={readError} action={<Button onClick={reread}>{uiText("重新读取差异")}</Button>} />}
    {applyError && <Alert type="warning" showIcon message={applyError} />}
    {adopted && <Alert type="success" showIcon message={uiText("该结果已应用到本场对象准备")} />}
    {preview && !hasCandidate && <Alert type={status === 'failed' ? 'warning' : 'info'} showIcon
      message={uiText(taskStatus[preview.task.status])} description={preview.task.error} />}
    {preview && hasCandidate && !adopted && <>
      {!preview.is_current && <Alert type="warning" showIcon message={uiText("历史场次可查看对象候选，恢复为当前场次后可重新核对。")} />}
      {preview.source_changed && <Alert type="warning" showIcon message={uiText("已确认场次原文已变化，请重新提取对象。")} />}
      <Changes label={uiText("新增")} objects={preview.added} note={() => uiText("待关联")} />
      <Changes label={uiText("移除")} objects={preview.removed} note={object => choiceLabel(object) ? uiText("本场资源选用将移除") : ''} />
      <Changes label={uiText("修改")} objects={preview.modified} note={object => object.description} />
      <Changes label={uiText("保留人工选择")} objects={preview.retained_choices} note={object => uiText(object.asset_id ? "保留资源选用" : "保留")} />
      <p>{uiText("确认后整批更新本场对象准备。项目对象与已关联资产仍保留在项目资源中。")}</p>
    </>}
  </Modal>
}
