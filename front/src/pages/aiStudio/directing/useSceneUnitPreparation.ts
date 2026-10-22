import { useEffect, useState } from 'react'
import { LlmService, StudioDirectingService } from '../../../services/generated'
import type { CanvasTarget, EditableGenerationUnit_Output, SceneVersionContent_Output, UnitCanvasGraph, VideoGenerationOptionsRead, VideoReferenceCapabilities } from '../../../services/generated'
import { useSceneFrameEvidence, sceneDependencyIssue } from './SceneFrameDependencies'
import { referenceIssues } from './referenceInput'
import { directingError } from './common'

export type ScenePreparationIssue = { message: string; fieldId: string; nodeId?: string; target?: CanvasTarget }

/** 两个画布复用同一准备校验；能力与落幅未核实时不放行生成。 */
export function useSceneUnitPreparation(projectId: string, sequenceId: string, versionId: string, revision: number, content: SceneVersionContent_Output, unit: EditableGenerationUnit_Output | undefined, attempt = 0, graphState?: { graph?: UnitCanvasGraph; current: boolean; pending: boolean; error: string }) {
  const modelKey = JSON.stringify([projectId, unit?.model_id, attempt])
  const [modelResult, setModelResult] = useState<{ key: string; options: VideoGenerationOptionsRead; capability: VideoReferenceCapabilities }>()
  const [modelFailure, setModelFailure] = useState<{ key: string; message: string }>()
  const options = modelResult?.key === modelKey ? modelResult.options : undefined
  const capability = modelResult?.key === modelKey ? modelResult.capability : undefined
  const capabilityError = modelFailure?.key === modelKey ? modelFailure.message : ''
  const frameEvidence = useSceneFrameEvidence(projectId, sequenceId, versionId, revision, unit)
  const basis = graphState?.current ? graphState.graph?.nodes.find(row => row.kind === 'unit_basis' && row.unit_id === unit?.id) : undefined
  useEffect(() => {
    let active = true
    if (unit?.model_id) void Promise.all([
      LlmService.getVideoGenerationOptionsApiV1LlmVideoGenerationOptionsGet({ modelId: unit.model_id }),
      StudioDirectingService.directingReferenceCapabilities({ projectId, modelId: unit.model_id }),
    ]).then(([settings, references]) => {
      if (!settings.data || !references.data || settings.data.model_id !== unit?.model_id || references.data.model_id !== unit?.model_id) throw new Error('模型能力尚未核实')
      if (active) { setModelResult({ key: modelKey, options: settings.data, capability: references.data }); setModelFailure(undefined) }
    }).catch(error => { if (active) setModelFailure({ key: modelKey, message: directingError(error) }) })
    return () => { active = false }
  }, [modelKey, projectId, unit?.model_id])
  const missing: ScenePreparationIssue[] = []
  if (unit) {
    if (graphState?.error) missing.push({ message: `设计范围核实失败：${graphState.error}`, fieldId: 'scene-unit-basis' })
    else if (basis?.kind !== 'unit_basis') missing.push({ message: '核实本单元设计范围', fieldId: 'scene-unit-basis' })
    else basis.issues.forEach(issue => missing.push({ message: issue.message, fieldId: issue.target.field || 'scene-unit-basis', target: issue.target }))
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
    if (unit.model_id && options?.model_id !== unit.model_id) missing.push({ message: capabilityError ? `模型能力核实失败：${capabilityError}` : '核实模型能力', fieldId: 'scene-unit-model' })
    for (const message of referenceIssues(unit.references, capability?.model_id === unit.model_id ? capability : undefined)) missing.push({ message, fieldId: 'scene-unit-references', nodeId: '参考素材' })
    if ((unit.scene_dependencies || []).length) {
      const issue = frameEvidence.loading ? '正在核实前段实际落幅' : frameEvidence.error ? '重新核实前段实际落幅' : (unit.scene_dependencies || []).map(link => sceneDependencyIssue(link, unit, frameEvidence.frames, content, versionId)).find(Boolean)
      if (issue) missing.push({ message: issue, fieldId: 'scene-unit-dependencies' })
    }
    if (unit.dependencies.some(link => !link.frame_id || !link.reference_id)) missing.push({ message: '绑定前段实际落幅', fieldId: 'scene-unit-dependencies' })
    if (graphState?.current) graphState.graph?.nodes.forEach(node => {
      if (!('unit_id' in node) || node.unit_id !== unit.id) return
      for (const issue of node.issues) {
        if (!(issue.code === 'single-coverage-required' || issue.code === 'model-input-invalid' ||
          issue.code === 'capability-unverified' || issue.code.startsWith('reference-file-') || issue.code.startsWith('dependency-'))) continue
        const fieldId = node.kind === 'unit_references' ? 'scene-unit-references'
          : node.kind === 'unit_config' && node.config_kind === 'dependencies' ? 'scene-unit-dependencies'
            : node.kind === 'unit_config' ? 'scene-unit-model' : 'scene-unit-basis'
        if (missing.some(row => row.message === issue.message || row.fieldId === fieldId) ||
          fieldId === 'scene-unit-model' && missing.some(row => ['scene-unit-duration', 'scene-unit-ratio', 'scene-unit-parameters'].includes(row.fieldId))) continue
        missing.push({ message: issue.message, fieldId, target: issue.target })
      }
    })
  }
  const checking = !!unit && (!!graphState?.pending || !graphState?.error && basis?.kind !== 'unit_basis' ||
    !!unit.model_id && !capabilityError && options?.model_id !== unit.model_id || !!unit.scene_dependencies?.length && frameEvidence.loading)
  const failed = !!graphState?.error || !!capabilityError || !!unit?.scene_dependencies?.length && !!frameEvidence.error
  return { options, capability, capabilityError, frameEvidence, missing, checking, failed }
}
