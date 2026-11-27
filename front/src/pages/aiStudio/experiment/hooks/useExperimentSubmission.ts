import { useUiText } from '../../../../uiText'
import { useLayoutEffect, useRef, useState } from 'react'
import {
  ApiError,
  type ChatTurnReceipt,
} from '../../../../services/generated'
import { bindChatSession } from '../../../../services/chatSession'
import { defaultTaskActionErrorMessage } from '../../components/taskActionHelpers'
import type { ExperimentHistoryState } from './useExperimentHistory'

type Attempt = {
  requestId: string
  sessionId?: string
  busy: boolean
  input: string
}

type MediaKind = 'image' | 'video'

type UncertainSubmission = {
  attempt: Attempt
  sessionId: string
  taskId?: string
  accepted?: boolean
  recoverMedia?: MediaKind
  accept: (receipt?: ChatTurnReceipt) => void
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
  const checkingRef = useRef<{submission: UncertainSubmission; cancelReceipt?: () => void}>()
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<ExperimentSubmissionNotice>()
  const [receipt, setReceipt] = useState<{ sessionId: string; cleanInput: string }>()

  useLayoutEffect(() => {
    const firstPersistence = currentSession.current === undefined && attemptRef.current?.sessionId === sessionId
    currentSession.current = sessionId
    if (firstPersistence) return
    attemptRef.current = undefined
    uncertainRef.current = undefined
    checkingRef.current?.cancelReceipt?.()
    checkingRef.current = undefined
    setSubmitting(false)
    setNotice(undefined)
    setReceipt(undefined)
  }, [sessionId])

  useLayoutEffect(() => () => {
    attemptRef.current = undefined
    uncertainRef.current = undefined
    checkingRef.current?.cancelReceipt?.()
    checkingRef.current = undefined
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
    if (!uncertain || checkingRef.current?.submission === uncertain) return
    const check: NonNullable<typeof checkingRef.current> = {submission: uncertain}
    checkingRef.current = check
    setNotice({ kind: 'checking', accepted: uncertain.accepted })
    try {
      const request = uncertain.recoverMedia && !uncertain.taskId
        ? bindChatSession(uncertain.recoverMedia, uncertain.sessionId).mediaReceipt(uncertain.attempt.requestId)
        : undefined
      if (request) check.cancelReceipt = () => request.cancel()
      const recovered = await request?.catch(error => {
        if (error instanceof ApiError && error.status === 404) return undefined
        throw error
      })
      if (uncertainRef.current !== uncertain || !isCurrent(uncertain.attempt)) return
      if (recovered) {
        uncertainRef.current = undefined
        setNotice(undefined)
        uncertain.accept(recovered)
        // Result display follows the snapshot and event stream after confirming admission.
        void history.readLatest(uncertain.sessionId).then(({data}) => {
          if (isCurrent(uncertain.attempt) && Array.isArray(data)) {
            history.adoptCanonicalMessages(uncertain.sessionId, data.filter(item => item.session_id === uncertain.sessionId))
          }
        }).catch(() => undefined)
        return
      }
      const response = await history.readLatest(uncertain.sessionId)
      if (uncertainRef.current !== uncertain || !isCurrent(uncertain.attempt)) return
      if (!Array.isArray(response.data)) throw new Error(uiText("未返回会话历史"))
      const messages = response.data.filter(item => item.session_id === uncertain.sessionId)
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
      if (checkingRef.current === check) checkingRef.current = undefined
    }
  }

  const checkOutcome = async (
    attempt: Attempt, targetSessionId: string, accept: (receipt?: ChatTurnReceipt) => void, result?: { taskId?: string; accepted?: boolean; recoverMedia?: MediaKind },
  ) => {
    if (!isCurrent(attempt)) return
    uncertainRef.current = { attempt, sessionId: targetSessionId, accept, ...result }
    await checkHistory()
  }

  /** Submit media work and hand its committed receipt to the current session observer. */
  const submitTask = async ({ kind, ensureSession, request, onAccept, failureMessage }: {
    kind: MediaKind
    ensureSession: () => Promise<{ id: string }>
    request: (sessionId: string, requestId: string) => Promise<ChatTurnReceipt>
    onAccept: (attempt: Attempt, sessionId: string, receipt: ChatTurnReceipt) => void
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
      const receipt = await request(session.id, attempt.requestId)
      if (!isCurrent(attempt)) return
      if (receipt.turn_id !== attempt.requestId) throw new Error('Invalid media admission identity')
      onAccept(attempt, session.id, receipt)
    } catch (error) {
      if (targetSessionId && !isRejectedSubmission(error)) {
        const acceptedSession = targetSessionId
        await checkOutcome(attempt, targetSessionId, receipt => {
          if (receipt) onAccept(attempt, acceptedSession, receipt)
        }, { recoverMedia: kind })
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
