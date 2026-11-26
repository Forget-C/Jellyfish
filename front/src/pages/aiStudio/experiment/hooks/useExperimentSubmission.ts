import { useUiText } from '../../../../uiText'
import { useLayoutEffect, useRef, useState } from 'react'
import {
  ApiError,
  StudioExperimentSessionsService,
  type ExperimentMessageRead,
  type ExperimentTaskCreated,
} from '../../../../services/generated'
import { defaultTaskActionErrorMessage } from '../../components/taskActionHelpers'
import type { ExperimentHistoryState } from './useExperimentHistory'

type Attempt = {
  requestId: string
  sessionId?: string
  busy: boolean
  input: string
}

type UncertainSubmission = {
  attempt: Attempt
  sessionId: string
  taskId?: string
  accepted?: boolean
  recoverMedia?: boolean
  accept: () => void
}

export type ExperimentSubmissionNotice =
  | { kind: 'rejected'; message: string }
  | { kind: 'checking'; accepted?: boolean }
  | { kind: 'unknown' | 'run-unavailable'; historyUnavailable: boolean }

export function isRejectedSubmission(error: unknown) {
  if (error instanceof ApiError && (error.body?.message ?? error.body?.detail) === 'TEXT_LAB_STREAM_RESULT_UNKNOWN') return false
  const status = error instanceof ApiError ? error.status : undefined
  return status !== undefined && status >= 400 && status < 500 && status !== 408
}

/** A creation receipt is attributable only when a canonical message carries the returned task identity. */
function hasTaskReceipt(
  created: ExperimentTaskCreated | null | undefined,
  sessionId: string,
): boolean {
  return Boolean(created?.task_id && Array.isArray(created.messages) && created.messages.some(item =>
    item.session_id === sessionId && item.role !== 'user' && item.task_id === created.task_id,
  ))
}

/**
 * Locks the submit action synchronously and limits updates to the originating session.
 * The first draft may become its server session without invalidating its in-flight attempt.
 */
