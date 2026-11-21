import { useUiText } from '../../../uiText'
import { persistSceneChange } from './sceneCanvasPersistence'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Space } from 'antd'
import { useGenerationCanvasEditor } from '../generationCanvas/useGenerationCanvasEditor'

/** 在管理页通过共同编辑权、保存与恢复机制提交明确的名称变更。 */
export function WorkbenchCanvasRename({ projectId, chapterId, sequenceId, canvasId, initialName, onClose }: {
  projectId: string; chapterId: string; sequenceId: string; canvasId: string; initialName: string;
  onClose: (name?: string) => void;
}) {
  const uiText = useUiText()
  const editor = useGenerationCanvasEditor(projectId, canvasId, false, persistSceneChange)
  const { current, ownership, pendingRename } = editor
  const [name, setName] = useState(initialName)
  const [submitting, setSubmitting] = useState(false)
  const touched = useRef(false)
  const currentName = current?.document.name
  useEffect(() => {
    if (!touched.current && (pendingRename ?? currentName) !== undefined) setName(pendingRename ?? currentName ?? initialName)
  }, [pendingRename, currentName, initialName])
  const valid = !!name.trim() && Array.from(name).length <= 255
  const matched = current?.scene?.chapter_id === chapterId && current.scene.sequence_id === sequenceId
  const busy = submitting || editor.saving
  const canConfirm = matched && ownership.editable && (pendingRename !== undefined || valid && !editor.recovery)
  const confirm = async () => {
    if (!canConfirm || busy) return
    touched.current = true
    setSubmitting(true)
    try {
      const savedName = await editor.renameSceneCanvas(name, { chapterId, sequenceId })
      if (savedName !== undefined) onClose(savedName)
    } finally { setSubmitting(false) }
  }
  return <Modal open title={uiText("更名画布")} maskClosable={false} keyboard={!busy} closable={!busy}
    focusTriggerAfterClose={false} onCancel={() => { if (!busy) onClose() }}
    footer={<Space>
      <Button aria-label={uiText("取消")} disabled={busy} onClick={() => onClose()}>{uiText("取消")}</Button>
      <Button type="primary" loading={busy} disabled={!canConfirm} onClick={() => void confirm()}>
        {pendingRename !== undefined ? uiText("核实更名结果") : uiText("保存名称")}
      </Button>
    </Space>}>
    <Space direction="vertical" style={{ width: '100%' }}>
      <label htmlFor="management-canvas-rename-name">{uiText("画布名称")}</label>
      <Input id="management-canvas-rename-name" autoFocus value={name} disabled={busy || pendingRename !== undefined}
        status={valid ? undefined : 'error'} onChange={event => { touched.current = true; setName(event.target.value) }}
        onPressEnter={() => void confirm()} />
      {!valid && <span role="status">{uiText("请输入 1–255 个字符，名称不能只含空白。")}</span>}
      {current && !matched && <Alert type="error" message={uiText("该画布不属于当前场次")} />}
      {editor.recovery && pendingRename === undefined && <Alert type="warning" message={uiText("请在画布中处理未保存的内容，再更名。")} />}
      {!ownership.editable && ownership.state !== 'checking' && <Alert type="warning" showIcon
        message={ownership.message || (ownership.state === 'unsupported' ? uiText("当前浏览器无法确认画布编辑权。") : uiText("请先结束其他页面的画布编辑，再重试取得编辑权。"))}
        action={ownership.state === 'unsupported' ? undefined : <Button size="small" loading={ownership.state === 'waiting'}
          onClick={ownership.state === 'choice' ? ownership.cancelHandoff : ownership.takeEditing}>
          {ownership.state === 'choice' ? uiText("取消交接") : uiText("重试取得编辑权")}
        </Button>} />}
      {editor.error && <Alert type="error" showIcon message={editor.error}
        description={editor.error.includes('REVISION_CONFLICT') ? uiText("再次保存会读取最新画布，并应用保留的名称。") : undefined} />}
      {editor.storageError && <Alert type="warning" showIcon message={editor.storageError} />}
    </Space>
  </Modal>
}
