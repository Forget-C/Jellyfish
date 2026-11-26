/** Emit public text trial events using the same cursor and kind in the SSE frame and envelope. */
export function textTrialFrame(sessionId, turnId, cursor, type, payload) {
  if (type === 'message.updated' && 'text_delta' in payload) payload = {text: payload.text_delta, mode: 'append'}
  const event = { category: 'message', detail: null, session_id: sessionId, turn_id: turnId, cursor, type, payload }
  if (type.startsWith('turn.')) {
    event.category = 'turn'
    event.payload = {text: payload.assistant_message?.content ?? '', error: payload.error?.message ?? null, reason: payload.reason ?? null,
      message: payload.user_message ?? payload.assistant_message, error_code: payload.error?.code}
  }
  return 'id: ' + cursor + '\nevent: ' + type + '\ndata: ' + JSON.stringify(event) + '\n\n'
}

export function successfulTextTrial(sessionId, turnId, user, assistant) {
  return textTrialFrame(sessionId, turnId, 1, 'turn.accepted', { user_message: user }) +
    textTrialFrame(sessionId, turnId, 2, 'turn.completed', { assistant_message: assistant })
}

export function turnReceipt(route, turnId) {
  const request = route.request()
  return {session_id: new URL(request.url()).pathname.split('/').at(-2),
    turn_id: turnId ?? request.headers()['idempotency-key'] ?? request.postDataJSON().request_id, cursor: 0}
}

const mediaAdmissions = new Map()

export function mediaTurnReceipt(route, task) {
  const receipt = turnReceipt(route)
  const previous = mediaAdmissions.get(receipt.session_id)
  receipt.cursor = previous?.cursor ?? 0
  mediaAdmissions.set(receipt.session_id, {
    session_id: receipt.session_id, turn_id: receipt.turn_id, cursor: receipt.cursor + 1,
    category: 'task', detail: null, type: 'task.accepted', payload: {
      model_id: null, model_name: null, parameters: {}, references: [], artifacts: [],
      status: task.messages?.find(message => message.task_id === task.task_id)?.status ?? 'queued',
      progress: null, stage: 'queued', error: '', cancel_requested: false, remote_cancellation: null,
      ...task,
    },
  })
  return receipt
}

export function mediaAdmissionStream(route, url) {
  if (!url.pathname.endsWith('/events')) return
  const event = mediaAdmissions.get(url.pathname.split('/').at(-2))
  if (!event || Number(url.searchParams.get('after')) >= event.cursor) return
  return route.fulfill({contentType: 'text/event-stream',
    body: 'id: ' + event.cursor + '\nevent: task.accepted\ndata: ' + JSON.stringify(event) + '\n\n'})
}
