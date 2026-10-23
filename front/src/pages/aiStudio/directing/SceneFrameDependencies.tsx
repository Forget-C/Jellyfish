import { useEffect, useState } from 'react'
import { Alert, Button } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { EditableGenerationUnit_Output, SceneEndFrameRead, SceneFrameDependency, SceneVersionContent_Output } from '../../../services/generated'
import { directingError } from './common'
import type { ScenePredecessorSelection } from './ScenePredecessorDialog'
import { WorkbenchButton } from './ui/WorkbenchButton'

export function useSceneFrameEvidence(projectId: string, sequenceId: string, versionId: string, revision: number, unit?: EditableGenerationUnit_Output) {
  const versions = JSON.stringify([...new Set([versionId, ...(unit?.scene_dependencies || []).map(link => link.version_id)])].sort())
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([projectId, sequenceId, versions, revision, attempt])
  const [result, setResult] = useState<{ key: string; frames: SceneEndFrameRead[] }>()
  const [failure, setFailure] = useState<{ key: string; message: string }>()
  useEffect(() => {
    let active = true
    void Promise.all((JSON.parse(versions) as string[]).map(sourceVersion => StudioDirectingService.directingSceneEndFrames({ projectId, sequenceId, versionId: sourceVersion })))
      .then(results => {
        if (results.some(row => !row.data)) throw new Error('前段实际落幅尚未核实')
        if (active) { setResult({ key, frames: results.flatMap(row => row.data!) }); setFailure(undefined) }
      }).catch(cause => { if (active) setFailure({ key, message: directingError(cause) }) })
    return () => { active = false }
  }, [key, projectId, sequenceId, versions])
  return { frames: result?.key === key ? result.frames : [], loading: result?.key !== key && failure?.key !== key,
    error: failure?.key === key ? failure.message : '', reload: () => setAttempt(value => value + 1) }
}

export function sceneFrameCurrent(frame: SceneEndFrameRead, content: SceneVersionContent_Output, versionId: string) {
  if (frame.version_id !== versionId) return frame.matches_current
  const clip = content.timeline.items.find(item => item.id === frame.clip.id)
  return clip && 'media_range' in clip && clip.take_kind === frame.clip.take_kind && clip.take_id === frame.clip.take_id
    && clip.file_id === frame.clip.file_id && clip.media_range.source_in_ms === frame.clip.media_range.source_in_ms
    && clip.media_range.source_out_ms === frame.clip.media_range.source_out_ms
}

export function sceneDependencyIssue(link: SceneFrameDependency, unit: EditableGenerationUnit_Output, frames: SceneEndFrameRead[], content: SceneVersionContent_Output, versionId: string) {
  if (!link.frame_id) return '尚未绑定实际落幅，请先提取再明确选择'
  const frame = frames.find(row => row.id === link.frame_id && row.version_id === link.version_id && row.clip.id === link.clip_id)
  if (!frame || !frame.available) return '实际落幅不可用，请恢复原文件或明确换绑'
  if (!sceneFrameCurrent(frame, content, versionId)) return '实际落幅依据已变，请重新提取并明确换绑'
  const reference = unit.references.find(row => row.id === link.reference_id)
  if (!reference || reference.file_id !== frame.file_id || reference.media_kind !== 'image' || reference.purpose !== 'continuity') return '实际落幅参考输入已变，请明确重新绑定'
  return ''
}

