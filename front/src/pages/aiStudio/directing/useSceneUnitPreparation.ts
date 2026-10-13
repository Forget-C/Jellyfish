import { useEffect, useState } from 'react'
import { LlmService, StudioDirectingService } from '../../../services/generated'
import type { EditableGenerationUnit_Output, SceneVersionContent_Output, VideoGenerationOptionsRead, VideoReferenceCapabilities } from '../../../services/generated'
import { useSceneFrameEvidence, sceneDependencyIssue } from './SceneFrameDependencies'
import { referenceIssues } from './referenceInput'
import { directingError } from './common'

export type ScenePreparationIssue = { message: string; fieldId: string; nodeId?: string }

/** 两个画布复用同一准备校验；能力与落幅未核实时不放行生成。 */
export function useSceneUnitPreparation(projectId: string, sequenceId: string, versionId: string, revision: number, content: SceneVersionContent_Output, unit: EditableGenerationUnit_Output | undefined, attempt = 0) {
  const [options, setOptions] = useState<VideoGenerationOptionsRead>()
  const [capability, setCapability] = useState<VideoReferenceCapabilities>()
  const [capabilityError, setCapabilityError] = useState('')
  const frameEvidence = useSceneFrameEvidence(projectId, sequenceId, versionId, revision, unit)
  useEffect(() => {
    let active = true
    setOptions(undefined); setCapability(undefined); setCapabilityError('')
    if (unit?.model_id) void Promise.all([
      LlmService.getVideoGenerationOptionsApiV1LlmVideoGenerationOptionsGet({ modelId: unit.model_id }),
      StudioDirectingService.directingReferenceCapabilities({ projectId, modelId: unit.model_id }),
    ]).then(([settings, references]) => {
      if (!settings.data || !references.data) throw new Error('模型能力尚未核实')
      if (active) { setOptions(settings.data); setCapability(references.data) }
    }).catch(error => { if (active) setCapabilityError(directingError(error)) })
    return () => { active = false }
  }, [projectId, unit?.model_id, attempt])
  const missing: ScenePreparationIssue[] = []
  if (unit) {
    if (!unit.model_id) missing.push({ message: '选择视频模型', fieldId: 'scene-unit-model' })
    if (!unit.duration_ms) missing.push({ message: '填写预计时长', fieldId: 'scene-unit-duration' })
    else if (unit.duration_ms % 1000) missing.push({ message: '当前执行器要求整秒时长，请修改预计时长', fieldId: 'scene-unit-duration' })
    unit.coverage.forEach((item, index) => {
      if (!item.action_scope.trim()) missing.push({ message: `明确覆盖 ${index + 1} 的动作范围`, fieldId: `scene-unit-action-${item.id}` })
    })
    if (Object.keys(unit.parameters).some(key => key !== 'seed')) missing.push({ message: '移除当前执行器不支持的额外参数', fieldId: 'scene-unit-parameters' })
    const seed = unit.parameters.seed
    if (seed != null && (typeof seed !== 'number' || !Number.isInteger(seed) || seed < -1 || seed > 4294967295)) missing.push({ message: '随机种子须为 -1 或 0–4294967295 的整数', fieldId: 'scene-unit-parameters' })
    if (!unit.ratio.trim()) missing.push({ message: '填写单元画幅', fieldId: 'scene-unit-ratio' })
    if (options?.model_id === unit.model_id && !(options.allowed_ratios || []).includes(unit.ratio)) missing.push({ message: '模型不支持当前画幅，请修改模型或画幅', fieldId: 'scene-unit-ratio' })
    if (unit.model_id && options?.model_id !== unit.model_id) missing.push({ message: '核实模型能力', fieldId: 'scene-unit-model' })
    for (const message of referenceIssues(unit.references, capability?.model_id === unit.model_id ? capability : undefined)) missing.push({ message, fieldId: 'scene-unit-references', nodeId: '参考素材' })
    if ((unit.scene_dependencies || []).length) {
      const issue = frameEvidence.loading ? '正在核实前段实际落幅' : frameEvidence.error ? '重新核实前段实际落幅' : (unit.scene_dependencies || []).map(link => sceneDependencyIssue(link, unit, frameEvidence.frames, content, versionId)).find(Boolean)
      if (issue) missing.push({ message: issue, fieldId: 'scene-unit-dependencies' })
    }
    if (unit.dependencies.some(link => !link.frame_id || !link.reference_id)) missing.push({ message: '绑定前段实际落幅', fieldId: 'scene-unit-dependencies' })
  }
  return { options, capability, capabilityError, frameEvidence, missing }
}
