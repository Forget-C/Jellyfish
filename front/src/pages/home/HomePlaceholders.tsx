type HomePlaceholdersProps = {
  kind: 'canvas' | 'activity' | 'asset'
}

/** Keep loading skeletons decorative so only real records enter lists and keyboard navigation. */
export function HomePlaceholders({ kind }: HomePlaceholdersProps) {
  const capacity = kind === 'asset' ? 6 : 3
  const Slot = kind === 'canvas' ? 'div' : 'li'
  return Array.from({ length: capacity }, (_, index) => (
    <Slot key={index} aria-hidden="true" className={`home-slot home-slot-${kind}`}>
      {kind !== 'activity' && <span className={kind === 'canvas' ? 'home-canvas-cover' : 'home-asset-image'} />}
      <span className="home-slot-lines" />
    </Slot>
  ))
}
