import { useEffect, useState } from 'react'
import { Alert, Button } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { InstructionInputs_Output, SceneTakeLibraryRead, SceneVersionContent_Output } from '../../../services/generated'
import { directingError } from './common'
import { videoInputsMatch } from './sceneVideoInputs'

/** 仅核对原单元的实际输入；旧候选和人工判断始终保留，不自动采用或认定覆盖。 */
export function SceneTakeBasis({ projectId, sequenceId, versionId, take, content }: {
  projectId: string; sequenceId: string; versionId: string; take: SceneTakeLibraryRead; content: SceneVersionContent_Output
}) {
  const unit = content.units.find(row => row.id === take.unit_id)
  const comparisonContent = { ...content, take_judgments: [], timeline: { items: [] } }
  const requestKey = JSON.stringify([projectId, sequenceId, versionId, take.take_id, comparisonContent])
  const [checked, setChecked] = useState<{ key: string; inputs: InstructionInputs_Output }>()
  const [error, setError] = useState<{ key: string; message: string }>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    if (take.take_kind !== 'scene_video' || !take.video_preparation || !unit) return () => { active = false }
    setChecked(undefined); setError(undefined)
    const timer = setTimeout(() => {
      void StudioDirectingService.directingInstructionBasis({ projectId, sequenceId, versionId, unitId: unit.id, requestBody: { content: comparisonContent } }).then(response => {
        if (!response.data) throw new Error('当前生成依据尚未核实')
        if (active) setChecked({ key: requestKey, inputs: response.data.current })
      }).catch(cause => { if (active) setError({ key: requestKey, message: directingError(cause) }) })
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [requestKey, attempt])
  if (take.take_kind === 'production_plan') return <Alert type="info" message="旧生产计划素材：请按当前方案人工核对适用性" />
  if (!take.video_preparation) return <Alert type="warning" message="原素材生成依据尚未核实，请刷新素材库" />
  if (!unit) return <Alert type="info" message="原生成单元不在当前方案，作为旧依据候选人工核对" />
  if (error?.key === requestKey) return <Alert type="warning" message="素材生成依据核对失败" description={error.message}
    action={<Button onClick={() => { setChecked(undefined); setAttempt(value => value + 1) }}>重试素材依据核对</Button>} />
  if (checked?.key !== requestKey) return <p>正在核对素材生成依据，适用性尚未确定</p>
  const matches = videoInputsMatch(take.video_preparation, checked.inputs, unit.instruction)
  return <Alert type={matches ? 'info' : 'warning'} message={matches ? '素材生成输入与当前单元一致，仍需人工审片' : '旧依据候选：当前正文或相关生成依据已变化'}
    description="人工判断与生成依据分别保留；依据一致不代表实际覆盖，旧候选也不会自动计入当前覆盖。" />
}
