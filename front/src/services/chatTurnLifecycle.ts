import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { ApiError, type CancelablePromise, type ChatEvent, type ChatTurnReceipt } from './generated'
import { observeChatSession, waitForChatReconnect } from './chatSessionObservation'

type Snapshot = { session_id: string; cursor: number }
type TurnOutcome = 'completed' | 'failed' | 'stopped' | 'interrupted'
type ActiveTurn = { id: string; questionId?: string }
type Command = {
  turnId: string
  questionId?: string
  send(): CancelablePromise<ChatTurnReceipt>
}

export type ChatTurnAdapter<S extends Snapshot> = {
  read(sessionId: string, signal: AbortSignal): Promise<S>
  events(sessionId: string, cursor: number, signal: AbortSignal, connected: () => void): AsyncIterable<ChatEvent>
  apply(snapshot: S, event: ChatEvent, signal: AbortSignal): S | Promise<S>
  active(snapshot: S): ActiveTurn | undefined
  outcome(snapshot: S, turnId: string): TurnOutcome | undefined
  stop(sessionId: string, turnId: string, signal: AbortSignal): Promise<S>
}

type Resolution<S> = {
  snapshot: S
  outcome: TurnOutcome | 'waiting'
}

type Pending<S> = Command & {
  startCursor: number
  receipt?: ChatTurnReceipt
  uncertain?: boolean
  resolve(resolution?: Resolution<S>): void
  reject(error: unknown): void
}

type LifecycleState<S> = {
  snapshot?: S
  commandPending: boolean
  stoppableTurn?: string
  stopping: boolean
  reconnecting: boolean
  uncertain: boolean
  busy: boolean
  error?: unknown
}

export async function observeChatRequest<T>(request: CancelablePromise<T>, signal: AbortSignal): Promise<T> {
  const cancel = () => request.cancel()
  signal.addEventListener('abort', cancel, {once: true})
  if (signal.aborted) cancel()
  const timer = setTimeout(cancel, 10000)
  try {
    return await request
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
  }
}

const rejected = (error: unknown) =>
  error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)

const emptyState = { commandPending: false, busy: false, stopping: false, reconnecting: false, uncertain: false }

