import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-task-locale-')
const server = await createServer({ root, cacheDir: output + '/vite-cache', server: { host: '127.0.0.1', port: 4889, open: false } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage()
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  const cancelled = []
  let cancelAttempt = 0
  const tasks = ['running', 'queued', 'succeeded'].map((status, index) => ({
    task_id: 'task-' + index, task_kind: 'image_generation', title: 'image_generation', status,
    stage: status, progress: index ? 0 : 38, elapsed_ms: 65000,
    created_at_ts: 1789430400, updated_at_ts: Math.floor(Date.now() / 1000),
    source: { kind: 'experiment_session', id: 'lab-' + index, title: '试验 ' + index },
  }))
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/cancel')) {
      cancelAttempt += 1
      if (cancelAttempt === 1) return route.fulfill({ status: 404, json: { detail: 'Task not found' } })
      if (cancelAttempt === 2) return route.fulfill({ status: 409, json: { success: false, message: '诊断 · worker busy' } })
      cancelled.push(url.pathname.split('/').at(-2))
      tasks[0].cancel_requested = true
      return route.fulfill({ json: { data: { task_id: 'task-0', cancel_requested: true } } })
    }
    const data = url.pathname.endsWith('/film/tasks') ? { items: tasks, next_cursor: null }
      : url.pathname.endsWith('/projects') ? { items: [], pagination: { total: 0 } } : []
    return route.fulfill({ json: { success: true, data } })
  })
  await page.goto(origin)
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: '任务中心', exact: true })
  await drawer.getByText('全部', { exact: true }).click()
  await drawer.getByText('试验 2', { exact: true }).waitFor()
  await drawer.getByRole('combobox').click()
  await page.locator('.ant-select-item-option').filter({ hasText: '图片生成' }).click()
  await drawer.getByRole('button', { name: /Close|关闭/ }).click()
  await page.getByRole('button', { name: '用户与语言设置' }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Task center' }).click()
  const english = page.getByRole('dialog', { name: 'Task center' })
  const cards = english.locator('.app-task-card')
  await cards.filter({ hasText: '试验 2' }).waitFor()
  assert.equal(await cards.count(), 3)
  await english.locator('.ant-select-selection-item').filter({ hasText: 'Image generation' }).waitFor()
  const running = cards.filter({ hasText: '试验 0' })
  await running.getByText('Elapsed 1 min 5 sec').waitFor()
  await running.getByRole('button', { name: /Cancel$/ }).click()
  await page.getByText('Task not found', { exact: true }).waitFor()
  await running.getByRole('button', { name: /Cancel$/ }).click()
  await page.getByText('诊断 · worker busy', { exact: true }).waitFor()
  await running.getByRole('button', { name: /Cancel$/ }).click()
  await running.getByRole('button', { name: /Cancelling$/ }).waitFor()
  assert.deepEqual(cancelled, ['task-0'])
  await english.getByRole('button', { name: 'History' }).click()
  await english.waitFor({ state: 'hidden' })
  const history = page.getByRole('dialog', { name: 'Task history' })
  await history.getByRole('combobox', { name: 'Task status' }).click()
  await page.locator('.ant-select-item-option').filter({ hasText: 'Completed' }).click()
  await history.getByRole('row').filter({ hasText: '试验 2' }).getByRole('button', { name: 'View' }).click()
  await page.waitForURL(url => url.pathname === '/lab' && url.searchParams.get('session') === 'lab-2')
  console.log('Task filters, elapsed time, cancellation ID and return to source verified in English.')
} finally {
  await cleanup()
}
