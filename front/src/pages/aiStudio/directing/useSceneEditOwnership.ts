import { useEffect, useRef, useState } from 'react'

const lockName = 'jellyfish:scene-editor:local-user'
export const generationCanvasEditScope = (projectId: string, canvasId: string | null) => `jellyfish:generation-editor:${projectId}:${canvasId}`
type HandoffAction = 'request' | 'save' | 'discard' | 'cancel'
type HandoffResult = 'ready' | 'choice' | 'failed'
type OwnershipState = 'checking' | 'editing' | 'readonly' | 'waiting' | 'choice' | 'unresponsive' | 'unsupported'
type Message = { kind: 'ask' | 'choose' | 'reply' | 'queued' | 'cancel' | 'locate' | 'here' | 'focus'; from: string; to?: string; id: string; action?: HandoffAction; result?: HandoffResult; href?: string }

/** 浏览器锁决定唯一编辑能力；消息只协调保存与交接，不用心跳或超时抢占。 */
export function useSceneEditOwnership(scope = lockName) {
  const [state, setState] = useState<OwnershipState>('checking')
  const [message, setMessage] = useState('')
  const [ownerUrl, setOwnerUrl] = useState('')
  const owned = useRef(false)
  const handoff = useRef<(action: HandoffAction) => Promise<HandoffResult>>(async () => 'failed')
  const actions = useRef({ take: () => {}, choose: (_action: HandoffAction) => {}, cancel: () => {}, locate: () => {} })

  useEffect(() => {
    let active = true
    if (!navigator.locks || !window.BroadcastChannel) { setState('unsupported'); return }
    const pageId = crypto.randomUUID()
    const channel = new BroadcastChannel(scope)
    let release: (() => void) | undefined
    let outgoing: { id: string; timer?: number; abort?: AbortController } | undefined
    let incoming: { id: string; from: string; ready: boolean; timer: number } | undefined
    const post = (data: Omit<Message, 'from'>) => channel.postMessage({ ...data, from: pageId })
    const cancelIncoming = () => {
      if (incoming) window.clearTimeout(incoming.timer)
      incoming = undefined
      void handoff.current('cancel')
    }
    const cancelOutgoing = (next: OwnershipState = 'readonly') => {
      if (outgoing) {
        window.clearTimeout(outgoing.timer)
        outgoing.abort?.abort()
        post({ kind: 'cancel', id: outgoing.id })
      }
      outgoing = undefined
      if (active) setState(next)
    }
    const startTimeout = () => window.setTimeout(() => {
      cancelOutgoing('unresponsive')
      setMessage('原编辑页未响应。可以重试或返回原页；尚未交接编辑权。')
    }, 10000)
    const hold = async (lock: Lock | null, requestId?: string) => {
      if (!active || !lock || (requestId && outgoing?.id !== requestId)) return
      if (outgoing) window.clearTimeout(outgoing.timer)
      outgoing = undefined
      owned.current = true
      setMessage('')
      setState('editing')
      post({ kind: 'here', id: '', href: window.location.href })
      await new Promise<void>(resolve => { release = resolve })
    }
    const take = (initial = false) => {
      if (owned.current || outgoing) return
      if (!initial) { setState('waiting'); setMessage('') }
      void navigator.locks.request(scope, { ifAvailable: true }, async lock => {
        if (!active) return
        if (lock) { await hold(lock); return }
        if (initial) { setState('readonly'); post({ kind: 'locate', id: '' }); return }
        outgoing = { id: crypto.randomUUID(), timer: startTimeout() }
        post({ kind: 'ask', id: outgoing.id })
      }).catch(() => { if (active) setState('unsupported') })
    }
    const respond = async (data: Message, action: HandoffAction) => {
      const requestId = incoming?.id
      let result: HandoffResult
      try { result = await handoff.current(action) } catch { result = 'failed' }
      if (!active || !owned.current || !incoming || incoming.id !== requestId) return
      incoming.ready = result === 'ready'
      post({ kind: 'reply', id: data.id, to: data.from, result, href: window.location.href })
      if (result === 'failed') cancelIncoming()
    }
    channel.onmessage = event => {
      const data = event.data as Message
      if (!active || !data || data.from === pageId || (data.to && data.to !== pageId)) return
      if (data.kind === 'here') { if (!owned.current && data.href) setOwnerUrl(data.href); return }
      if (data.kind === 'locate') {
        if (owned.current) post({ kind: 'here', id: '', to: data.from, href: window.location.href })
        return
      }
      if (data.kind === 'focus') { if (owned.current) window.focus(); return }
      if (data.kind === 'cancel') {
        if (incoming?.id === data.id && incoming.from === data.from) cancelIncoming()
        return
      }
      if (data.kind === 'ask' && owned.current) {
        if (incoming) { post({ kind: 'reply', id: data.id, to: data.from, result: 'failed' }); return }
        incoming = { id: data.id, from: data.from, ready: false, timer: window.setTimeout(() => {
          if (incoming) post({ kind: 'reply', id: incoming.id, to: incoming.from, result: 'failed' })
          cancelIncoming()
        }, 60000) }
        void respond(data, 'request')
      } else if (data.kind === 'choose' && owned.current && incoming?.id === data.id && incoming.from === data.from) {
        if (data.action === 'save' || data.action === 'discard') void respond(data, data.action)
      } else if (data.kind === 'queued' && owned.current && incoming?.ready && incoming.id === data.id && incoming.from === data.from) {
        // 接收页已排队，原页先失去写能力，再释放浏览器锁。
        owned.current = false
        setState('readonly')
        cancelIncoming()
        release?.()
      } else if (data.kind === 'reply' && outgoing?.id === data.id) {
        window.clearTimeout(outgoing.timer)
        if (data.href) setOwnerUrl(data.href)
        if (data.result === 'choice') { setState('choice'); return }
        if (data.result !== 'ready') {
          cancelOutgoing()
          setMessage('交接未完成，请在原页处理保存或恢复问题后重试。')
          return
        }
        const requestId = outgoing.id
        outgoing.abort = new AbortController()
        outgoing.timer = startTimeout()
        void navigator.locks.request(scope, { signal: outgoing.abort.signal }, lock => hold(lock, requestId))
          .catch(error => { if (active && error.name !== 'AbortError') { cancelOutgoing(); setMessage('无法确认编辑权，请重试。') } })
        post({ kind: 'queued', id: requestId, to: data.from })
      }
    }
    actions.current = {
      take: () => take(),
      choose: action => {
        if (!outgoing) return
        setState('waiting')
        outgoing.timer = startTimeout()
        post({ kind: 'choose', id: outgoing.id, action })
      },
      cancel: () => {
        setMessage('')
        if (incoming) {
          post({ kind: 'reply', id: incoming.id, to: incoming.from, result: 'failed' })
          cancelIncoming()
        } else cancelOutgoing()
      },
      locate: () => post({ kind: 'focus', id: '' }),
    }
    // StrictMode 的同步卸载／重挂载不能让已取消的首个请求短暂占锁。
    queueMicrotask(() => { if (active) take(true) })
    return () => {
      active = false
      owned.current = false
      window.clearTimeout(incoming?.timer)
      window.clearTimeout(outgoing?.timer)
      outgoing?.abort?.abort()
      channel.close()
      release?.()
    }
  }, [scope])
  return { state, message, ownerUrl, handoff, editable: state === 'editing', canEdit: () => owned.current,
    takeEditing: () => actions.current.take(), chooseHandoff: (action: 'save' | 'discard') => actions.current.choose(action),
    cancelHandoff: () => actions.current.cancel(), locateOwner: () => actions.current.locate() }
}

export type SceneEditOwnership = ReturnType<typeof useSceneEditOwnership>