/** 新场次依赖明确引用单次采用；选择落幅才同步建立实际模型参考。 */
export function SceneFrameDependencies({ unit, content, versionId, evidence, disabled, onChange, onOpenEdit, onSelect }: {
  onSelect: (selection: ScenePredecessorSelection) => void
  onOpenEdit: (clipId: string) => void
  unit: EditableGenerationUnit_Output; content: SceneVersionContent_Output; versionId: string; evidence: ReturnType<typeof useSceneFrameEvidence>; disabled: boolean
  onChange: (changes: Partial<EditableGenerationUnit_Output>) => void
}) {
  const links = unit.scene_dependencies || []
  const { frames, loading, error, reload } = evidence
  const items = [...content.timeline.items].sort((a, b) => a.timeline_start_ms - b.timeline_start_ms || a.id.localeCompare(b.id))
  const bind = (link: SceneFrameDependency, frame: SceneEndFrameRead) => {
    if (disabled || loading || error || !frame.available || !sceneFrameCurrent(frame, content, versionId)) return
    const referenceId = link.reference_id || crypto.randomUUID()
    const previous = unit.references.find(row => row.id === referenceId)
    const reference = { id: referenceId, file_id: frame.file_id, media_kind: 'image' as const, purpose: 'continuity' as const,
      participant_ids: previous?.participant_ids || [], ordinal: previous?.ordinal ?? Math.max(-1, ...unit.references.map(row => row.ordinal)) + 1,
      input_role: 'first_frame' as const, source: frame.source }
    onSelect({ kind: 'scene', link: { ...link, frame_id: frame.id, reference_id: referenceId }, reference })
  }
  return <section aria-label="场次版本落幅依赖"><h3>场次版本实际落幅依赖</h3>
    <p>每单元承接一个前段；选择来源采用，再将已提取的实际落幅明确应用为首帧。换绑后前往指令画布更新正文依据并重新检查。</p>
    <Button loading={loading} onClick={reload}>刷新场次落幅</Button>
    {error && <Alert type="warning" message="场次落幅读取失败，依赖适用性尚未核实" description={error} />}
    {items.map((clip, index) => 'media_range' in clip && <Button key={clip.id} disabled={disabled || links.some(link => link.version_id === versionId && link.clip_id === clip.id)}
      onClick={() => onSelect({ kind: 'scene', link: { version_id: versionId, clip_id: clip.id } })}>依赖当前版本片段 {index + 1}</Button>)}
    {!loading && !error && items.flatMap((clip, index) => frames.filter(frame => frame.clip.id === clip.id && frame.version_id === versionId && frame.available && sceneFrameCurrent(frame, content, versionId))
      .map((frame, frameIndex) => <WorkbenchButton key={frame.id} disabled={disabled || links.some(link => link.frame_id === frame.id)}
        onClick={() => bind({ version_id: versionId, clip_id: clip.id }, frame)}>承接当前版本片段 {index + 1} 落幅 {frameIndex + 1}</WorkbenchButton>))}
    {!items.some(item => 'media_range' in item) && <p>当前时间线暂无真实采用，请先在编辑画布明确采用素材。</p>}
    {links.map((link, index) => <div key={`${link.version_id}:${link.clip_id}`}>
      {link.version_id === versionId && <Button onClick={() => onOpenEdit(link.clip_id)}>定位依赖 {index + 1} 原采用并提取落幅</Button>}
      <p>来源版本：{link.version_id}；采用：{link.clip_id}</p>
      {!loading && !error && <p>依赖 {index + 1}：{sceneDependencyIssue(link, unit, frames, content, versionId) || '实际落幅适用'}</p>}
      {link.frame_id && <details><summary>查看依赖 {index + 1} 原绑定来源</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(frames.find(row => row.id === link.frame_id) || { frame_id: link.frame_id, reference_id: link.reference_id }, null, 2)}</pre></details>}
      {!loading && !error && frames.filter(frame => frame.version_id === link.version_id && frame.clip.id === link.clip_id && frame.available && sceneFrameCurrent(frame, content, versionId)).map((frame, frameIndex) =>
        <Button key={frame.id} disabled={disabled || frame.id === link.frame_id} onClick={() => bind(link, frame)}>依赖 {index + 1} 绑定落幅 {frameIndex + 1}</Button>)}
      <Button disabled={disabled} danger onClick={() => onChange({ scene_dependencies: links.filter(row => row !== link) })}>移除场次依赖 {index + 1}（保留参考）</Button>
    </div>)}
  </section>
}
