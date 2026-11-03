/** 中性用途图解不表示已经选定的风格、参数或可采用的输出素材。 */
export function DesignPurposeIllustration({ style = false }: { style?: boolean }) {
  return <figure className={`design-purpose${style ? ' design-purpose-style' : ''}`}>
    {style ? <div role="img" aria-label="色彩、材质与明暗用途示意"><i /><i /><i /></div> : <svg viewBox="0 0 360 150" role="img" aria-label="构图与摄影用途示意">
      <path d="M20 15H340V135H20Z M127 15V135M233 15V135M20 55H340M20 95H340" fill="none" stroke="currentColor" opacity=".35" />
      <circle cx="223" cy="55" r="13" fill="currentColor" opacity=".7" /><path d="M203 111V83Q223 66 243 83V111Z" fill="currentColor" opacity=".5" />
    </svg>}
    <figcaption>{style ? '色彩 · 材质 · 明暗' : '构图 · 机位 · 运动 · 光线'} · 用途示意</figcaption>
  </figure>
}
