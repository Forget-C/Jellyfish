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
  let failResourceRead = false
  let pendingOverview
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() !== 'GET') writes.push([request.method(), path])
    const respond = data => route.fulfill({ json: { success: true, data } })
    const projectId = path.match(/\/projects\/(p-[^/]+)/)?.[1] ?? url.searchParams.get('project_id')
    if (pendingOverview && (path.endsWith(`/projects/${projectId}`) || path.endsWith('/chapters') || path.includes('/entities/') || path.endsWith('/overview'))) await pendingOverview
    if (path.endsWith(`/projects/${projectId}`)) return respond({ id: projectId, name: projectId, stats: {} })
    if (/\/entities\/(actor|character|scene|prop|costume)$/.test(path)) {
      const kind = path.split('/').at(-1)
      if (failResourceRead && kind === 'costume') return route.fulfill({ status: 503, json: { detail: '服装暂不可用' } })
      const day = { actor: 3, character: 6, scene: 9, prop: 12, costume: 15 }[kind]
      const count = projectId === 'p-rich' ? 3 : projectId === 'p-manage' && kind === 'character' ? 1 : 0
      const items = Array.from({ length: count }, (_, n) => ({ id: kind + n, name: `${kind} ${n}`,
        project_id: projectId, created_at: `2026-01-${String(day - n).padStart(2, '0')}T00:00:00Z` }))
      return respond({ items, pagination: { total: count } })
    }
    if (path.endsWith('/entities/character/character0')) return respond({ id: 'character0', name: 'character 0', project_id: 'p-manage' })
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
  const info = page.getByRole('region', { name: '项目信息', exact: true })
  const resources = page.getByRole('region', { name: '项目资源', exact: true })
  const scenes = page.getByRole('region', { name: '章节场次', exact: true })
  for (const [width, height] of [[1366, 768], [390, 844]]) {
    await page.setViewportSize({ width, height })
    let expected
    for (const state of ['empty', 'manage', 'rich']) {
      let release
      pendingOverview = new Promise(resolve => { release = resolve })
      await page.goto(`${origin}/projects/p-${state}?tab=dashboard`, { waitUntil: 'domcontentloaded' })
      const panels = [current, info, resources, scenes]
      const regions = () => Promise.all(panels.map(panel => panel.evaluate(node => [node.offsetTop, node.offsetWidth, node.offsetHeight])))
      try {
        await Promise.all(panels.map(panel => panel.locator('[aria-busy="true"]').waitFor()))
        expected ??= await regions()
        assert.deepEqual(await regions(), expected, '加载中各区块位置和尺寸一致')
      } finally {
        release()
        pendingOverview = undefined
      }
      await Promise.all(panels.map(panel => panel.locator('[aria-busy="false"]').waitFor()))
      assert.deepEqual(await regions(), expected, '空、单条和多条的区块位置和尺寸一致')
      assert.equal(await resources.getByRole('button').count(), { empty: 0, manage: 1, rich: 3 }[state])
      assert.equal(await scenes.getByRole('listitem').count(), { empty: 0, manage: 1, rich: 3 }[state])
      if (state === 'rich') assert.deepEqual(await resources.getByRole('button').allTextContents(), ['costume 0服装', 'costume 1服装', 'costume 2服装'])
      const [first, second, third, fourth] = expected
      if (width === 1366) assert.ok(first[0] === second[0] && first[2] === second[2] && third[1] === fourth[1] && fourth[0] > third[0])
      else assert.ok(expected.every((entry, index) => entry[1] === first[1] && (index === 0 || entry[0] > expected[index - 1][0])))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true)
      await page.screenshot({ path: join(output, `overview-${width}-${state}.png`), animations: 'disabled' })
    }
  }
  await visit('rich')
  const chapterOptions = scenes.getByRole('group', { name: '选择章节' })
  await chapterOptions.getByRole('button', { name: '丰富章节4', exact: true }).waitFor()
  assert.deepEqual(await chapterOptions.getByRole('button').allTextContents(), ['丰富章节4','丰富章节1','丰富章节2：这是用于验证概览长章节名称可换行的标题'])
  assert.equal(await chapterOptions.getByRole('button', { pressed: true }).textContent(), '丰富章节4')
  assert.equal(await page.getByRole('heading', { name: '项目概览', exact: true }).count(), 1)
  assert.equal(await page.getByRole('button', { name: '更多', exact: true }).count(), 0)
  assert.equal(await scenes.getByRole('link', { name: '丰富章节4场次1', exact: true }).getAttribute('href'), '/projects/p-rich/chapters/rich-4/workbench-management?sequence=rich-4-s1')
  assert.equal(await scenes.getByRole('listitem').count(), 3)
  assert.equal(await scenes.getByRole('link', { name: /查看本章全部场次/ }).getAttribute('href'), '/projects/p-rich/chapters/rich-4/workbench-management')
  assert.equal(await scenes.getByRole('link', { name: /查看全部章节/ }).getAttribute('href'), '/projects/p-rich?tab=chapters')
  await chapterOptions.getByRole('button', { name: '丰富章节1', exact: true }).click()
  await scenes.getByRole('link', { name: '丰富章节1场次1', exact: true }).waitFor()
  assert.equal(await scenes.getByRole('link', { name: '丰富章节4场次1', exact: true }).count(), 0)
  await current.getByRole('heading',{name:'第 4 章 · 丰富章节4',exact:true}).waitFor()
  for (const theme of ['mist','solid']) {
    await page.evaluate(value => localStorage.setItem('jellyfish_appearance',value),theme)
    await page.reload()
    for (const viewport of [{width:1440,height:900},{width:1366,height:768},{width:1024,height:440},{width:1023,height:768},{width:768,height:768},{width:767,height:768},{width:375,height:812}]) {
      await page.setViewportSize(viewport)
      await chapterOptions.getByRole('button',{name:'丰富章节4',exact:true}).waitFor()
      await scenes.getByRole('listitem').first().waitFor()
      assert.equal(await scenes.getByRole('listitem').count(),3)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true)
      await scenes.getByRole('link',{name:/查看全部章节/}).scrollIntoViewIfNeeded()
      await page.screenshot({path:join(output, `overview-${theme}-${viewport.width}-${viewport.height}.png`),animations:'disabled'})
    }
  }
  await page.setViewportSize({width:1440,height:900})
  await visit('manage')
  const resourceLink = resources.getByRole('link', { name: '角色 1', exact: true })
  assert.equal(await resourceLink.getAttribute('href'), '/projects/p-manage?tab=roles')
  const resourceButton = resources.getByRole('button', { name: 'character 0 角色', exact: true })
  await resourceButton.click()
  await page.getByRole('textbox', { name: '名称', exact: true }).waitFor()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await resourceButton.waitFor()
  await page.waitForFunction(() => document.activeElement?.textContent.includes('character 0'))
  failResourceRead = true
  await visit('manage')
  const retryResources = resources.getByRole('button', { name: '重试读取资源', exact: true })
  await retryResources.waitFor()
  assert.ok(await resourceButton.isVisible())
  failResourceRead = false
  await retryResources.click()
  await retryResources.waitFor({ state: 'hidden' })
  assert.ok(await resourceButton.isVisible())
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
  const canvasCard = canvases.getByRole('article').filter({ has: page.getByRole('link', { name: /真实生成画布/ }) })
  const cover = canvasCard.locator('img')
  assert.ok((await cover.getAttribute('src')).endsWith('/files/cover-1/download'))
  const assertCoverAboveCaption = async () => {
    await cover.evaluate(image => image.decode())
    const coverBox = await cover.boundingBox(), captionBox = await canvasCard.getByRole('heading').boundingBox()
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
  await scenes.getByText('划分场次后，可在这里继续制作',{exact:true}).waitFor()
  await visit('scene-failed')
  await scenes.getByText('场次暂不可用',{exact:true}).waitFor()
  assert.equal(await scenes.getByText('暂无章节场次',{exact:true}).count(),0)
  failSceneRead = false
  await scenes.getByRole('button',{name:'重试读取场次',exact:true}).click()
  await scenes.getByText('划分场次后，可在这里继续制作',{exact:true}).waitFor()
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
