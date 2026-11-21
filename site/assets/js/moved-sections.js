// Preserve existing bookmarks when only a section of an article moves.
function followMovedSection() {
  let anchor
  try {
    anchor = decodeURIComponent(window.location.hash.slice(1))
  } catch {
    return
  }
  const link = document.getElementById(anchor)?.querySelector('a[data-moved-section]')
  if (link) window.location.replace(link.href)
}
followMovedSection()
window.addEventListener('hashchange', followMovedSection)
