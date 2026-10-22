import { Image } from 'antd'
import type { EditableGenerationUnit_Output, ReferenceBinding_Output, SceneFrameDependency, UnitDependency } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { WorkbenchModal, WorkbenchDialogActions } from './ui/WorkbenchModal'
import { WorkbenchButton } from './ui/WorkbenchButton'

export type ScenePredecessorSelection = { reference?: ReferenceBinding_Output } & (
  { kind: 'scene'; link: SceneFrameDependency } | { kind: 'plan'; link: UnitDependency })

/** 确认前只比较图片和来源；一次应用同时替换首帧及唯一承接声明。 */
export function ScenePredecessorDialog({ unit, selection, stale, disabled, onApply, onClose }: {
  unit: EditableGenerationUnit_Output; selection: ScenePredecessorSelection; stale: boolean; disabled: boolean
  onApply: (changes: Partial<EditableGenerationUnit_Output>) => void; onClose: () => void
}) {
  const firsts = unit.references.filter(reference => reference.input_role === 'first_frame')
  const first = firsts[0]
  const proposed = selection.reference
  const count = unit.scene_dependencies.length + unit.dependencies.length
  const apply = () => {
    if (disabled || stale) return
    const reference = proposed && { ...proposed, id: first?.id || proposed.id, input_role: 'first_frame' as const,
      ordinal: first?.ordinal ?? proposed.ordinal }
    const references = reference ? [...unit.references.filter(row => row.input_role !== 'first_frame' && row.id !== proposed!.id), reference] : unit.references
    const link = { ...selection.link, reference_id: reference?.id || null, frame_id: reference ? selection.link.frame_id : null }
    onApply({ references, scene_dependencies: selection.kind === 'scene' ? [link as SceneFrameDependency] : [],
      dependencies: selection.kind === 'plan' ? [link as UnitDependency] : [] })
    onClose()
  }
  return <WorkbenchModal title="应用前段承接" open onCancel={onClose} footer={<WorkbenchDialogActions
    secondary={<WorkbenchButton variant="quiet" onClick={onClose}>取消</WorkbenchButton>}>
    <WorkbenchButton variant="primary" disabled={disabled || stale} onClick={apply}>{first && proposed ? '替换首帧并应用承接' : '应用承接'}</WorkbenchButton>
  </WorkbenchDialogActions>}>
    <p>本单元只保留这一个承接来源{count ? `，替换现有 ${count} 项前段声明（含历史来源）` : ''}。</p>
    <p style={{ overflowWrap: 'anywhere' }}>拟用来源：{selection.kind === 'scene' ? `版本 ${selection.link.version_id} · 片段 ${selection.link.clip_id}` : `固定计划 ${selection.link.plan_revision_id} · 单元 ${selection.link.unit_id}`}</p>
    {!!firsts.length && <section><h3>原首帧{firsts.length > 1 ? `（将替换 ${firsts.length} 张）` : ''}</h3>{firsts.map((reference, index) => <Image key={reference.id} width={240} style={{ maxWidth: '100%' }} preview={false} src={buildFileDownloadUrl(reference.file_id)} alt={index ? `原首帧 ${index + 1}` : '原首帧'} />)}</section>}
    {proposed ? <section><h3>拟用落幅 · 作为首帧</h3><Image width={240} style={{ maxWidth: '100%' }} preview={false} src={buildFileDownloadUrl(proposed.file_id)} alt="拟用落幅" /><p>应用后更新首帧、取帧来源和前段绑定；需要重新核对指令。</p></section>
      : <p>尚未选入落幅；应用后保留待绑定声明，现有首帧不变。请在编辑画布提取实际落幅后返回绑定。</p>}
    {stale && <p role="alert">单元已变化，请取消并重新选择承接。</p>}
  </WorkbenchModal>
}
