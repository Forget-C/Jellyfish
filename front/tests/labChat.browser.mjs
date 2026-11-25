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
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/events')) return route.fulfill({contentType: 'text/event-stream', body: ': keep-alive\n\n'})
    if (url.pathname.endsWith('/stop')) active = false
    const snapshot = {session_id: existing.id, cursor: 1, models: {text: 'T', image: 'I'}, messages: [], capabilities: [], active_turn: active ? 'active' : null}
    const data = url.pathname.endsWith('/experiment-sessions') ? (hasHistory && url.searchParams.get('lab_type') === 'chat' ? [existing] : [])
      : url.pathname.includes('/chat/sessions/lab/chat') ? snapshot
      : url.pathname.endsWith('/model-settings') ? {default_text_model_id: 'T', default_image_model_id: 'I'}
      : url.pathname.endsWith('/models') ? {items: [{id: 'T', name: '主模型T'}, {id: 'I', name: '图片模型I'}]} : []
    return route.fulfill({ json: {data} })
  })
  await page.goto('http://127.0.0.1:4917/lab')
  await page.getByRole('region', {name: '实验室 · 多模态聊天'}).waitFor()
  assert.equal(await page.getByLabel('主聊天模型').inputValue(), 'T')
  assert.equal(await page.getByLabel('图片模型', {exact: true}).isVisible(), false)
  await page.getByText('模态配置', {exact: true}).click()
  assert.equal(await page.getByLabel('图片模型', {exact: true}).inputValue(), 'I')
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
} finally {
  await cleanup()
}
