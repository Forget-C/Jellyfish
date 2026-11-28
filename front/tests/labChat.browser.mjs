import { turnReceipt } from './text-trial-events.mjs'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-lab-chat-')
const server = await createServer({ root, cacheDir: output + '/vite', server: { host: '127.0.0.1', port: 4917, strictPort: true } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN' })
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  let active = true
  const existing = {id: 'chat', lab_type: 'chat', title: '会话历史', updated_at: '2026-01-01', created_at: '2026-01-01'}
  let hasHistory = false
  let question
  const requests = []
  let failedTurn
  let rejectFirstSend
  const waitForFirstRejection = new Promise(resolve => { rejectFirstSend = resolve })
  let exerciseStop = false
  let heldObserverRequests = 0
  let cursor = 1
  let activeId = 'active'
  let failureFrames = ''
  let savedFailure = []
  let releaseStream
  const blocked = new Promise(resolve => { releaseStream = resolve })
  let markBlocked
  const streamBlocked = new Promise(resolve => { markBlocked = resolve })
  let selected
  let replayAnsweredQuestion = false
  let exerciseResume = false
  let partialReply
  const resumePositions = []
  let resumeSnapshots = 0
  let exerciseRecovery = false
  const repeated = []
  let closeDuringSend = false
  const unacknowledged = []
  let uploadCalls = 0
  let returnRetry
  const retryReady = new Promise(resolve => { returnRetry = resolve })
  let secondReply
  const acknowledgeRetry = new Promise(resolve => { secondReply = resolve })
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/files/upload')) {
      uploadCalls++
      return route.fulfill({json:{data:{id:'attachment', name:'参考.png', media_type:'image'}}})
    }
    if (url.pathname.endsWith('/events')) {
      assert.equal(url.pathname, '/api/v1/studio/chat/sessions/chat/chat/events')
      if (exerciseResume) {
        const after = Number(url.searchParams.get('after'))
        resumePositions.push(after)
        const event = {session_id: existing.id, turn_id: activeId, cursor: after + 1,
          category: 'message', type: 'message.updated', payload: {mode: 'append', text: after === 20 ? '断线前' : '与重连后'}}
        const records = after > 21 ? '' : 'id: ' + event.cursor + '\nevent: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n'
        return route.fulfill({contentType: 'text/event-stream', body: records})
      }
      const recovered = exerciseRecovery && savedFailure.find(row => row.id === 'recovered-reply')
      if (recovered && Number(url.searchParams.get('after')) < cursor) {
        const event = {category:'turn', type:'turn.completed', cursor, session_id: existing.id,
          turn_id: recovered.payload.turn_id, payload:{text:recovered.content, message:recovered}}
        return route.fulfill({contentType:'text/event-stream',
          body:'id: ' + cursor + '\nevent: turn.completed\ndata: ' + JSON.stringify(event) + '\n\n'})
      }
      if (exerciseRecovery || closeDuringSend) return route.fulfill({contentType: 'text/event-stream', body: ': keep-alive\n\n'})
      if (exerciseStop && !failureFrames) {
        heldObserverRequests++
        markBlocked()
        return blocked.then(() => route.fulfill({contentType: 'text/event-stream', body: failureFrames}))
      }
      if (replayAnsweredQuestion) {
        replayAnsweredQuestion = false
        const askedAt = cursor + 1
        const event = {category: 'scene', type: 'question.asked', cursor: askedAt, session_id: existing.id,
          turn_id: activeId, payload: null, detail: {id:'obsolete', options:[
            {file_id:'past', name:'已回答的选择', prompt:'前进', sequence:1, ordinal:0},
          ]}}
        cursor = askedAt + 2
        active = false
        savedFailure = [{id:'replay-terminal', role:'assistant', content:'跨标签页回答已恢复', sequence:3,
          status:'completed', payload:{turn_id:activeId}}]
        return route.fulfill({contentType:'text/event-stream',
          body:'id: ' + askedAt + '\nevent: question.asked\ndata: ' + JSON.stringify(event) + '\n\n'})
      }
      if (selected && Number(url.searchParams.get('after')) < 4) {
        const event = {category: 'turn', type: 'turn.completed', cursor: 4, session_id: existing.id,
          turn_id: 'active', payload: {text: '续答已完成', message: {
            id: 'answered', role: 'assistant', content: '续答已完成', sequence: 2,
          }}}
        return route.fulfill({contentType: 'text/event-stream',
          body: 'id: 4\nevent: turn.completed\ndata: ' + JSON.stringify(event) + '\n\n'})
      }
      const turn = !question && requests.length > 1 && Number(url.searchParams.get('after')) < 2 ? requests.at(-1) : undefined
      const event = {category: 'turn', type: 'turn.completed', cursor: 2, session_id: existing.id,
        turn_id: turn, payload: {text: '', error: null, reason: null}}
      const body = turn ? 'id: 2\nevent: turn.completed\ndata: ' + JSON.stringify(event) + '\n\n' : ': keep-alive\n\n'
      return route.fulfill({contentType: 'text/event-stream', body})
    }
    if (url.pathname.endsWith('/answer')) {
      assert.equal(url.pathname, '/api/v1/studio/chat/sessions/chat/chat/turns/active/answer')
      selected = route.request().postDataJSON()
      question = undefined
      active = false
      return route.fulfill({status: 202, json: {data: {session_id: existing.id, turn_id: 'active', cursor: 3}}})
    }
    if (url.pathname.endsWith('/turns') && route.request().method() === 'POST') {
      assert.equal(url.pathname, '/api/v1/studio/chat/sessions/chat/chat/turns')
      const command = route.request().postDataJSON()
      requests.push(command.request_id)
      if (closeDuringSend) {
        unacknowledged.push(command)
        // Simulate a server that has the request before the browser navigates.
        return
      }
      if (exerciseRecovery) {
        repeated.push(command)
        if (repeated.length === 1) return route.abort('failed')
        returnRetry()
        await acknowledgeRetry
        return route.fulfill({status: 202, json: {data: {...turnReceipt(route), cursor: cursor - 1}}})
      }
      if (exerciseStop) {
        active = true
        activeId = command.request_id
        return route.fulfill({status: 202, json: {data: {...turnReceipt(route), cursor: cursor++}}})
      }
      if (requests.length === 1) {
        failedTurn = command.request_id
        await waitForFirstRejection
        return route.fulfill({status:422,json:{message:'测试失败'}})
      }
    }
    if (url.pathname.endsWith('/stop')) { active = false; if (exerciseStop) cursor++ }
    const snapshot = {question, partial_reply:partialReply, session_id: existing.id, cursor, models: {text: 'T', image: 'I'}, messages: savedFailure.length ? savedFailure : failedTurn ? [{id:'failed', role:'assistant', content:'失败', status:'failed', payload:{turn_id:failedTurn}}] : [], capabilities: [], active_turn: active ? activeId : null}
    if (url.pathname.endsWith('/snapshot')) {
      assert.equal(url.pathname, '/api/v1/studio/chat/sessions/chat/chat/snapshot')
      if (exerciseResume) resumeSnapshots++
    }
    const data = url.pathname.endsWith('/experiment-sessions') ? (hasHistory && url.searchParams.get('lab_type') === 'chat' ? [existing] : [])
      : url.pathname.endsWith('/turns') ? turnReceipt(route)
      : url.pathname.endsWith('/snapshot') ? {kind: 'chat', session_id: existing.id, cursor, capabilities: [], history: snapshot}
      : url.pathname.includes('/chat/sessions/lab/chat') ? snapshot
      : url.pathname.endsWith('/model-settings') ? {default_text_model_id: 'T', default_image_model_id: 'I'}
      : url.pathname.endsWith('/models/T') ? {id: 'T', name: '主模型T'}
      : url.pathname.endsWith('/models/I') ? {id: 'I', name: '图片模型I'}
      : url.pathname.endsWith('/models') ? {items: [{id: 'T', name: '主模型T'}, {id: 'I', name: '图片模型I'}]} : []
    return route.fulfill({ json: {data} })
  })
  await page.goto('http://127.0.0.1:4917/lab')
  await page.getByRole('region', {name: '实验室 · 多模态聊天'}).waitFor()
  await page.getByRole('button', { name: '主模型T', exact: true }).click()
  await page.getByRole('menuitemradio', {name:'主模型T'}).click()
  assert.equal(await page.getByText('图片模型', {exact: true}).isVisible(), false)
  await page.getByRole('button', { name: '主模型T', exact: true }).click()
  await page.getByText('模态配置', {exact: true}).click()
  await page.getByRole('button', { name: '图片模型I', exact: true }).click()
  await page.getByRole('menu', {name:'图片模型', exact:true}).getByRole('menuitemradio', {name:'图片模型I'}).click()
  hasHistory = true
  await page.goto('http://127.0.0.1:4917/lab?session=chat')
  const stop = page.getByRole('button', {name: '停止回复'})
  await stop.waitFor()
  const stopBounds = await stop.boundingBox()
  assert.equal(stopBounds.width, 36)
  assert.equal(stopBounds.height, stopBounds.width)
  assert.equal(await page.getByRole('button', {name:'发送', exact:true}).count(), 0)
  await page.reload()
  await stop.click()
  const send = page.getByRole('button', {name: '发送', exact: true})
  await send.waitFor()
  const sendBounds = await send.boundingBox()
  assert.equal(sendBounds.width, stopBounds.width)
  assert.equal(sendBounds.x, stopBounds.x)
  const composer = page.getByRole('textbox', {name: '聊天消息'})
  await composer.fill('/')
  await page.getByText('/imagegen', {exact: true}).click()
  assert.equal((await composer.inputValue()).trim(), '/imagegen')
  await composer.fill('/')
  await page.getByText('/videogen', {exact: true}).click()
  assert.equal((await composer.inputValue()).trim(), '/videogen')
  await composer.fill('/videogen 雨夜')
  assert.equal(await page.getByRole('button', {name: '发送', exact: true}).isEnabled(), true)
  const firstSend = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/turns'))
  await send.click()
  await firstSend
  try {
    assert.equal(await composer.inputValue(), '', 'Submitting clears the draft before the server responds')
    await send.and(page.locator('.ant-btn-loading')).waitFor()
  } finally {
    rejectFirstSend()
  }
  await page.getByText('测试失败', {exact:true}).waitFor()
  assert.equal(await composer.inputValue(), '/videogen 雨夜')
  await page.getByRole('button', {name:'发送', exact:true}).click()
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="聊天消息"]')?.value === '')
  assert.equal(requests.length, 2)
  assert.notEqual(requests[0], requests[1])
  question = {id: 'pick', options: [{file_id: 'v1', name: '雨夜一', prompt: '前进', sequence: 1, ordinal: 0},
    {file_id: 'v2', name: '雨夜二', prompt: '后退', sequence: 2, ordinal: 0}]}
  active = true
  await page.reload()
  await page.getByRole('button', {name: /雨夜二/}).click()
  await page.getByText('续答已完成', {exact: true}).waitFor()
  assert.deepEqual(selected, {question_id: 'pick', file_id: 'v2'})

  // Another page answers after the first snapshot, before this feed catches up.
  await page.addInitScript(() => {
    window.staleLabQuestionShown = false
    new MutationObserver(() => {
      if ([...document.querySelectorAll('button')].some(button => button.textContent?.includes('已回答的选择'))) {
        window.staleLabQuestionShown = true
      }
    }).observe(document, {childList: true, subtree: true, characterData: true})
  })
  active = true
  cursor = 4
  replayAnsweredQuestion = true
  await page.reload()
  await page.getByText('跨标签页回答已恢复', {exact:true}).waitFor()
  assert.equal(await page.evaluate(() => window.staleLabQuestionShown), false)
  savedFailure = []

  // Leave the session feed pending after admission. The stop snapshot alone must
  // release the local composer and permit a new request on the same session.
  exerciseStop = true
  cursor++
  await page.reload()
  await streamBlocked
  await composer.fill('挂起后停止')
  await page.getByRole('button', {name:'发送', exact:true}).click()
  await stop.click()
  await composer.fill('停止后继续', {timeout: 2000})
  const nextSend = page.waitForResponse(r => r.url().endsWith('/turns') && r.status() === 202)
  await page.getByRole('button', {name:'发送', exact:true}).click()
  await nextSend
  assert.equal(requests.length, 4)
  assert.equal(heldObserverRequests, 1)
  const toolMessage = {id: 'tool-error', role: 'assistant', status: 'failed', sequence: 3, content: '引用文件不可用',
    payload: {tool_error: true, tool: 'generate_video', tool_call_id: 'video-1', turn_id: activeId}}
  const turnMessage = {id: 'turn-error', role: 'assistant', status: 'failed', sequence: 4, content: '',
    payload: {error_code: 'CHAT_VIDEO_MODEL_REQUIRED', turn_id: activeId}}
  const frame = (category, type, payload) => {
    const event = {session_id: existing.id, turn_id: activeId, cursor: ++cursor, category, type, payload}
    return 'id: ' + cursor + '\nevent: ' + type + '\ndata: ' + JSON.stringify(event) + '\n\n'
  }
  failureFrames = frame('tool', 'tool.failed', {tool_call_id: 'video-1', tool: 'generate_video',
    state: 'failed', error: toolMessage.content, message: toolMessage}) +
    frame('turn', 'turn.failed', {text: '', error: 'CHAT_VIDEO_MODEL_REQUIRED', message: turnMessage})
  active = false
  releaseStream()
  const toolError = page.getByText('视频生成未能开始', {exact:true})
  const turnError = page.getByText('请先选择视频模型', {exact:true})
  await toolError.waitFor()
  await turnError.waitFor()
  assert.equal(await composer.inputValue(), '停止后继续')
  savedFailure = [toolMessage, turnMessage]
  await page.reload()
  await toolError.waitFor()
  await turnError.waitFor()

  // When the command response is lost, a later edit cannot become its retry body.
  exerciseRecovery = true
  await page.reload()
  await composer.fill('原始请求')
  const picker = page.locator('input[type="file"]')
  const reference = page.getByRole('button', {name:'移除素材：参考.png', exact:true})
  const upload = () => picker.setInputFiles({name:'参考.png', mimeType:'image/png', buffer:Buffer.from('test image')})
  await upload()
  await reference.waitFor()
  await page.getByRole('button', {name:'发送', exact:true}).click()
  await Promise.race([retryReady, new Promise((_, reject) => setTimeout(() => reject(Error('Missing safe retry')), 3500))])
  assert.equal(await composer.inputValue(), '')
  assert.equal(await reference.count(), 0)
  await composer.fill('下一条草稿')
  await composer.fill('原始请求')
  await upload()
  await reference.waitFor()
  assert.equal(uploadCalls, 2)
  assert.deepEqual(repeated[1], repeated[0])
  assert.deepEqual(repeated[0].file_ids, ['attachment'])
  await composer.press('Enter')
  assert.equal(repeated.length, 2)
  savedFailure = [...savedFailure, {
    id: 'recovered-reply', role: 'assistant', status: 'completed', sequence: 5,
    content: '原始请求已完成', payload: {turn_id: repeated[0].request_id},
  }]
  cursor++
  await page.getByText('原始请求已完成').waitFor()
  const lateReceipt = page.waitForResponse(response => response.url().endsWith('/turns') && response.status() === 202)
  secondReply()
  await lateReceipt
  assert.equal(await composer.inputValue(), '原始请求')
  await reference.waitFor()
  assert.equal(await page.getByRole('button', {name:'发送', exact:true}).isEnabled(), true)

  exerciseRecovery = false
  closeDuringSend = true
  const newSend = () => page.getByRole('button', {name:'发送', exact:true}).click()
  await composer.fill('关闭前已受理')
  const delivered = page.waitForRequest(request => request.url().endsWith('/turns'))
  await newSend()
  await delivered
  while (!unacknowledged.length) await new Promise(resolve => setTimeout(resolve, 10))
  const stopCount = requests.length
  savedFailure = [...savedFailure, {
    id:'accepted-before-close', role:'user', sequence:6,
    content:'关闭前已受理', payload:{turn_id:unacknowledged[0].request_id},
  }]
  activeId = unacknowledged[0].request_id
  active = true
  cursor++
  await page.reload()
  await page.getByText('关闭前已受理', {exact:true}).waitFor()
  await stop.waitFor()
  assert.equal(requests.length, stopCount)
  active = false
  cursor++
  await page.reload()
  await composer.fill('关闭前尚未受理')
  const sent = page.waitForRequest(request => request.url().endsWith('/turns'))
  await newSend()
  await sent
  await page.reload()
  await page.getByText('关闭前已受理', {exact:true}).waitFor()
  assert.equal(requests.length, stopCount + 1)

  // Reconnect the observation after the last applied event, without rereading the opening snapshot.
  exerciseResume = true
  active = true
  activeId = 'resume'
  cursor = 20
  await page.reload()
  await page.getByText('断线前与重连后', {exact:true}).waitFor()
  assert.deepEqual(resumePositions.slice(0, 2), [20, 21])
  assert.equal(resumeSnapshots, 1)

  exerciseResume = false
  active = false
  const taskRow = (kind, sequence, status, finished) => ({
    id: kind + '-task', task_id: kind + '-run', role: 'task', status, sequence, content: '',
    payload: {turn_id: 'media-turn', modality: kind},
    media_receipt: {
      task_id: kind + '-run', model_name: '测试模型', status, progress: status === 'running' ? 8 : null,
      accepted_at_ms: 2000, finished_at_ms: finished, execution_prompt: '测试提示词',
      artifacts: [], parameters: {}, error: '',
    },
  })
  const reply = {id: 'media-reply', role: 'assistant', status: 'completed', sequence: 3,
    content: '已经提交两项生成任务', payload: {turn_id: 'media-turn',
      turn_timing: {accepted_at_ms: 1000, finished_at_ms: 5000}}}
  savedFailure = [taskRow('image', 1, 'succeeded', 7000), taskRow('video', 2, 'running', null), reply]
  active = true
  activeId = 'media-turn'
  partialReply = '我会先完成这段视频'
  await page.reload()
  const replyArticle = page.getByRole('article').filter({hasText:reply.content})
  const progress = page.getByText('8%', {exact:true})
  await progress.waitFor()
  const lead = page.getByText(partialReply, {exact:true})
  assert.ok((await lead.boundingBox()).y < (await progress.boundingBox()).y)
  assert.equal(await page.getByText('正在生成视频', {exact:true}).count(),0)
  await replyArticle.waitFor()
  assert.equal(await replyArticle.getByText(/用时/).count(),0,'total waits for all media tasks')
  active = false
  partialReply = undefined
  savedFailure[1] = taskRow('video', 2, 'cancelled', 14000)
  await page.reload()
  await page.getByText('视频生成已取消', {exact:true}).waitFor()
  await replyArticle.locator('header').getByText('用时 13 秒', {exact:true}).waitFor()
  const videoTask = page.getByRole('article').filter({hasText:'视频生成已取消'})
  const details = videoTask.locator('header').getByRole('button',{name:'生成详情'})
  assert.equal(await details.getAttribute('aria-expanded'),'false')
  await details.press('Enter')
  await videoTask.getByText('用时 12 秒',{exact:true}).waitFor()
  assert.equal(await videoTask.locator('header').getByText(/用时/).count(),0)
  assert.equal(await page.locator('.experiment-media-placeholder').count(),0)

} finally {
  await cleanup()
}