export function useExperimentSubmission(sessionId: string | undefined, history: ExperimentHistoryState, input: string) {
  const uiText = useUiText()
  const initialInput = useRef(input)
  const attemptRef = useRef<Attempt>()
  const currentInput = useRef(input)
  currentInput.current = input
  const uncertainRef = useRef<UncertainSubmission>()
  const currentSession = useRef(sessionId)
  const checkingRef = useRef<UncertainSubmission>()
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<ExperimentSubmissionNotice>()
  const [receipt, setReceipt] = useState<{ sessionId: string; cleanInput: string }>()

  useLayoutEffect(() => {
    const firstPersistence = currentSession.current === undefined && attemptRef.current?.sessionId === sessionId
    currentSession.current = sessionId
    if (firstPersistence) return
    attemptRef.current = undefined
    uncertainRef.current = undefined
    setSubmitting(false)
    setNotice(undefined)
    setReceipt(undefined)
  }, [sessionId])

  useLayoutEffect(() => () => {
    attemptRef.current = undefined
    uncertainRef.current = undefined
  }, [])

  const isCurrent = (attempt: Attempt) => attemptRef.current === attempt

  const begin = () => {
    if (attemptRef.current?.busy || uncertainRef.current) return
    const attempt: Attempt = { requestId: crypto.randomUUID(), sessionId, busy: true, input }
    attemptRef.current = attempt
    setSubmitting(true)
    setNotice(undefined)
    return attempt
  }

  const finish = (attempt: Attempt) => {
    if (!isCurrent(attempt)) return
    attempt.busy = false
    setSubmitting(false)
  }

  const acceptInput = (attempt: Attempt, targetSessionId: string, cleanInput: string) => {
    if (!isCurrent(attempt)) return false
    setReceipt({ sessionId: targetSessionId, cleanInput })
    return currentInput.current === attempt.input
  }

  const reject = (attempt: Attempt, message: string) => {
    if (isCurrent(attempt)) setNotice({ kind: 'rejected', message })
  }

  const checkHistory = async () => {
    const uncertain = uncertainRef.current
    if (!uncertain || checkingRef.current === uncertain) return
    checkingRef.current = uncertain
    setNotice({ kind: 'checking', accepted: uncertain.accepted })
    try {
      if (uncertain.recoverMedia && !uncertain.taskId) {
        const receipt = await StudioExperimentSessionsService.experimentInteractionReceipt({
          sessionId: uncertain.sessionId, requestId: uncertain.attempt.requestId,
        }).catch(error => {
          if (error instanceof ApiError && error.status === 404) return undefined
          throw error
        })
        if (uncertainRef.current !== uncertain || !isCurrent(uncertain.attempt)) return
        if (receipt?.data && hasTaskReceipt(receipt.data, uncertain.sessionId)) {
          history.adoptCanonicalMessages(uncertain.sessionId, receipt.data.messages)
          uncertainRef.current = undefined
          setNotice(undefined)
          uncertain.accept()
          return
        }
      }
      const response = await history.readLatest(uncertain.sessionId)
      if (uncertainRef.current !== uncertain || !isCurrent(uncertain.attempt)) return
      if (!Array.isArray(response.data)) throw new Error(uiText("未返回会话历史"))
      const messages: ExperimentMessageRead[] = response.data.filter(item => item.session_id === uncertain.sessionId)
      history.adoptCanonicalMessages(uncertain.sessionId, messages)
      // History alone cannot correlate identical prompts from separate submissions.
      const matched = uncertain.taskId && messages.find(item => item.role !== 'user' && (
        item.task_id === uncertain.taskId || item.payload?.interaction_run_id === uncertain.taskId
      ))
      const terminal = matched && ['succeeded', 'failed', 'cancelled'].includes(matched.status ?? '')
      if (matched && (!uncertain.accepted || terminal)) {
        uncertainRef.current = undefined
        setNotice(undefined)
        uncertain.accept()
      } else {
        setNotice({ kind: uncertain.accepted ? 'run-unavailable' : 'unknown', historyUnavailable: false })
      }
    } catch {
      if (uncertainRef.current === uncertain && isCurrent(uncertain.attempt)) {
        setNotice({ kind: uncertain.accepted ? 'run-unavailable' : 'unknown', historyUnavailable: true })
      }
    } finally {
      if (checkingRef.current === uncertain) checkingRef.current = undefined
    }
  }

  const checkOutcome = async (
    attempt: Attempt, targetSessionId: string, accept: () => void, result?: { taskId?: string; accepted?: boolean; recoverMedia?: boolean },
  ) => {
    if (!isCurrent(attempt)) return
    uncertainRef.current = { attempt, sessionId: targetSessionId, accept, ...result }
    await checkHistory()
  }

  /** Both media modes consume the same durable task receipt, with mode-specific request bodies. */
  const submitTask = async ({ ensureSession, request, onAccept, failureMessage }: {
    ensureSession: () => Promise<{ id: string }>
    request: (sessionId: string, requestId: string) => Promise<ExperimentTaskCreated | null | undefined>
    onAccept: (attempt: Attempt, sessionId: string) => void
    failureMessage: string
  }) => {
    const attempt = begin()
    if (!attempt) return
    let targetSessionId: string | undefined
    try {
      const session = await ensureSession()
      if (!isCurrent(attempt)) return
      targetSessionId = session.id
      attempt.sessionId = session.id
      const accept = () => onAccept(attempt, session.id)
      const created = await request(session.id, attempt.requestId)
      if (!isCurrent(attempt)) return
      if (created && hasTaskReceipt(created, session.id)) {
        history.adoptCanonicalMessages(session.id, created.messages.filter(item => item.session_id === session.id))
        accept()
      } else {
        await checkOutcome(attempt, session.id, accept, { taskId: created?.task_id, recoverMedia: true })
      }
    } catch (error) {
      if (targetSessionId && !isRejectedSubmission(error)) {
        const acceptedSession = targetSessionId
        await checkOutcome(attempt, targetSessionId, () => onAccept(attempt, acceptedSession), { recoverMedia: true })
      } else {
        reject(attempt, defaultTaskActionErrorMessage(error, failureMessage))
      }
    } finally {
      finish(attempt)
    }
  }

  const acknowledgeUnknown = () => {
    uncertainRef.current = undefined
    setNotice(undefined)
  }

  return {
    submitting, notice, begin, finish, isCurrent, acceptInput, reject,
    dirty: input !== (receipt && receipt.sessionId === sessionId ? receipt.cleanInput : initialInput.current),
    submitTask, checkOutcome, checkHistory, acknowledgeUnknown,
    outcomePending: notice?.kind === 'checking' || notice?.kind === 'unknown' || notice?.kind === 'run-unavailable',
    restoreUnsent: (attempt: Attempt) => { if (isCurrent(attempt)) setReceipt(undefined) },
  }
}
