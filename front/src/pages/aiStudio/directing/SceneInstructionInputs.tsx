import { useRef, useState } from 'react'
import type { CanvasTarget, UnitCanvasGraph, UnitReferencesCanvasNode, CanvasReferencePreview, ReferenceBinding_Output } from '../../../services/generated'
import { resolveAssetUrl } from '../assets/utils'
import { ReferencePreview } from './ReferencePreview'
import { SourceLinks } from './Sources'
import { WorkbenchButton } from './ui/WorkbenchButton'
import { WorkbenchModal } from './ui/WorkbenchModal'

/** 分区和修改目标直接使用当前编辑的服务端单元图；加载失败不能退回旧输入。 */
export function SceneInstructionInputs({ unitId, graph, current, error, retry, onLocate, readonly, compact = false }: {
  unitId: string; graph?: UnitCanvasGraph; current: boolean; error: string; retry: () => void
  onLocate: (target: CanvasTarget) => boolean; readonly: boolean; compact?: boolean
}) {
  const [image, setImage] = useState<{ reference: ReferenceBinding_Output; preview: CanvasReferencePreview }>()
  const [unavailable, setUnavailable] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const imageTrigger = useRef<HTMLElement>()
  const nodes = graph?.nodes.filter(node => 'unit_id' in node && node.unit_id === unitId) || []
  const references = nodes.filter((node): node is UnitReferencesCanvasNode => node.kind === 'unit_references')
  const dependency = nodes.find(node => node.kind === 'unit_config' && node.config_kind === 'dependencies')
  const evidence = dependency?.kind === 'unit_config' ? dependency.dependency_evidence : []
  if (error || !current || !references.length) return <p role={error ? 'alert' : 'status'}>{error ? `本次输入加载失败：${error}` : '正在核对本次输入；尚不能确认当前素材。'} <WorkbenchButton onClick={retry}>重试本次输入</WorkbenchButton></p>
  const locate = (target?: CanvasTarget | null) => { if (!target || !onLocate(target)) setUnavailable(true) }
  const entry = (node: UnitReferencesCanvasNode) => <article key={node.id} aria-label={node.title} data-input-node={node.id}>
    {node.input_role === 'subject' && node.binding_count > 0 && <p><strong>{node.title}</strong> · {node.binding_count} 项</p>}
    {!compact && node.summary.filter(field => field.field !== 'bindings').map(field => <p key={field.field}>{field.label}：{field.text}</p>)}
    {!node.bindings.length && (node.input_role !== 'subject' || !references.some(row => row.input_role === 'subject' && row.binding_count)) && <p>{node.input_role === 'first_frame' && evidence.some(row => row.status === 'unbound') ? '承接待绑定' : '未选择'}</p>}
    <div className="instruction-input-media">{node.bindings.map(reference => {
      const preview = node.previews.find(row => row.binding_id === reference.id)
      const dependencies = evidence.filter(row => row.reference_id === reference.id)
      return <section key={reference.id} aria-label={preview?.display_name || '待核实素材'}>
        {preview ? <ReferencePreview reference={reference} preview={preview} imageWidth={compact ? 56 : 96}
          onViewImage={() => { imageTrigger.current = document.activeElement as HTMLElement; setImageFailed(false); setImage({ reference, preview }) }} /> : <p role="status">素材预览尚未核实</p>}
        {compact && node.input_role !== 'subject' && <p>来源：{reference.asset_origin?.name || '人工素材'}</p>}
        {!compact && <><p>来源：{reference.asset_origin?.name || '人工素材'} · {preview?.status === 'available' ? '文件已登记可用' : '文件待核对'}</p><SourceLinks sources={[reference.source]} /></>}
        {dependencies.map((row, index) => <div key={index}><p>承接{row.kind === 'scene' ? `片段 ${row.clip_id}` : `单元 ${row.unit_id}`} · {row.message}</p>
          {!compact && <><p>来源版本：{row.kind === 'scene' ? row.version_id : row.plan_revision_id}{row.at_ms !== null && ` · 取帧 ${row.at_ms} 毫秒`}</p>{row.source && <SourceLinks sources={[row.source]} />}</>}
        </div>)}
      </section>
    })}</div>
    {!compact && <WorkbenchButton onClick={() => locate(node.edit_target)}>{node.input_role === 'subject' && !node.binding_count ? readonly ? '查看参考组配置' : '添加参考组' : `${readonly ? '查看' : '修改'}${node.title}`}</WorkbenchButton>}
  </article>
  return <div className={compact ? 'instruction-inputs instruction-inputs-compact' : 'instruction-inputs'}>
    {unavailable && <p role="alert">原输入卡片已不可用，请重新核对；不会选择其他对象。</p>}
    <section aria-label="首帧"><h3>首帧 · 起始画面</h3>{references.filter(node => node.input_role === 'first_frame').map(entry)}</section>
    <section aria-label="尾帧"><h3>尾帧 · 结束画面</h3>{references.filter(node => node.input_role === 'last_frame').map(entry)}</section>
    <section aria-label="参考组"><h3>参考组</h3>{references.filter(node => node.input_role === 'subject' && (!compact || node.binding_count || !references.some(row => row.input_role === 'subject' && row.binding_count))).map(entry)}</section>
    {references.filter(node => node.input_role === 'all').map(entry)}
    {evidence.some(row => row.status === 'unbound') && <section aria-label="待绑定承接">{evidence.filter(row => row.status === 'unbound').map((row, index) => <p key={index}>承接待绑定：{row.kind === 'scene' ? `片段 ${row.clip_id}` : `单元 ${row.unit_id}`} · {row.message}</p>)}</section>}
    {!compact && evidence.length > 0 && <WorkbenchButton onClick={() => locate(dependency?.edit_target)}>查看前段承接依据</WorkbenchButton>}
    <WorkbenchModal title="参考图片 · 只读" open={!!image} onCancel={() => setImage(undefined)} afterOpenChange={open => { if (!open) requestAnimationFrame(() => imageTrigger.current?.focus({ preventScroll: true })) }} footer={null}>
      {image && <><img src={resolveAssetUrl(image.preview.media_url)} alt={image.preview.display_name} style={{ width: '100%', objectFit: 'contain' }} onError={() => setImageFailed(true)} />
        {imageFailed && <p role="alert">参考图片读取失败；固定绑定保留。</p>}
        <p>来源：{image.reference.asset_origin?.name || '人工素材'}</p><SourceLinks sources={[image.reference.source]} /></>}
    </WorkbenchModal>
  </div>
}
