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
  let selected
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/events')) {
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
      selected = route.request().postDataJSON()
      question = undefined
      active = false
      return route.fulfill({status: 202, json: {data: {session_id: existing.id, turn_id: 'active', cursor: 3}}})
    }
    if (url.pathname.endsWith('/turns') && route.request().method() === 'POST') {
      const command = route.request().postDataJSON()
      requests.push(command.request_id)
      if (requests.length === 1) {
        failedTurn = command.request_id
        return route.fulfill({status:422,json:{message:'测试失败'}})
      }
    }
    if (url.pathname.endsWith('/stop')) active = false
    const snapshot = {question, session_id: existing.id, cursor: 1, models: {text: 'T', image: 'I'}, messages: failedTurn ? [{id:'failed', role:'assistant', content:'失败', status:'failed', payload:{turn_id:failedTurn}}] : [], capabilities: [], active_turn: active ? 'active' : null}
    const data = url.pathname.endsWith('/experiment-sessions') ? (hasHistory && url.searchParams.get('lab_type') === 'chat' ? [existing] : [])
      : url.pathname.endsWith('/turns') ? turnReceipt(route)
      : url.pathname.includes('/chat/sessions/lab/chat') ? snapshot
      : url.pathname.endsWith('/model-settings') ? {default_text_model_id: 'T', default_image_model_id: 'I'}
      : url.pathname.endsWith('/models') ? {items: [{id: 'T', name: '主模型T'}, {id: 'I', name: '图片模型I'}]} : []
    return route.fulfill({ json: {data} })
  })
  await page.goto('http://127.0.0.1:4917/lab')
  await page.getByRole('region', {name: '实验室 · 多模态聊天'}).waitFor()
  await page.getByText('主聊天模型', {exact: false}).first().waitFor()
  await page.getByLabel(/主聊天模型/).click()
  await page.getByRole('menuitemradio', {name:'主模型T'}).click()
  assert.equal(await page.getByLabel(/图片模型/).first().isVisible(), false)
  await page.getByText('模态配置', {exact: true}).click()
  await page.getByLabel(/图片模型/).first().click()
  await page.getByRole('menu', {name:'图片模型', exact:true}).getByRole('menuitemradio', {name:'图片模型I'}).click()
  hasHistory = true
  await page.goto('http://127.0.0.1:4917/lab?session=chat')
  const stop = page.getByRole('button', {name: '停止回复'})
  await stop.waitFor()
  assert.equal(await page.getByRole('textbox', {name: '聊天消息'}).isDisabled(), true)
  await page.reload()
  await stop.click()
  const composer = page.getByRole('textbox', {name: '聊天消息'})
  await composer.fill('/')
  await page.getByText('/imagegen', {exact: true}).click()
  assert.equal((await composer.inputValue()).trim(), '/imagegen')
  await composer.fill('/')
  await page.getByText('/videogen', {exact: true}).click()
  assert.equal((await composer.inputValue()).trim(), '/videogen')
  await composer.fill('/videogen 雨夜')
  assert.equal(await page.getByRole('button', {name: '发送', exact: true}).isEnabled(), true)
  await page.getByRole('button', {name:'发送', exact:true}).click()
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
} finally {
  await cleanup()
}
