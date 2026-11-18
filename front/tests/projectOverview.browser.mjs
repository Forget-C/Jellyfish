import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const port = 4539
const origin = `http://127.0.0.1:${port}`
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
const output = await browserOutput('jellyfish-project-overview-')
const chapters = [
  ...[5, 2, 1, 4, 3].map(index => ({id:`rich-${index}`,project_id:'p-rich',index,title:index===2?'丰富章节2：这是用于验证概览长章节名称可换行的标题':`丰富章节${index}`,raw_text:'真实原文',sequence_count:5,status:'shooting'})),
  { id: 'unknown', project_id: 'p-unknown', index: 1, title: '未知场次章节', raw_text:'已有原文',status:'draft'},
  { id: 'scene-failed', project_id: 'p-scene-failed', index: 1, title: '可重试章节', raw_text:'已有原文',sequence_count:1,status:'draft'},
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
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin }; sessionStorage.setItem('directing-recent:p-rich', JSON.stringify({chapterId:'rich-4',sequenceId:'rich-4-s1',view:'design'})) })
  const errors = [], writes = []
  let failSceneRead = true
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
    if (chapter?.id === 'scene-failed' && path.includes('/directing/') && failSceneRead) return route.fulfill({status:503,json:{detail:'场次暂不可用'}})
    if (chapter && path.endsWith('/workbench-management')) return respond({ chapter_id: chapter.id, title: chapter.title,
      has_source: Boolean(chapter.raw_text), historical_sequences: [], sequences: chapter.id === 'manage' ? [{ ...sequence, object_count: 0, canvas_count: 0 }] : [] })
    if (chapter && path.endsWith('/objects')) return respond({ revision: 0, objects: [], assets: [] })
    if (chapter && path.includes('/directing/')) return respond({ chapter_id: chapter.id, title: chapter.title, raw_text: chapter.raw_text, sequences: chapter.id.startsWith('rich-') ? Array.from({length:5},(_,n)=>({...sequence,id:`${chapter.id}-s${n+1}`,title:`${chapter.title}场次${n+1}${n===2?' · 长场次名称应自然换行并保持进入箭头可达':''}`})) : chapter.id === 'manage' ? [sequence] : [] })
    if (chapter) return respond(chapter)
    if (path.endsWith('/generation-canvases')) {
      const query = url.searchParams.get('q')
      if (query === 'failed') return route.fulfill({ status: 503, json: { detail: '画布暂不可用' } })
      const items = query === 'empty' ? [] : [{ id: 'c1', name: '真实生成画布', cover_file_id: 'cover-1', revision: 1, updated_at: '2026-01-01T00:00:00Z' }]
      return respond({ items, pagination: { total: items.length } })
    }
    if (path.endsWith('/generation-canvases/c1')) return respond({ id: 'c1', revision: 1, document: { id: 'c1', name: '真实生成画布', cards: [], edges: [], input_order: {} } })
    if (path.endsWith('/catalog')) return respond({ cards: [], connection_policies: [] })
    if (path.endsWith('/runtime')) return respond({ cursor: 0, runs: [], nodes: [] })
    if (path.endsWith('/files/cover-1/download')) return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="navy"/></svg>',
    })
    return respond({ items: [], next_cursor: null })
  })

  const current = page.getByRole('region', { name: '当前制作', exact: true })
  const canvases = page.getByRole('region', { name: '画布列表', exact: true })
  const visit = id => page.goto(`${origin}/projects/p-${id}?tab=dashboard`)
  await visit('rich')
  const scenes = page.getByRole('region', {name:'章节场次',exact:true})
  await scenes.getByRole('heading', {name:'丰富章节4',exact:true}).waitFor()
  assert.equal(await scenes.getByRole('article').count(),3)
  assert.deepEqual(await scenes.getByRole('heading', {level:3}).allTextContents(), ['丰富章节4','丰富章节1','丰富章节2：这是用于验证概览长章节名称可换行的标题'])
  for (const group of await scenes.getByRole('article').all()) assert.equal(await group.getByRole('link', {name:/场次/}).count(),4)
  assert.equal(await page.getByRole('heading',{name:'项目概览',exact:true}).count(),1)
  assert.equal(await page.getByRole('button',{name:'更多',exact:true}).count(),0)
  const groups = await scenes.getByRole('article').all()
  assert.equal(await groups[0].getByRole('link',{name:'丰富章节4场次1',exact:true}).getAttribute('href'),'/projects/p-rich/chapters/rich-4/workbench-management?sequence=rich-4-s1')
  assert.equal(await groups[0].getByRole('link',{name:/查看本章全部场次/}).getAttribute('href'),'/projects/p-rich/chapters/rich-4/workbench-management')
  assert.equal(await scenes.getByRole('link',{name:/查看全部章节/}).getAttribute('href'),'/projects/p-rich?tab=chapters')
  await current.getByRole('heading',{name:'第 4 章 · 丰富章节4',exact:true}).waitFor()
  for (const theme of ['mist','solid']) {
    await page.evaluate(value => localStorage.setItem('jellyfish_appearance',value),theme)
    await page.reload()
    for (const viewport of [{width:1440,height:900},{width:1366,height:768},{width:1024,height:440},{width:1023,height:768},{width:768,height:768},{width:767,height:768},{width:375,height:812}]) {
      await page.setViewportSize(viewport)
      await scenes.getByRole('heading',{name:'丰富章节4',exact:true}).waitFor()
      assert.equal(await scenes.getByRole('article').count(),3)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true)
      await scenes.getByRole('link',{name:/查看全部章节/}).scrollIntoViewIfNeeded()
      await page.screenshot({path:join(output, `overview-${theme}-${viewport.width}-${viewport.height}.png`),animations:'disabled'})
    }
  }
  await page.setViewportSize({width:1440,height:900})
  await visit('raw')
  await current.getByText('待补原文', { exact: true }).waitFor()
  await current.getByRole('button', { name: '编辑原文', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('tab') === 'chapters' && url.searchParams.get('edit') === 'raw')
  await page.getByRole('textbox', { name: '章节原文', exact: true }).waitFor()
  await visit('source')
  await current.getByText('待划分场次', { exact: true }).waitFor()
  await current.getByRole('button', { name: '划分场次', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/projects/p-source/chapters/source/workbench-management' && url.searchParams.get('step') === 'division')
  await page.getByRole('heading', { name: '场次划分', exact: true }).waitFor()
  await visit('manage')
  await current.getByText('已有场次', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'project-overview-desktop.png'), animations: 'disabled' })
  await page.goto(`${origin}/canvases`)
  const canvasLink = canvases.getByRole('link', { name: /真实生成画布/ })
  await canvasLink.waitFor()
  const cover = canvasLink.locator('img')
  assert.ok((await cover.getAttribute('src')).endsWith('/files/cover-1/download'))
  const assertCoverAboveCaption = async () => {
    await cover.evaluate(image => image.decode())
    const coverBox = await cover.boundingBox(), captionBox = await canvasLink.getByRole('heading').boundingBox()
    assert.ok(coverBox.y + coverBox.height <= captionBox.y, '画布封面不能遮挡下方标题链接')
  }
  await assertCoverAboveCaption()
  assert.equal(await canvasLink.getAttribute('href'), '/canvases/c1')
  await canvasLink.click()
  await page.waitForURL('**/canvases/c1')
  await page.getByRole('navigation', { name: '主导航', exact: true }).waitFor({ state: 'hidden' })
  await visit('manage')
  await current.getByText('已有场次', { exact: true }).waitFor()
  await current.getByRole('button', { name: '工作台管理', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/projects/p-manage/chapters/manage/workbench-management')
  await page.getByRole('group', { name: '选择场次' }).getByRole('button', { name: /收到信号/ }).first().waitFor()
  await page.goto(`${origin}/projects/p-manage?tab=chapters`)
  const chapter = page.getByRole('row').filter({ hasText: '无人应答' })
  await chapter.getByText('已有场次', { exact: true }).waitFor()
  await chapter.getByRole('button', { name: '工作台管理', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'chapters-desktop.png'), animations: 'disabled' })

  await page.setViewportSize({ width: 375, height: 812 })
  await visit('manage')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true)
  await page.screenshot({ path: join(output, 'project-overview-mobile.png'), animations: 'disabled' })
  await visit('unknown')
  await current.getByText('场次数量待核对',{exact:true}).waitFor()
  await current.getByRole('button',{name:'工作台管理',exact:true}).waitFor()
  await scenes.getByText('暂无章节场次',{exact:true}).waitFor()
  await visit('scene-failed')
  await scenes.getByText('场次暂不可用',{exact:true}).waitFor()
  assert.equal(await scenes.getByText('暂无章节场次',{exact:true}).count(),0)
  failSceneRead = false
  await scenes.getByRole('button',{name:'重试读取场次',exact:true}).click()
  await scenes.getByText('暂无章节场次',{exact:true}).waitFor()
  await visit('empty')
  await current.getByText('创建第一章开始创作', { exact: true }).waitFor()
  await visit('failed')
  await current.getByText('章节列表读取失败，请重试', { exact: true }).waitFor()
  await page.goto(`${origin}/canvases?q=empty`)
  await canvases.getByText('没有匹配的画布', { exact: true }).waitFor()
  await page.goto(`${origin}/canvases?q=failed`)
  await canvases.getByRole('alert').waitFor()
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [])
  console.log('PASS project overview, chapter destinations, canvas cover, and mobile layout')
} finally {
  await cleanup()
}
