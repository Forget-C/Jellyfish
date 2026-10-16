import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { CanvasTransform } from '../../../components/canvas/geometry'

export type DirectorNavigation = { key: string; index: number; type: string; entry?: { from: string; id: string }; exit?: string }
type Pending = { source: string; target?: string; location: string; committing: boolean; running?: boolean; kind?: 'enter' | 'exit'; entryId?: string; interactionOrigin: number; focusOrigin?: Element | null; snapshot?: HTMLElement; preview?: CanvasTransform; sourceTransform?: CanvasTransform }
const transformText = (value: CanvasTransform) => `translate(${value.x}px, ${value.y}px) scale(${value.scale})`
const matrixTransform = (element: Element): CanvasTransform => {
  const matrix = new DOMMatrix(getComputedStyle(element).transform)
  return { x: matrix.e, y: matrix.f, scale: matrix.a }
}
const findCard = (root: Element, id: string, snapshot = false) => [...root.querySelectorAll<HTMLElement>(snapshot ? '[data-snapshot-node]' : '[data-canvas-node]')]
  .find(card => (snapshot ? card.dataset.snapshotNode : card.dataset.canvasNode) === id)
function focusCamera(card: HTMLElement, viewport: HTMLElement, from: CanvasTransform): CanvasTransform {
  const top = Math.max(64, (viewport.querySelector('.director-canvas-toolbar')?.getBoundingClientRect().bottom || viewport.getBoundingClientRect().top) - viewport.getBoundingClientRect().top + 16)
  const scale = Math.max(from.scale, Math.min(2, (viewport.clientWidth - 32) / card.offsetWidth, (viewport.clientHeight - top - 32) / card.offsetHeight))
  return { scale, x: (viewport.clientWidth - card.offsetWidth * scale) / 2 - card.offsetLeft * scale,
    y: top + (viewport.clientHeight - top - card.offsetHeight * scale) / 2 - card.offsetTop * scale }
}
function previewCamera(card: HTMLElement, viewport: HTMLElement): CanvasTransform | undefined {
  const svg = card.querySelector<SVGSVGElement>('.director-subgraph-preview')
  const bounds = svg?.getBoundingClientRect(), viewportBounds = viewport.getBoundingClientRect(), box = svg?.viewBox.baseVal
  const scale = bounds && box ? Math.min(bounds.width / box.width, bounds.height / box.height) : 0
  return bounds && box && scale ? { scale,
    x: bounds.left - viewportBounds.left + (bounds.width - box.width * scale) / 2 - box.x * scale,
    y: bounds.top - viewportBounds.top + (bounds.height - box.height * scale) / 2 - box.y * scale } : undefined
}

/** 视觉副本只用于过渡，不进入业务节点树、键盘导航或浏览布局缓存。 */
function snapshotContent(content: HTMLElement) {
  const snapshot = content.cloneNode(true) as HTMLElement
  snapshot.classList.replace('director-canvas-content', 'director-snapshot-content')
  snapshot.setAttribute('aria-hidden', 'true'); snapshot.inert = true
  snapshot.style.visibility = 'visible'
  snapshot.querySelectorAll<HTMLElement>('*').forEach(element => {
    if (element.dataset.canvasNode) element.dataset.snapshotNode = element.dataset.canvasNode
    element.removeAttribute('id'); element.removeAttribute('data-canvas-node'); element.removeAttribute('data-layout-group')
    element.classList.replace('director-canvas-object', 'director-snapshot-object')
  })
  return snapshot
}

