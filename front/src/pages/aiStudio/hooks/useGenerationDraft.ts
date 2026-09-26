import { useCallback, useRef, useState } from 'react'

export type GenerationDraftState =
  | 'idle'
  | 'draft_changed'
  | 'context_changed'
  | 'deriving'
  | 'derived'
  | 'submitting'
  | 'submitted'
  | 'error'

type Updater<T> = T | ((prev: T) => T)

export type UseGenerationDraftOptions<TBase, TContext, TDerived, TSubmitResult> = {
  initialBase: TBase
  initialContext: TContext
  derive: (args: { base: TBase; context: TContext }) => Promise<TDerived>
  submit?: (args: { base: TBase; context: TContext; derived: TDerived }) => Promise<TSubmitResult>
}

export type UseGenerationDraftResult<TBase, TContext, TDerived, TSubmitResult> = {
  base: TBase
  context: TContext
  derived: TDerived | null
  state: GenerationDraftState
  error: string | null
  lastDerivedAt: number | null
  setBase: (updater: Updater<TBase>) => void
  setContext: (updater: Updater<TContext>) => void
  replaceBase: (next: TBase) => void
  replaceContext: (next: TContext) => void
  setDerived: (next: TDerived | null) => void
  setState: (next: GenerationDraftState) => void
  hydrate: (args: {
    base: TBase
    context: TContext
    derived?: TDerived | null
    state?: GenerationDraftState
  }) => void
  deriveNow: (overrides?: { base?: TBase; context?: TContext }) => Promise<TDerived | null>
  submitNow: () => Promise<TSubmitResult | null>
  resetDerived: () => void
}

function applyUpdater<T>(prev: T, updater: Updater<T>): T {
  return typeof updater === 'function' ? (updater as (value: T) => T)(prev) : updater
}

export function useGenerationDraft<TBase, TContext, TDerived, TSubmitResult = void>(
  options: UseGenerationDraftOptions<TBase, TContext, TDerived, TSubmitResult>,
): UseGenerationDraftResult<TBase, TContext, TDerived, TSubmitResult> {
  const { initialBase, initialContext, derive, submit } = options
  const [base, setBaseState] = useState<TBase>(initialBase)
  const [context, setContextState] = useState<TContext>(initialContext)
  const [derived, setDerivedState] = useState<TDerived | null>(null)
  const [state, setState] = useState<GenerationDraftState>('idle')
  const [error, setError] = useState<string | null>(null)
  /**
   * 最近一次失败的原文。
   *
   * 为什么要有它：`submitNow` 以前在 derive/submit 失败时 **返回 null**，
   * 调用方拿 null 去读 `.url` / `.taskId`，就只能显示
   * 「出图未返回可用图片地址（status=unknown）」这类空话，真实原因（例如缺项目 ID）被吞掉。
   * 现在 submitNow 一律抛出带原文的异常，这个 ref 负责把「上游为什么失败」带出来。
   */
  const lastErrorRef = useRef<string>('')
  const [lastDerivedAt, setLastDerivedAt] = useState<number | null>(null)

  const setBase = useCallback((updater: Updater<TBase>) => {
    setBaseState((prev) => applyUpdater(prev, updater))
    setState((prev) => (prev === 'idle' ? 'draft_changed' : 'draft_changed'))
    setError(null)
  }, [])

  const setContext = useCallback((updater: Updater<TContext>) => {
    setContextState((prev) => applyUpdater(prev, updater))
    setState((prev) => (prev === 'idle' ? 'context_changed' : 'context_changed'))
    setError(null)
  }, [])

  const replaceBase = useCallback((next: TBase) => {
    setBaseState(next)
    setError(null)
  }, [])

  const replaceContext = useCallback((next: TContext) => {
    setContextState(next)
    setError(null)
  }, [])

  const setDerived = useCallback((next: TDerived | null) => {
    setDerivedState(next)
    if (next === null) {
      setLastDerivedAt(null)
    }
  }, [])

  const resetDerived = useCallback(() => {
    setDerivedState(null)
    setLastDerivedAt(null)
    setError(null)
    setState('idle')
  }, [])

  const hydrate = useCallback((args: {
    base: TBase
    context: TContext
    derived?: TDerived | null
    state?: GenerationDraftState
  }) => {
    const nextDerived = args.derived ?? null
    setBaseState(args.base)
    setContextState(args.context)
    setDerivedState(nextDerived)
    setLastDerivedAt(nextDerived ? Date.now() : null)
    setError(null)
    setState(args.state ?? (nextDerived ? 'derived' : 'idle'))
  }, [])

  const deriveNow = useCallback(async (overrides?: { base?: TBase; context?: TContext }) => {
    const nextBase = overrides?.base ?? base
    const nextContext = overrides?.context ?? context
    setState('deriving')
    setError(null)
    try {
      const next = await derive({ base: nextBase, context: nextContext })
      setDerivedState(next)
      setLastDerivedAt(Date.now())
      setState('derived')
      lastErrorRef.current = ''
      return next
    } catch (err) {
      const message = err instanceof Error ? err.message : 'derive failed'
      lastErrorRef.current = message
      setState('error')
      setError(message)
      return null
    }
  }, [base, context, derive])

  const submitNow = useCallback(async () => {
    if (!submit) return null
    let nextDerived = derived
    const needsDerive =
      !nextDerived ||
      (state !== 'derived' && state !== 'submitted')
    if (needsDerive) {
      nextDerived = await deriveNow()
      if (!nextDerived) {
        // 生成前的准备步骤失败：把真实原因抛出去，绝不静默返回 null。
        throw new Error(lastErrorRef.current || '生成前的准备步骤失败（未能生成提交内容）')
      }
    }
    const stableDerived = nextDerived as TDerived
    setState('submitting')
    setError(null)
    try {
      const result = await submit({ base, context, derived: stableDerived })
      lastErrorRef.current = ''
      setState('submitted')
      return result
    } catch (err) {
      // 关键修复：以前这里 catch 之后返回 null，调用方只能显示 status=unknown。
      // 现在把原文同时写进 error 状态并抛出，页面显示的就是真实原因。
      const message = err instanceof Error ? err.message : 'submit failed'
      lastErrorRef.current = message
      setState('error')
      setError(message)
      throw err instanceof Error ? err : new Error(message)
    }
  }, [base, context, deriveNow, derived, submit])

  return {
    base,
    context,
    derived,
    state,
    error,
    lastDerivedAt,
    setBase,
    setContext,
    replaceBase,
    replaceContext,
    setDerived,
    setState,
    hydrate,
    deriveNow,
    submitNow,
    resetDerived,
  }
}
