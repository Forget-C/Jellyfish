import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserOutput } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const port = 4539
const origin = `http://127.0.0.1:${port}`
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
const output = await browserOutput('jellyfish-project-overview-')
const chapters = [
  { id: 'raw', project_id: 'p-raw', index: 1, title: '夜入长安', raw_text: '', sequence_count: 0, status: 'draft' },
  { id: 'source', project_id: 'p-source', index: 2, title: '便利店的灯', raw_text: '她推开门。', sequence_count: 0, status: 'draft' },
  { id: 'manage', project_id: 'p-manage', index: 3, title: '无人应答', raw_text: '他按下按钮。', sequence_count: 1, status: 'shooting' },
]
const sequence = { id: 's1', position: 0, title: '收到信号', source_excerpt: '他按下按钮。', confirmed_design_count: 0 }
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  const errors = [], writes = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() !== 'GET') writes.push([request.method(), path])
    const respond = data => route.fulfill({ json: { success: true, data } })
    const projectId = path.match(/\/projects\/(p-[^/]+)/)?.[1] ?? url.searchParams.get('project_id')
    if (path.endsWith(`/projects/${projectId}`)) return respond({ id: projectId, name: projectId, stats: {} })
    if (path.endsWith('/chapters')) {
      if (projectId === 'p-failed') return route.fulfill({ status: 503, json: { detail: '章节暂不可用' } })
      const items = chapters.filter(chapter => chapter.project_id === projectId)
      return respond({ items, pagination: { total: items.length } })
    }
    const chapter = chapters.find(row => path.endsWith(`/chapters/${row.id}`) || path.includes(`/chapters/${row.id}/`))
    if (chapter && path.includes('/directing/')) return respond({ chapter_id: chapter.id, title: chapter.title, raw_text: chapter.raw_text, sequences: chapter.id === 'manage' ? [sequence] : [] })
    if (chapter) return respond(chapter)
    if (path.endsWith('/generation-canvases/p-failed')) return route.fulfill({ status: 503, json: { detail: '画布暂不可用' } })
    if (path.includes('/generation-canvases/')) return respond(path.endsWith('/p-manage') ? [
      { id: 'c1', project_id: 'p-manage', revision: 1, document: { id: 'c1', project_id: 'p-manage', name: '真实生成画布', cover_file_id: 'cover-1' } },
    ] : [])
    if (path.endsWith('/files/cover-1/download')) return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="navy"/></svg>',
    })
    return respond({ items: [], next_cursor: null })
  })

  const current = page.getByRole('region', { name: '当前制作', exact: true })
  const canvases = page.getByRole('region', { name: '生成画布', exact: true })
  const visit = id => page.goto(`${origin}/projects/p-${id}?tab=dashboard`)
  await visit('raw')
  await current.getByText('待补原文', { exact: true }).waitFor()
  await current.getByRole('button', { name: '编辑原文', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('tab') === 'chapters' && url.searchParams.get('edit') === 'raw')
  await page.getByRole('textbox', { name: '章节原文', exact: true }).waitFor()
  await visit('source')
  await current.getByText('待划分场次', { exact: true }).waitFor()
  await current.getByRole('button', { name: '划分场次', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('chapter') === 'source' && url.searchParams.get('panel') === 'source')
  await page.getByRole('dialog').filter({ hasText: '划分场次 · 便利店的灯' }).waitFor()
  await visit('manage')
  await current.getByText('已有场次', { exact: true }).waitFor()
  const canvasLink = canvases.getByRole('link', { name: '真实生成画布', exact: true })
  await canvasLink.waitFor()
  assert.ok((await canvases.getByRole('img', { name: '真实生成画布封面' }).getAttribute('src')).endsWith('/files/cover-1/download'))
  assert.equal(await canvasLink.getAttribute('href'), '/projects/p-manage/generation-canvas?canvas=c1')
  assert.ok((await canvases.boundingBox()).x > (await current.boundingBox()).x)
  await page.screenshot({ path: join(output, 'project-overview-desktop.png'), animations: 'disabled' })
  await canvasLink.click()
  await page.waitForURL('**/projects/p-manage/generation-canvas?canvas=c1')
  await page.getByRole('navigation', { name: '主导航', exact: true }).waitFor({ state: 'hidden' })
  await page.goBack()
  await current.getByText('已有场次', { exact: true }).waitFor()
  await current.getByRole('button', { name: '进入场次', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('chapter') === 'manage')
  await page.getByRole('dialog').filter({ hasText: '场次管理 · 无人应答' }).getByText('收到信号').waitFor()
  await page.goto(`${origin}/projects/p-manage?tab=chapters`)
  const chapter = page.getByRole('row').filter({ hasText: '无人应答' })
  await chapter.getByText('已有场次', { exact: true }).waitFor()
  await chapter.getByRole('button', { name: '场次管理', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'chapters-desktop.png'), animations: 'disabled' })

  await page.setViewportSize({ width: 375, height: 812 })
  await visit('manage')
  await canvasLink.waitFor()
  assert.ok((await canvases.boundingBox()).y > (await current.boundingBox()).y)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true)
  await page.screenshot({ path: join(output, 'project-overview-mobile.png'), animations: 'disabled' })
  await visit('empty')
  await current.getByText('创建第一章开始创作', { exact: true }).waitFor()
  await canvases.getByText('暂无生成画布', { exact: true }).waitFor()
  await visit('failed')
  await current.getByText('章节列表读取失败，请重试', { exact: true }).waitFor()
  await canvases.getByText('画布暂不可用', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [])
  console.log('PASS project overview, chapter destinations, canvas cover, and mobile layout')
} finally {
  await browser?.close()
  await server.close()
}