function createLifecycle<S extends Snapshot>(adapter: ChatTurnAdapter<S>) {
  const listeners = new Set<() => void>()
  let state: LifecycleState<S> = emptyState
  let scope: { sessionId: string; signal: AbortSignal; abort(): void } | undefined
  let pending: Pending<S> | undefined
  let applying: {abort: AbortController; cursor: number} | undefined

  function publish(update: Partial<LifecycleState<S>>) {
    const next = {...state, ...update}
    const active = next.snapshot && adapter.active(next.snapshot)
    next.commandPending = !!pending
    next.uncertain = !!pending?.uncertain
    next.stoppableTurn = active?.id ?? pending?.receipt?.turn_id
    next.busy = !!pending || !!active || next.stopping || (!!scope && !next.snapshot)
    state = next
    listeners.forEach(listener => listener())
  }

  function complete(snapshot: S, terminal?: {turnId: string; outcome: TurnOutcome}) {
    if (!pending) return
    const outcome = adapter.outcome(snapshot, pending.turnId) ?? (terminal?.turnId === pending.turnId ? terminal.outcome : undefined)
    const active = adapter.active(snapshot)
    const accepted = !!pending.receipt && snapshot.cursor > pending.receipt.cursor
    const newer = snapshot.cursor > pending.startCursor
    let settled: Resolution<S>['outcome'] | undefined
    if (outcome && (newer || accepted || terminal?.turnId === pending.turnId)) settled = outcome
    if (active?.id === pending.turnId && active.questionId && active.questionId !== pending.questionId && (newer || accepted)) {
      settled = 'waiting'
    }
    if (settled) {
      pending.resolve({snapshot, outcome: settled})
      pending = undefined
    }
  }

  function adopt(snapshot: S, terminal?: {turnId: string; outcome: TurnOutcome}) {
    if (snapshot.session_id !== scope?.sessionId || snapshot.cursor < (state.snapshot?.cursor ?? 0)) return
    complete(snapshot, terminal)
    publish({snapshot})
  }

  function watch(sessionId: string, signal: AbortSignal) {
    return observeChatSession({
      signal,
      cursor: () => state.snapshot?.cursor,
      async load() {
        const snapshot = await adapter.read(sessionId, signal)
        if (!signal.aborted) adopt(snapshot)
      },
      events: (cursor, signal, connected) => adapter.events(sessionId, cursor, signal, connected),
      async apply(event) {
        const snapshot = state.snapshot
        if (!snapshot) return
        const projection = new AbortController()
        applying = {abort: projection, cursor: event.cursor}
        try {
          const next = await adapter.apply(snapshot, event, projection.signal)
          if (signal.aborted || projection.signal.aborted || event.cursor <= (state.snapshot?.cursor ?? -1)) return
          const outcome = event.type === 'turn.completed' ? 'completed'
            : event.type === 'turn.failed' ? 'failed'
            : event.type === 'turn.stopped' ? 'stopped'
            : event.type === 'turn.interrupted' ? 'interrupted' : undefined
          adopt(next, outcome && event.turn_id ? {turnId: event.turn_id, outcome} : undefined)
        } catch (error) {
          if (!projection.signal.aborted) throw error
        } finally {
          if (applying?.abort === projection) applying = undefined
        }
      },
      connected: () => {
        if (state.reconnecting) publish({reconnecting: false, error: undefined})
      },
      disconnected: error => publish({reconnecting: true, error}),
    })
  }

  function close() {
    scope?.abort()
    applying?.abort.abort()
    scope = undefined
    pending?.resolve()
    pending = undefined
    publish({...emptyState, snapshot: undefined, error: undefined})
  }

  function open(sessionId: string) {
    if (scope?.sessionId !== sessionId) {
      close()
      const abort = new AbortController()
      scope = {sessionId, signal: abort.signal, abort: () => abort.abort()}
      publish({})
      void watch(sessionId, scope.signal)
    }
    return scope
  }

  async function send(command: Pending<S>, sessionId: string, signal: AbortSignal) {
    while (!signal.aborted && pending === command) {
      try {
        command.receipt = await observeChatRequest(command.send(), signal)
        if (signal.aborted || pending !== command) return
        if (state.snapshot) complete(state.snapshot)
        publish({})
        return
      } catch (error) {
        if (signal.aborted || pending !== command) return
        if (rejected(error)) {
          pending = undefined
          publish({})
          command.reject(error)
          return
        }
        command.uncertain = true
        publish({})
        // An uncertain command keeps its original request body. Check the
        // committed view before making another attempt with that same command.
        while (!signal.aborted && pending === command) {
          try {
            const snapshot = await adapter.read(sessionId, signal)
            if (signal.aborted || pending !== command) return
            adopt(snapshot)
            if (pending !== command) return
            const active = state.snapshot && adapter.active(state.snapshot)
            if (!command.questionId && active?.id === command.turnId) {
              // The pending turn exists. Keep observing it instead of resending.
              return
            }
            break
          } catch {
            await waitForChatReconnect(signal)
          }
        }
        await waitForChatReconnect(signal)
      }
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    open,
    close,
    submit(sessionId: string, command: Command): Promise<Resolution<S> | undefined> {
      const {signal} = open(sessionId)
      const active = state.snapshot && adapter.active(state.snapshot)
      if (pending || state.stopping || (active && (!command.questionId || active.id !== command.turnId ||
          active.questionId !== command.questionId))) return Promise.resolve(undefined)
      return new Promise((resolve, reject) => {
        pending = {...command, startCursor: state.snapshot?.cursor ?? -1, resolve, reject}
        publish({error: undefined})
        void send(pending, sessionId, signal)
      })
    },
    async refresh() {
      if (!scope) return false
      const {sessionId, signal} = scope
      try {
        const snapshot = await adapter.read(sessionId, signal)
        if (signal.aborted) return false
        adopt(snapshot)
        publish({error: undefined})
        return true
      } catch (error) {
        if (!signal.aborted) publish({error})
        return false
      }
    },
    async stop(turnId = state.stoppableTurn) {
      if (!scope || !turnId || state.stopping) return false
      const {sessionId, signal} = scope
      const wasActive = state.stoppableTurn === turnId
      publish({stopping: true, error: undefined})
      try {
        const snapshot = await adapter.stop(sessionId, turnId, signal)
        if (signal.aborted) return
        if (applying && applying.cursor <= snapshot.cursor) applying.abort.abort()
        adopt(snapshot, adapter.active(snapshot)?.id !== turnId ? {turnId, outcome: 'stopped'} : undefined)
        return true
      } catch (error) {
        if (signal.aborted) return
        publish({error})
        try {
          const snapshot = await adapter.read(sessionId, signal)
          if (signal.aborted) return false
          if (applying && applying.cursor <= snapshot.cursor) applying.abort.abort()
          adopt(snapshot)
          const outcome = state.snapshot && adapter.outcome(state.snapshot, turnId)
          if (outcome === 'stopped' || (wasActive && outcome)) {
            publish({error: undefined})
            return true
          }
        } catch (failure) {
          if (!signal.aborted) publish({error: failure})
        }
        return false
      } finally {
        if (!signal.aborted) publish({stopping: false})
      }
    },
  }
}

/** Observe one bound conversation and keep command recovery scoped to this mounted view. */
export function useChatTurnLifecycle<S extends Snapshot>(sessionId: string | undefined, adapter: ChatTurnAdapter<S>) {
  const controller = useMemo(() => createLifecycle(adapter), [adapter])
  const state = useSyncExternalStore(controller.subscribe, controller.getState)
  useEffect(() => {
    if (!sessionId) return
    controller.open(sessionId)
    return controller.close
  }, [controller, sessionId])
  useEffect(() => controller.close, [controller])
  return {...state, submit: controller.submit, stop: controller.stop, refresh: controller.refresh}
}
