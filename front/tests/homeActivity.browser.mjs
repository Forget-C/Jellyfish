import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-home-activity-')
const origin = 'http://127.0.0.1:4798'
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4798, strictPort: true, open: false } })
const list = items => ({ items, pagination: { total: items.length, page: 1, page_size: 10, total_pages: 1 } })
const project = { id: 'p1', name: '真实项目验收', style: '现实主义', progress: 85 }
const partialProject = { id: 'p2', name: '缺少场次信息的项目', style: '现实主义' }
const chapter = { id: 'ch1', index: 2, project_id: 'p1', title: '第二章验收', raw_text: '', sequence_count: 0 }
const partialChapter = { id: 'ch2', index: 1, project_id: 'p2', title: '待确认章节' }
const session = { id: 'image1', lab_type: 'image', title: '真实图片会话', last_message_preview: '最后一条消息摘要', updated_at: '2026-11-10T10:30:00Z', created_at: '2026-11-09T10:00:00Z' }
let state = 'loaded'
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    const { pathname } = url
    const respond = data => route.fulfill({ json: { code: 200, data } })
    const fail = () => route.fulfill({ status: 503, json: { detail: '暂时不可用' } })
    if (pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (pathname.endsWith('/projects')) {
      if (state === 'error') return fail()
      return respond(list(state === 'empty' ? [] : [project, partialProject]))
    }
    if (pathname.endsWith('/projects/p1')) return respond(project)
    if (pathname.endsWith('/chapters')) {
      const id = url.searchParams.get('project_id')
      if (state === 'partial-error' && id === 'p2') return fail()
      return respond(list(id === 'p1' ? [chapter] : [partialChapter]))
    }
    if (pathname.endsWith('/chapters/ch1')) return respond(chapter)
    if (pathname.endsWith('/experiment-sessions')) {
      if (state === 'error') return fail()
      const type = url.searchParams.get('lab_type')
      if (state === 'partial-error' && type === 'text') return fail()
      return respond(state !== 'empty' && type === 'image' ? [session] : [])
    }
    if (pathname.endsWith('/messages')) return respond([])
    return respond(list([]))
  })

  await page.goto(origin)
  const progress = page.getByRole('region', { name: '项目进展', exact: true })
  const sessions = page.getByRole('region', { name: '最近实验室会话', exact: true })
  const canvases = page.getByRole('region', { name: '最近更新的画布', exact: true })
  await progress.getByRole('link', { name: project.name, exact: true }).waitFor()
  await progress.getByText('第 2 章 · 第二章验收', { exact: true }).waitFor()
  await progress.getByText('待补原文', { exact: true }).first().waitFor()
  assert.equal(await progress.getByText('85%').count(), 0)
  const example = progress.getByRole('region', { name: '项目进展示例', exact: true })
  await example.getByText('示例数据', { exact: true }).waitFor()
  assert.equal(await example.getByRole('link').count(), 0)
  assert.equal(await example.getByRole('button').count(), 0)
  await sessions.getByRole('link', { name: new RegExp(session.title) }).waitFor()
  await sessions.getByText(session.last_message_preview, { exact: false }).waitFor()
  assert.ok((await canvases.boundingBox()).y < (await progress.boundingBox()).y)
  assert.equal((await progress.boundingBox()).y, (await sessions.boundingBox()).y)
  const actionBounds = await progress.getByRole('link', { name: '编辑原文', exact: true }).boundingBox()
  const stateBounds = await progress.getByText('待补原文', { exact: true }).first().boundingBox()
  assert.ok(actionBounds.x - stateBounds.x - stateBounds.width < 120)
  await page.screenshot({ path: output + '/1440-home.png', animations: 'disabled' })

  const edit = progress.getByRole('link', { name: '编辑原文', exact: true })
  await edit.focus()
  await page.keyboard.press('Enter')
  await page.waitForURL(url => url.pathname === '/projects/p1' && url.searchParams.get('edit') === 'ch1')
  await page.goto(origin)
  await sessions.getByRole('link', { name: new RegExp(session.title) }).click()
  await page.waitForURL(url => url.pathname === '/lab' && url.searchParams.get('session') === session.id)
  await page.goto(origin)
  for (const width of [1024, 375]) {
    await page.setViewportSize({ width, height: 812 })
    await progress.getByRole('link', { name: project.name }).waitFor()
    if (width < 1024) assert.ok((await progress.boundingBox()).y < (await sessions.boundingBox()).y)
    assert.ok(await page.getByRole('main').evaluate(element => element.scrollWidth <= element.clientWidth + 2))
    await page.screenshot({ path: output + '/' + width + '-home.png', animations: 'disabled' })
  }

  state = 'empty'
  await page.reload()
  await progress.getByText('暂无项目', { exact: true }).waitFor()
  await sessions.getByText('暂无实验室会话', { exact: true }).waitFor()
  state = 'partial-error'
  await page.reload()
  await progress.getByText('读取章节失败', { exact: true }).waitFor()
  await sessions.getByText('部分实验室会话读取失败', { exact: true }).waitFor()
  await sessions.getByRole('link', { name: new RegExp(session.title) }).waitFor()
  state = 'error'
  await page.reload()
  await progress.getByText('读取项目失败', { exact: true }).waitFor()
  await sessions.getByText('读取实验室会话失败', { exact: true }).waitFor()
  assert.equal(await example.count(), 0)
  state = 'loaded'
  await progress.getByRole('button', { name: '重试', exact: true }).click()
  await sessions.getByRole('button', { name: '重试', exact: true }).click()
  await progress.getByRole('link', { name: project.name }).waitFor()
  await sessions.getByRole('link', { name: new RegExp(session.title) }).waitFor()
  console.log('Home activity layout, live links, samples, empty states and retry verified.')
} finally {
  await cleanup()
}
