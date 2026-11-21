// Carry a bookmarked section through the page redirect before the article resolves it.
const destination = new URL(document.querySelector('link[rel="canonical"]').href)
destination.hash = window.location.hash
window.location.replace(destination.href)
