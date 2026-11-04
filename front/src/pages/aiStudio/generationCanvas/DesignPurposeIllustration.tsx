const labels: Record<string, string> = { style: '画面风格', composition: '景别与构图', camera: '机位与视角', movement: '运镜', lighting: '光影与色彩', focus: '焦点与成像' }

/** Neutral type-specific diagrams explain purpose, never an applied preset or generated result. */
export function DesignPurposeIllustration({ kind = 'composition' }: { kind?: string }) {
  const title = labels[kind] || labels.composition
  return <figure className="design-purpose">
    <svg viewBox="0 0 360 150" role="img" aria-label={`${title}用途示意`}>
      {kind === 'style' ? <g fill="currentColor"><rect x="24" y="24" width="100" height="102" rx="6" opacity=".6" /><rect x="130" y="24" width="100" height="102" rx="6" opacity=".35" /><rect x="236" y="24" width="100" height="102" rx="6" opacity=".15" /><path d="M140 35L220 115M140 55L200 115M160 35L220 95M180 35L220 75M140 75L180 115" stroke="currentColor" strokeWidth="3" /></g> : <>
        <rect x="24" y="15" width="312" height="120" rx="6" fill="none" stroke="currentColor" opacity=".3" />
        {kind === 'composition' && <path d="M128 15V135M232 15V135M24 55H336M24 95H336" fill="none" stroke="currentColor" opacity=".35" />}
        {kind === 'camera' && <g fill="none" stroke="currentColor" strokeWidth="2"><path d="M80 100L180 36L280 100M80 100L180 76L280 100" opacity=".4" /><rect x="61" y="92" width="30" height="22" rx="3" /><rect x="265" y="92" width="30" height="22" rx="3" /><path d="M91 99L101 94V111L91 106M265 99L255 94V111L265 106" /></g>}
        {kind === 'movement' && <g fill="none" stroke="currentColor" strokeWidth="3"><path d="M62 104C125 104 124 44 214 44H293" /><path d="M279 32L293 44L279 56" /><circle cx="62" cy="104" r="8" /><path d="M163 45V66M210 34V55" opacity=".4" /></g>}
        {kind === 'lighting' && <g stroke="currentColor" fill="none"><circle cx="78" cy="44" r="14" fill="currentColor" opacity=".65" /><path d="M98 38L286 104L196 121Z" fill="currentColor" stroke="none" opacity=".12" /><path d="M78 18V9M52 44H43M59 25L52 18M97 25L104 18" strokeWidth="2" /></g>}
        {kind === 'focus' && <g fill="none" stroke="currentColor"><circle cx="180" cy="75" r="45" opacity=".2" /><circle cx="180" cy="75" r="32" opacity=".4" /><path d="M144 58V39H163M197 39H216V58M216 92V111H197M163 111H144V92" strokeWidth="2" /></g>}
        {kind !== 'movement' && <g fill="currentColor"><circle cx={kind === 'composition' ? 232 : 180} cy="62" r="12" opacity=".7" /><path d={kind === 'composition' ? 'M214 110V88Q232 72 250 88V110Z' : 'M162 110V88Q180 72 198 88V110Z'} opacity=".5" /></g>}
      </>}
    </svg>
    <figcaption>{title} · 用途示意</figcaption>
  </figure>
}
