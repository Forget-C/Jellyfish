import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-project-lobby-')
const port = 4783
const origin = `http://127.0.0.1:${port}`
process.chdir(root)

const projects = [
  { id: 'p1', name: '长安夜行', description: '夜市调查', style: '真人古装', progress: 25, stats: { chapters: 1, updated_at: '2026-09-15 10:00' } },
  { id: 'p2', name: '雨停以前', description: '雨夜街景', style: '真人都市', progress: 50, stats: { chapters: 1, updated_at: '2026-09-14 11:00' } },
  { id: 'p3', name: '轨道尽头', style: '真人科幻', progress: 75, stats: { chapters: 1, updated_at: '2026-09-13 12:00' } },
  { id: 'p4', name: '失联的项目', style: '真人都市', stats: { chapters: 0 } },
]
const chapters = {
  p1: { id: 'ch1', project_id: 'p1', index: 2, title: '夜入长安', raw_text: '', sequence_count: 0 },
  p2: { id: 'ch2', project_id: 'p2', index: 3, title: '便利店的灯', raw_text: '门还开着。', sequence_count: 0 },
  p3: { id: 'ch3', project_id: 'p3', index: 1, title: '无人应答', raw_text: '天线停止转动。', sequence_count: 1 },
}
const list = items => ({ items, total: items.length, page: 1, page_size: 100, pagination: { total: items.length, page: 1, page_size: 100, total_pages: 1 } })
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
let browser, page
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(8000)
  const errors = []
  const deletes = []
  let failProjects = false, failChapter = true, failDelete = true
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', route => {
    const request = route.request()
    const url = new URL(request.url())
    const { pathname } = url
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (pathname.endsWith('/studio/projects')) {
      if (request.method() === 'POST') {
        const created = request.postDataJSON()
        projects.push(created)
        return respond(created)
      }
      return failProjects ? route.fulfill({ status: 503, json: { detail: 'fixture unavailable' } }) : respond(list(projects))
    }
    const projectId = pathname.match(/\/studio\/projects\/([^/]+)$/)?.[1]
    if (projectId) {
      const index = projects.findIndex(project => project.id === projectId)
      if (request.method() === 'DELETE') {
        deletes.push(projectId)
        if (projectId === 'p2' && failDelete) return route.fulfill({ status: 503, json: { detail: 'fixture unavailable' } })
        if (index !== -1) projects.splice(index, 1)
        return respond(null)
      }
      return respond(projects[index])
    }
    if (pathname.endsWith('/studio/chapters')) {
      const projectId = url.searchParams.get('project_id')
      if (projectId === 'p4' && failChapter) return route.fulfill({ status: 503, json: { detail: 'fixture unavailable' } })
      return respond(list(chapters[projectId] ? [chapters[projectId]] : []))
    }
    const overview = Object.values(chapters).find(item => pathname.endsWith(`/directing/chapters/${item.id}/overview`))
    if (overview) return respond({ chapter_id: overview.id, title: overview.title, raw_text: overview.raw_text, sequences: [], task_ids: [] })
    const chapter = Object.values(chapters).find(item => pathname.endsWith(`/chapters/${item.id}`))
    if (chapter) return respond(chapter)
    if (pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    return respond(list([]))
  })
  const visitProjects = () => page.goto(`${origin}/projects`)
  const projectCard = name => page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) })
  await visitProjects()
  const card = projectCard('长安夜行')
  const detail = card.getByRole('button', { name: '详情', exact: true })
  await detail.hover()
  assert.equal(await page.getByRole('dialog').count(), 0)
  await detail.press('Enter')
  const dialog = page.getByRole('dialog', { name: /长安夜行/ })
  await dialog.getByText(/夜入长安/).waitFor()
  await page.waitForFunction(() => document.activeElement?.closest('[role="dialog"]'))
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await detail.evaluate(element => element === document.activeElement), true)

  await page.getByText('章节状态读取失败', { exact: true }).waitFor()
  const filterStage = async name => {
    await page.getByRole('combobox', { name: '制作阶段筛选' }).press('Enter')
    await page.getByRole('option', { name, exact: true }).click()
  }
  await filterStage('待补原文')
  const chapterFailure = page.getByRole('alert').filter({ hasText: '部分项目的章节状态读取失败，未纳入此筛选' })
  await chapterFailure.waitFor()
  await page.getByText('1 个项目', { exact: true }).waitFor()
  failChapter = false
  await chapterFailure.getByRole('button', { name: /^重\s*试$/ }).click()
  await projectCard('失联的项目').getByRole('link', { name: '创建第一章' }).waitFor()
  await chapterFailure.waitFor({ state: 'hidden' })
  await filterStage('全部状态')

  const search = page.getByRole('textbox', { name: '搜索项目' })
  await search.fill('夜市调查')
  await page.getByText('1 个项目', { exact: true }).waitFor()
  await card.waitFor()
  await search.fill('不存在的项目')
  await page.getByText('没有匹配的项目', { exact: true }).waitFor()
  await search.clear()
  await page.getByText('4 个项目', { exact: true }).waitFor()

  const displayOptions = page.getByRole('button', { name: /显示与管理/ })
  const menu = page.getByRole('menu')
  const chooseDisplay = async name => {
    await displayOptions.click()
    await menu.getByRole('menuitem', { name, exact: true }).click()
    await menu.waitFor({ state: 'hidden' })
  }
  await chooseDisplay('升序')
  await page.getByRole('article').first().getByRole('link', { name: '轨道尽头', exact: true }).waitFor()
  await chooseDisplay('大卡视图')
  await card.getByText('夜市调查', { exact: true }).waitFor()
  await chooseDisplay('卡片视图')
  await card.getByText('夜市调查', { exact: true }).waitFor({ state: 'hidden' })
  await chooseDisplay('降序')

  for (const width of [1440, 1024, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await card.getByRole('link', { name: '编辑原文', exact: true }).waitFor()
    assert.equal(await page.getByText(/更新于 2026-09-15/).count(), 1)
    const title = await page.getByRole('heading', { name: '项目', exact: true }).boundingBox()
    const create = await page.getByRole('button', { name: /新建项目/ }).boundingBox()
    const searchBox = await search.boundingBox()
    if (width >= 1024) {
      assert.ok(Math.abs(create.y + create.height / 2 - searchBox.y - searchBox.height / 2) < 2)
      assert.ok(title.height <= 30)
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    await page.screenshot({ path: `${output}/projects-${width}.png`, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 900 })

  await card.getByRole('link', { name: '长安夜行', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/projects/p1')
  await visitProjects()
  await card.getByRole('link', { name: '编辑原文', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/projects/p1' && url.searchParams.get('edit') === 'ch1')
  await visitProjects()
  await projectCard('雨停以前').getByRole('link', { name: '划分场次', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/projects/p2' && url.searchParams.get('chapter') === 'ch2' && url.searchParams.get('panel') === 'source')
  await visitProjects()
  await projectCard('轨道尽头').getByRole('link', { name: '进入场次', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/projects/p3' && url.searchParams.get('chapter') === 'ch3')
  await page.getByRole('dialog').getByText('场次管理 · 无人应答', { exact: true }).waitFor()

  failProjects = true
  await visitProjects()
  const projectFailure = page.getByRole('alert').filter({ hasText: '无法读取项目列表' })
  await projectFailure.waitFor()
  assert.equal(await page.getByText(/暂无项目/).count(), 0)
  failProjects = false
  await projectFailure.getByRole('button', { name: /^重\s*试$/ }).click()
  await projectFailure.waitFor({ state: 'hidden' })
  await card.waitFor()

  await chooseDisplay('批量管理')
  await card.getByRole('checkbox', { name: '选择 长安夜行' }).check()
  await projectCard('雨停以前').getByRole('checkbox', { name: '选择 雨停以前' }).check()
  await page.getByText('已选 2 个项目', { exact: true }).waitFor()
  const batchDelete = page.getByRole('button', { name: '删除选中' })
  await batchDelete.click()
  await page.getByText('批量删除项目', { exact: true }).waitFor()
  assert.deepEqual(deletes, [])
  await page.getByRole('button', { name: /^取\s*消$/ }).click()
  assert.deepEqual(deletes, [])
  await batchDelete.click()
  await page.getByRole('button', { name: /^删\s*除$/ }).click()
  await page.getByText('已删除 1 个项目，其余项目删除失败', { exact: true }).waitFor()
  await card.waitFor({ state: 'hidden' })
  await page.getByText('已选 1 个项目', { exact: true }).waitFor()
  failDelete = false
  await batchDelete.click()
  await page.getByRole('button', { name: /^删\s*除$/ }).click()
  await page.getByText('已批量删除选中项目', { exact: true }).waitFor()
  await projectCard('雨停以前').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '退出批量管理' }).click()
  assert.deepEqual(deletes.sort(), ['p1', 'p2', 'p2'])

  await page.getByRole('button', { name: /新建项目/ }).click()
  const createDialog = page.getByRole('dialog', { name: '新建短剧项目' })
  await createDialog.getByRole('textbox', { name: '项目名称', exact: true }).fill('新的制作项目')
  await createDialog.getByRole('button', { name: '创建并进入' }).click()
  await page.waitForURL(url => url.pathname === `/projects/${projects.find(project => project.name === '新的制作项目')?.id}`)
  assert.deepEqual(errors, [])
  console.log(`Project lobby browser acceptance passed. Evidence: ${output}`)
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` })
  console.log(await page?.locator('body').ariaSnapshot())
  throw error
} finally {
  await cleanup()
}