/** 相机动画覆盖临时 DOM 样式；实际 transform 和布局记忆始终由画布维护。 */
export function useDirectorTransition({ surface, viewKey, navigation, ready, transform, contentRevision, focusId, enabled }: {
  surface: RefObject<HTMLDivElement>; viewKey: string; navigation?: DirectorNavigation; ready: boolean; transform: CanvasTransform
  contentRevision: unknown; focusId?: string; enabled: boolean
}) {
  const locationKey = navigation?.key
  const [busy, setBusy] = useState(false)
  const serial = useRef(0), pending = useRef<Pending>()
  const animations = useRef<Animation[]>([])
  const interactions = useRef(0)
  const previous = useRef({ viewKey, locationKey, navigation })
  const lastFrame = useRef<HTMLElement>()
  const latest = useRef({ transform, focusId })
  latest.current = { transform, focusId }
  const content = () => surface.current?.querySelector<HTMLElement>(':scope > .director-canvas-content')
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  useEffect(() => {
    if (!enabled) return
    const interact = () => { interactions.current++ }
    document.addEventListener('pointerdown', interact, true); document.addEventListener('keydown', interact, true)
    return () => { document.removeEventListener('pointerdown', interact, true); document.removeEventListener('keydown', interact, true) }
  }, [enabled])
  const cancel = () => {
    serial.current++
    animations.current.forEach(animation => animation.cancel()); animations.current = []
    pending.current?.snapshot?.remove(); pending.current = undefined
    const element = content()
    if (element) { element.style.opacity = ''; element.style.filter = '' }
    setBusy(false)
  }
  const animate = (element: Element, frames: Keyframe[], duration: number) => {
    const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.22,.7,.2,1)', fill: 'forwards' })
    animations.current.push(animation)
    return animation.finished.catch(() => {})
  }
  const captureFrame = () => {
    const frame = lastFrame.current?.cloneNode(true) as HTMLElement | undefined
    const element = content()
    if (!pending.current || !frame || !element) return frame
    const copyStyle = (source: HTMLElement, copy: HTMLElement) => {
      const style = getComputedStyle(source)
      copy.style.transform = style.transform; copy.style.opacity = style.opacity; copy.style.filter = style.filter
    }
    copyStyle(element, frame)
    const overlay = pending.current.snapshot
    if (!overlay) return frame
    const composite = document.createElement('div')
    composite.className = 'director-snapshot-content'
    composite.setAttribute('aria-hidden', 'true'); composite.inert = true
    const copy = overlay.cloneNode(true) as HTMLElement
    copyStyle(overlay, copy)
    composite.append(frame, copy)
    return composite
  }
  const enter = async (card: HTMLElement, action: () => void) => {
    const element = content(), viewport = surface.current
    if (!enabled || !element || !viewport) { action(); return }
    const from = matrixTransform(element)
    const interruptedFrame = pending.current ? captureFrame() : undefined
    cancel()
    const request = ++serial.current
    const focusOrigin = document.activeElement
    const interactionOrigin = interactions.current
    if (interruptedFrame) {
      viewport.append(interruptedFrame)
      pending.current = { source: viewKey, location: locationKey || '', committing: true, snapshot: interruptedFrame, focusOrigin, interactionOrigin }
      setBusy(true)
      action()
      return
    }
    pending.current = { source: viewKey, location: locationKey || '', committing: false, focusOrigin, interactionOrigin }
    setBusy(true)
    let focused = from
    if (!reduced()) {
      focused = focusCamera(card, viewport, from)
      await animate(element, [{ transform: transformText(from) }, { transform: transformText(focused) }], 180)
      if (serial.current !== request) return
    }
    const preview = previewCamera(card, viewport)
    const snapshot = snapshotContent(element)
    snapshot.style.transform = transformText(focused)
    viewport.append(snapshot)
    pending.current = { source: viewKey, location: locationKey || '', committing: true, kind: 'enter', snapshot, preview, sourceTransform: focused, focusOrigin, interactionOrigin }
    animations.current.forEach(animation => animation.cancel()); animations.current = []
    action()
  }
  useLayoutEffect(() => {
    if (!enabled) { previous.current = { viewKey, locationKey, navigation }; return }
    const changed = previous.current.viewKey !== viewKey
    const relocated = !changed && previous.current.locationKey !== locationKey && navigation?.type !== 'REPLACE'
    const interrupted = pending.current && !pending.current.committing && pending.current.location !== (locationKey || '')
    const interruptedFocusFrame = interrupted ? captureFrame() : undefined
    if (interrupted) cancel()
    if (changed || relocated) {
      const interruptedFrame = interruptedFocusFrame || (pending.current && (pending.current.target || relocated) ? captureFrame() : undefined)
      if (pending.current?.committing && (pending.current.target || pending.current.source === viewKey)) cancel()
      if (!pending.current?.committing) {
        const snapshot = interruptedFrame || captureFrame()
        cancel()
        if (snapshot) surface.current?.append(snapshot)
        const back = navigation?.type === 'POP' && navigation.index < (previous.current.navigation?.index || 0)
        const exitId = navigation?.exit || (back && previous.current.navigation?.entry?.from === viewKey ? previous.current.navigation.entry.id : undefined)
        const forwardId = !back && navigation?.type === 'POP' && navigation.entry?.from === previous.current.viewKey ? navigation.entry.id : undefined
        pending.current = { source: previous.current.viewKey, location: locationKey || '', committing: true,
          kind: !interruptedFrame && exitId ? 'exit' : !interruptedFrame && forwardId ? 'enter' : undefined, entryId: exitId || forwardId, snapshot, focusOrigin: document.activeElement, interactionOrigin: interactions.current }
        setBusy(true)
      }
      if (pending.current) pending.current.target = viewKey
      const element = content()
      if (element && pending.current) element.style.opacity = '0'
    }
    previous.current = { viewKey, locationKey, navigation }
  }, [viewKey, locationKey, enabled])
  useLayoutEffect(() => {
    const request = pending.current, element = content()
    if (!request || request.running || request.target !== viewKey || !ready || !element) return
    let first = 0, second = 0
    first = requestAnimationFrame(() => { second = requestAnimationFrame(async () => {
      if (pending.current !== request) return
      request.running = true
      lastFrame.current = snapshotContent(element)
      const viewport = surface.current!
      const destination = latest.current.transform
      if (!reduced() && request.kind === 'enter' && request.entryId && request.snapshot) {
        const card = findCard(request.snapshot, request.entryId, true)
        if (card) {
          const from = matrixTransform(request.snapshot), focused = focusCamera(card, viewport, from)
          await animate(request.snapshot, [{ transform: transformText(from) }, { transform: transformText(focused) }], 180)
          if (pending.current !== request) return
          request.preview = previewCamera(card, viewport); request.sourceTransform = focused
        }
      }
      const exitCard = !reduced() && request.kind === 'exit' && request.entryId ? findCard(element, request.entryId) : undefined
      const exitPreview = exitCard && previewCamera(exitCard, viewport)
      if (exitCard && exitPreview && request.snapshot) {
        const focused = focusCamera(exitCard, viewport, destination), ratio = focused.scale / destination.scale
        const collapsed = { scale: exitPreview.scale * ratio, x: (exitPreview.x - destination.x) * ratio + focused.x, y: (exitPreview.y - destination.y) * ratio + focused.y }
        await Promise.all([
          animate(element, [{ transform: transformText(focused), opacity: 0 }, { transform: transformText(focused), opacity: 1 }], 340),
          animate(request.snapshot, [{ transform: transformText(matrixTransform(request.snapshot)), opacity: 1, filter: 'blur(0px)' }, { transform: transformText(collapsed), opacity: 0, filter: 'blur(1px)' }], 340),
        ])
        if (pending.current !== request) return
        await animate(element, [{ transform: transformText(focused), opacity: 1 }, { transform: transformText(destination), opacity: 1 }], 180)
      } else {
        const spatial = !reduced() && request.preview && request.sourceTransform
        const duration = spatial ? 340 : 140
        const tasks = [animate(element, spatial ? [
          { transform: transformText(request.preview!), opacity: .15, filter: 'blur(1px)' },
          { transform: transformText(destination), opacity: 1, filter: 'blur(0px)' },
        ] : [{ opacity: 0 }, { opacity: 1 }], duration)]
        if (request.snapshot) {
          const ratio = spatial ? destination.scale / request.preview!.scale : 1
          const end = spatial ? { scale: request.sourceTransform!.scale * ratio,
            x: (request.sourceTransform!.x - request.preview!.x) * ratio + destination.x,
            y: (request.sourceTransform!.y - request.preview!.y) * ratio + destination.y } : undefined
          tasks.push(animate(request.snapshot, spatial ? [
            { transform: transformText(request.sourceTransform!), opacity: 1 },
            { transform: transformText(end!), opacity: 0 },
          ] : [{ opacity: 1 }, { opacity: 0 }], duration))
        }
        await Promise.all(tasks)
      }
      if (pending.current !== request) return
      cancel()
      const target = latest.current.focusId
      const card = target && surface.current ? findCard(surface.current, target) : undefined
      // 用户已转去操作工具栏或编辑区时，不在动画结束后夺走其焦点。
      if (interactions.current === request.interactionOrigin && (document.activeElement === request.focusOrigin || document.activeElement === document.body)) card?.focus({ preventScroll: true })
      lastFrame.current = snapshotContent(element)
    }) })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [viewKey, ready, transform.x, transform.y, transform.scale])
  useLayoutEffect(() => {
    const element = content()
    if (enabled && ready && element && !pending.current) lastFrame.current = snapshotContent(element)
  }, [viewKey, ready, transform.x, transform.y, transform.scale, contentRevision, busy])
  useEffect(() => () => {
    serial.current++
    animations.current.forEach(animation => animation.cancel())
    pending.current?.snapshot?.remove()
    pending.current = undefined
  }, [])
  return { enter, busy }
}
