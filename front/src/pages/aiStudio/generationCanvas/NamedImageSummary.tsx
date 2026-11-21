import { useUiText } from '../../../uiText'
import type { CanvasResolvedOutput } from '../../../services/generated'

/** 展示直接图片出口声明的身份，不从名称推断分组或动作。 */
export function NamedImageSummary({ output, displayLabel }: { output: CanvasResolvedOutput; displayLabel?: string }) {
  const uiText = useUiText()
  const payload = output.payload
  if (payload?.kind !== 'named_image' || !('objects' in payload)) return null
  return <section aria-label={uiText("名称映射 {{value1}}", { value1: displayLabel || output.token })}>
    <small>{uiText("参考")} {output.source.card_id} {uiText("· 主图角度：")}{payload.angle}</small>
    {payload.objects?.map(object => <p key={object.object_id}>{object.name} {uiText("· 身份")} {object.object_id}{object.position ? uiText(" · 图内位置：{{position}}", { position: object.position }) : ''}</p>)}
  </section>
}
