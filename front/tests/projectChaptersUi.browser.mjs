import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const port = 4541
const origin = `http://127.0.0.1:${port}`
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
const output = await browserOutput('jellyfish-project-chapters-')
const chapters = [
  { id: 'unknown', project_id: 'p-unknown', index: 1, title: '未知数量章节', raw_text: '原文', status: 'draft' },
  { id: 'raw', project_id: 'p-raw', index: 1, title: '夜入长安', raw_text: '', sequence_count: 0, status: 'draft' },
  { id: 'source', project_id: 'p-source', index: 2, title: '便利店的灯', raw_text: '她推开门。', sequence_count: 0, status: 'draft' },
  { id: 'manage', project_id: 'p-manage', index: 3, title: '无人应答', raw_text: '他按下按钮。', sequence_count: 1, status: 'shooting' },
]
const sequence = { id: 's1', position: 0, title: '收到信号', source_excerpt: '他按下按钮。', confirmed_design_count: 0 }
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
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
      return respond({ items, ...(projectId === 'p-unknown' ? {} : {pagination: { total: items.length }}) })
    }
    const chapter = chapters.find(row => path.endsWith(`/chapters/${row.id}`) || path.includes(`/chapters/${row.id}/`))
    if (chapter && path.endsWith('/workbench-management')) return respond({ chapter_id: chapter.id, title: chapter.title,
      has_source: Boolean(chapter.raw_text), historical_sequences: [], sequences: chapter.id === 'manage' ? [{ ...sequence, object_count: 0, canvas_count: 0 }] : [] })
    if (chapter && path.endsWith('/objects')) return respond({ revision: 0, objects: [], assets: [] })
    if (chapter && path.includes('/directing/')) return respond({ chapter_id: chapter.id, title: chapter.title, raw_text: chapter.raw_text, sequences: chapter.id === 'manage' ? [sequence] : [] })
    if (chapter) return respond(chapter)
    return respond({ items: [], next_cursor: null })
  })

  await page.goto(`${origin}/projects/p-manage?tab=chapters`)
  const chapter = page.getByRole('row').filter({ hasText: '无人应答' })
  await chapter.getByText('已有场次', { exact: true }).waitFor()
  assert.equal(await chapter.getByRole('button', { name: '场次管理', exact: true }).count(), 0)
  assert.equal(await chapter.getByRole('button', { name: '工作台管理', exact: true }).count(), 1)
  assert.equal(await page.getByRole('heading', { name: '章节场次', exact: true }).count(), 1)
  const heading = page.getByRole('heading', { name: '章节场次', exact: true })
  const search = page.getByRole('textbox', { name: '搜索章节', exact: true })
  assert.ok(Math.abs((await heading.boundingBox()).y - (await search.boundingBox()).y) < 15)
  assert.equal(await page.getByRole('button', { name: '更多', exact: true }).count(), 0)
  await chapter.getByRole('button', { name: '工作台管理', exact: true }).click()
  await page.waitForURL('**/chapters/manage/workbench-management')
  await page.goto(`${origin}/projects/p-source?tab=chapters`)
  const source = page.getByRole('row').filter({ hasText: '便利店的灯' })
  await source.getByRole('button', { name: '划分场次', exact: true }).click()
  await page.waitForURL('**/workbench-management?step=division')
  await page.goto(`${origin}/projects/p-raw?tab=chapters`)
  const raw = page.getByRole('row').filter({ hasText: '夜入长安' })
  await raw.getByRole('button', { name: '工作台管理', exact: true }).waitFor()
  await raw.getByRole('button', { name: '编辑原文', exact: true }).click()
  await page.getByRole('textbox', { name: '章节原文', exact: true }).waitFor()
  await page.locator('.chapter-editor-drawer').getByRole('button', {name:'返回',exact:true}).click()
  for (const theme of ['mist','solid']) {
    await page.evaluate(value => localStorage.setItem('jellyfish_appearance', value), theme)
    await page.reload()
    for (const viewport of [{width:1440,height:900},{width:1366,height:768},{width:1024,height:440},{width:1023,height:768},{width:768,height:768},{width:767,height:768},{width:375,height:812}]) {
      await page.setViewportSize(viewport)
      await page.getByRole('heading',{name:'章节场次',exact:true}).waitFor()
      await page.screenshot({path:join(output, `chapter-list-${theme}-${viewport.width}-${viewport.height}.png`),animations:'disabled'})
      await raw.getByRole('button', { name: '编辑原文', exact: true }).press('Enter')
      const close = page.locator('.chapter-editor-drawer').getByRole('button', {name:'返回',exact:true})
      await close.scrollIntoViewIfNeeded()
      const box=await close.boundingBox()
      assert.ok(box.y+box.height<=viewport.height+1, '编辑器返回操作可达')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true)
      await page.screenshot({path:join(output, `chapter-${theme}-${viewport.width}-${viewport.height}.png`),animations:'disabled'})
      await close.click()
      await page.getByRole('textbox', {name:'搜索章节',exact:true}).waitFor()
      assert.equal(await raw.getByRole('button', {name:'编辑原文',exact:true}).evaluate(button => button === document.activeElement), true)
    }
  }
  await page.goto(`${origin}/projects/p-unknown?tab=chapters`)
  await page.getByRole('row').filter({hasText:'未知数量章节'}).getByRole('button', {name:'工作台管理',exact:true}).waitFor()
  await page.getByText('数量未确认', {exact:true}).waitFor()
  assert.equal(await page.getByText('共 1 章', {exact:true}).count(), 0)
  await page.goto(`${origin}/projects/p-failed?tab=chapters`)
  await page.getByText('章节列表读取失败，请重试',{exact:true}).waitFor()
  await page.getByRole('button',{name:/重\s*试/}).waitFor()
  assert.equal(await page.getByText('共 0 章',{exact:true}).count(),0)
  await page.goto(`${origin}/projects/p-empty?tab=chapters`)
  await page.getByText('共 0 章',{exact:true}).waitFor()
  await page.getByText('添加第一章，开始划分场次',{exact:true}).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS chapter compact toolbar, single state actions, raw editor and responsive actions')
} finally {
  await cleanup()
}
