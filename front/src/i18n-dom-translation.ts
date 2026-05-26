import i18n from './i18n'
import uiPatch from './locales/en-US/ui-patch.json'

const ZH_TEXT_RE = /[\u4e00-\u9fff]/
const TRANSLATIONS = uiPatch as Record<string, string>
const ATTRIBUTES = ['placeholder', 'title', 'aria-label'] as const

/**
 * Translates a single text or attribute value when the user explicitly selects English.
 */
function translateValue(value: string): string {
  const trimmed = value.trim()
  if (!ZH_TEXT_RE.test(trimmed)) return value

  const exact = TRANSLATIONS[trimmed]
  if (exact) {
    return value.replace(trimmed, exact)
  }

  // Ant Design inserts spacing between two Chinese characters in some buttons (e.g. "取 消").
  // Match those values against the compact source phrase so button labels translate too.
  const compact = trimmed.replace(/\s+/g, '')
  const compactExact = compact !== trimmed ? TRANSLATIONS[compact] : undefined
  if (compactExact) {
    return value.replace(trimmed, compactExact)
  }

  let translated = value
  const entries = Object.entries(TRANSLATIONS).sort(([a], [b]) => b.length - a.length)
  for (const [source, target] of entries) {
    if (source && translated.includes(source)) {
      translated = translated.split(source).join(target)
    }
  }
  return translated
}

/**
 * Translates a DOM text node in place so legacy hardcoded labels are covered.
 */
function translateTextNode(node: Text) {
  const original = node.nodeValue ?? ''
  const translated = translateValue(original)
  if (translated !== original) {
    node.nodeValue = translated
  }
}

/**
 * Translates user-visible attributes used by inputs, tooltips, and accessible labels.
 */
function translateElementAttributes(element: Element) {
  for (const attribute of ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    if (!value) continue
    const translated = translateValue(value)
    if (translated !== value) {
      element.setAttribute(attribute, translated)
    }
  }
}

/**
 * Walks a mounted subtree and applies English translations to current content.
 */
function translateTree(root: Node) {
  if (i18n.language !== 'en-US') return

  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text)
    return
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return
  }

  if (root.nodeType === Node.ELEMENT_NODE) {
    translateElementAttributes(root as Element)
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      translateTextNode(current as Text)
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      translateElementAttributes(current as Element)
    }
    current = walker.nextNode()
  }
}

/**
 * Starts the compatibility translator for screens that have not been converted to i18n keys yet.
 */
export function startEnglishDomTranslation() {
  if (typeof window === 'undefined') return

  const run = () => translateTree(document.body)
  const observer = new MutationObserver((mutations) => {
    if (i18n.language !== 'en-US') return
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        translateTree(node)
      }
      if (mutation.type === 'characterData') {
        translateTree(mutation.target)
      }
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        translateElementAttributes(mutation.target)
      }
    }
  })

  const start = () => {
    run()
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES],
    })
  }

  if (document.body) {
    start()
  } else {
    window.addEventListener('DOMContentLoaded', start, { once: true })
  }

  i18n.on('languageChanged', run)
}
