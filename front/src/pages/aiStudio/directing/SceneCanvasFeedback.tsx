import { useUiText } from '../../../uiText'
import { useEffect, useState } from 'react'
import { Alert } from 'antd'
import type { CanvasRead } from '../../../services/generated'
import { consumeStoryboardRiskNotice } from './storyboardRiskNotice'

/** 分镜采用风险与章节来源提示只在场次宿主中显示。 */
export function SceneCanvasFeedback({ current }: { current?: CanvasRead }) {
  const uiText = useUiText()
  const [notice, setNotice] = useState<string>()
  useEffect(() => {
    const applied = current?.document.storyboard
    if (current?.project_id && consumeStoryboardRiskNotice(current.project_id, current.id, applied?.continuity_check_task_id ?? applied?.task_id)) setNotice(current.id)
  }, [current])
  return <>
    {notice === current?.id && notice && <Alert type="info" showIcon closable onClose={() => setNotice(undefined)} message={uiText("已按你的选择保留设计并接受相关风险")} />}
    {current?.source_changed && <Alert type="warning" showIcon message={uiText("章节原文已变化，画布仍保留当前固定原文。")} />}
  </>
}
