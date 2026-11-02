import type { CanvasResolvedOutput } from '../../../services/generated'

/** 展示直接图片出口声明的身份，不从名称推断分组或动作。 */
export function NamedImageSummary({ output, displayLabel }: { output: CanvasResolvedOutput; displayLabel?: string }) {
  const payload = output.payload
  if (payload?.kind !== 'named_image' || !('objects' in payload)) return null
  return <section aria-label={`名称映射 ${displayLabel || output.token}`}>
    <small>参考 {output.source.card_id} · 主图角度：{payload.angle}</small>
    {payload.objects?.map(object => <p key={object.object_id}>{object.name} · 身份 {object.object_id}{object.position ? ` · 图内位置：${object.position}` : ''}</p>)}
  </section>
}
