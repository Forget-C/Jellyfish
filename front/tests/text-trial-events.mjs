/** Emit public text trial events using the same cursor and kind in the SSE frame and envelope. */
export function textTrialFrame(sessionId, turnId, cursor, type, payload) {
  if (type === 'message.updated' && 'text_delta' in payload) payload = {text: payload.text_delta, mode: 'append'}
  const event = { session_id: sessionId, turn_id: turnId, cursor, type, payload }
  if (type.startsWith('turn.')) {
    event.receipt = payload
    event.payload = {text: payload.assistant_message?.content ?? '', error: payload.error?.message ?? null, reason: payload.reason ?? null}
  }
  return 'id: ' + cursor + '\nevent: ' + type + '\ndata: ' + JSON.stringify(event) + '\n\n'
}

export function successfulTextTrial(sessionId, turnId, user, assistant) {
  return textTrialFrame(sessionId, turnId, 1, 'turn.accepted', { user_message: user }) +
    textTrialFrame(sessionId, turnId, 2, 'turn.completed', { assistant_message: assistant })
}
