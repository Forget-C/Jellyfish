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

const longProjectName = '失联的项目' + '超长名称'.repeat(12)
const projects = [
  { id: 'p1', name: '长安夜行', description: '夜市调查', style: '真人古装', progress: 25, stats: { chapters: 1, updated_at: '2026-09-15 10:00' } },
  { id: 'p2', name: '雨停以前', description: '雨夜街景', style: '真人都市', progress: 50, stats: { chapters: 1, updated_at: '2026-09-14 11:00' } },
  { id: 'p3', name: '轨道尽头', style: '真人科幻', progress: 75, stats: { chapters: 1 } },
  { id: 'p4', name: longProjectName, style: '真人都市', stats: { chapters: 0 } },
]
const chapters = {
  p1: { id: 'ch1', project_id: 'p1', index: 2, title: '夜入长安', raw_text: '', sequence_count: 0 },
  p2: { id: 'ch2', project_id: 'p2', index: 3, title: '便利店的灯', raw_text: '门还开着。', sequence_count: 0 },
  p3: { id: 'ch3', project_id: 'p3', index: 1, title: '无人应答', raw_text: '天线停止转动。', sequence_count: 1 },
}
const list = (items, total = items.length) => ({ items, total, page: 1, page_size: 100, pagination: { total, page: 1, page_size: 100, total_pages: 1 } })
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
  const saves = []
  let releaseSave
  let holdSave = false
  const orderRequests = []
  let failProjects = false, failChapter = true, failDelete = true, failSave = true
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
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
      if (failProjects) return route.fulfill({ status: 503, json: { detail: 'fixture unavailable' } })
      const order = url.searchParams.get('order'), descending = url.searchParams.get('is_desc') === 'true'
      orderRequests.push({ order, descending })
      if (order !== 'updated_at') return respond(list(projects))
      const updateOrder = ['p3', 'p4', 'p2', 'p1']
      const ordered = [...projects].sort((left, right) => updateOrder.indexOf(left.id) - updateOrder.indexOf(right.id))
      return respond(list(descending ? ordered.reverse() : ordered))
    }
    const projectId = pathname.match(/\/studio\/projects\/([^/]+)$/)?.[1]
    if (projectId) {
      const index = projects.findIndex(project => project.id === projectId)
      if (request.method() === 'PATCH') {
        saves.push(request.postDataJSON())
        if (holdSave) await new Promise(resolve => { releaseSave = resolve })
        if (failSave) return route.fulfill({ status: 503, json: { detail: '暂时无法保存项目' } })
        projects[index] = { ...projects[index], ...request.postDataJSON() }
        return respond(projects[index])
      }
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
      return respond(list(chapters[projectId] ? [chapters[projectId]] : [], projectId === 'p2' ? 4 : undefined))
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
  await page.goto(`${origin}/projects/p1?tab=settings`)
  const name = page.getByRole('textbox', { name: '项目名称' })
  await name.waitFor()
  const save = page.getByRole('button', { name: /保\s*存$/ })
  assert.equal(await save.isDisabled(), true)
  const seed = page.getByRole('spinbutton', { name: '全局种子值' })
  await seed.clear()
  await save.click()
  await page.getByText('请输入非负整数').waitFor()
  assert.equal(saves.length, 0)
  await page.getByRole('button', { name: /^取\s*消$/ }).click()
  await name.fill('长安夜行改名')
  await save.click()
  await page.getByText(/暂时无法保存项目/).waitFor()
  assert.equal(await name.inputValue(), '长安夜行改名')
  failSave = false
  holdSave = true
  await save.click()
  const projectNav = page.getByRole('navigation', { name: '项目导航' })
  await projectNav.getByRole('link', { name: '项目概览' }).click()
  await projectNav.getByRole('link', { name: '项目设置' }).click()
  await name.waitFor()
  assert.equal(await name.isDisabled(), true)
  assert.equal(await save.isDisabled(), true)
  holdSave = false
  releaseSave()
  await projectNav.getByText('长安夜行改名', { exact: true }).waitFor()
  await name.fill('放弃这个改名')
  await page.getByRole('button', { name: /^取\s*消$/ }).click()
  assert.equal(await name.inputValue(), '长安夜行改名')
  await name.fill('离开时不保存')
  await projectNav.getByRole('link', { name: '返回项目列表' }).click()
  await projectCard('长安夜行改名').waitFor()
  await page.goto(`${origin}/projects/p1?tab=settings`)
  await name.fill('长安夜行')
  await save.click()
  await projectNav.getByText('长安夜行', { exact: true }).waitFor()
  await projectNav.getByRole('link', { name: '返回项目列表' }).click()
  await card.getByRole('link', { name: '长安夜行', exact: true }).waitFor()
  assert.equal(await card.getByText('示例封面').count(), 0)
  assert.equal(await card.getByRole('button', { name: '详情' }).count(), 0)
  const deleteTrigger = card.getByRole('button', { name: '删除 长安夜行', exact: true })
  await deleteTrigger.press('Enter')
  const deleteDialog = page.getByRole('dialog', { name: '删除项目' })
  await deleteDialog.getByText(/长安夜行/).waitFor()
  await deleteDialog.getByRole('button', { name: /^取\s*消$/ }).click()
  await deleteDialog.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '删除 长安夜行')
  assert.deepEqual(deletes, [])

  await page.getByText('章节状态读取失败', { exact: true }).waitFor()
  const filterStage = async name => {
    await page.getByRole('combobox', { name: '制作阶段筛选' }).press('Enter')
    await page.getByRole('option', { name, exact: true }).click()
  }
  await filterStage('待补原文')
  const chapterFailure = page.getByRole('alert').filter({ hasText: '部分项目的章节状态读取失败，未纳入此筛选' })
  await chapterFailure.waitFor()
  assert.equal(await page.getByText(/^显示 \d+ 个$/).count(), 0)
  failChapter = false
  await chapterFailure.getByRole('button', { name: /^重\s*试$/ }).click()
  await projectCard(longProjectName).getByRole('link', { name: '创建第一章' }).waitFor()
  await chapterFailure.waitFor({ state: 'hidden' })
  await page.getByText('显示 2 个', { exact: true }).waitFor()
  await filterStage('全部状态')

  const search = page.getByRole('textbox', { name: '搜索项目' })
  await search.fill('夜市调查')
  await page.getByText('显示 1 个', { exact: true }).waitFor()
  await card.waitFor()
  await search.fill('不存在的项目')
  await page.getByText('没有匹配的项目', { exact: true }).waitFor()
  await page.getByText('显示 0 个', { exact: true }).waitFor()
  await search.clear()
  await page.getByText('显示 4 个', { exact: true }).waitFor()

  const displayOptions = page.getByRole('button', { name: /排序与批量/ })
  const menu = page.getByRole('menu')
  const chooseDisplay = async name => {
    await displayOptions.click()
    await menu.getByRole('menuitem', { name, exact: true }).click()
    await menu.waitFor({ state: 'hidden' })
  }
  await chooseDisplay('升序')
  await page.getByRole('article').first().getByRole('link', { name: '轨道尽头', exact: true }).waitFor()
  assert.deepEqual(orderRequests[0], { order: 'updated_at', descending: true })
  assert.deepEqual(orderRequests.at(-1), { order: 'updated_at', descending: false })
  assert.equal(await projectCard('轨道尽头').getByText(/更新于/).count(), 0)
  await displayOptions.click()
  assert.equal(await menu.getByRole('menuitem', { name: /视图/ }).count(), 0)
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  await chooseDisplay('降序')
  await chooseDisplay('章节数量')
  await page.getByRole('article').first().getByText('共 4 章', { exact: true }).waitFor()
  await chooseDisplay('最近更新')

  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080], [1024, 900], [375, 812]]) {
    await page.setViewportSize({ width, height })
    await card.getByRole('link', { name: '编辑原文', exact: true }).waitFor()
    if (width >= 1366) {
      const links = [
        card.getByRole('link', { name: '编辑原文', exact: true }),
        projectCard('轨道尽头').getByRole('link', { name: '进入场次', exact: true }),
        projectCard(longProjectName).getByRole('link', { name: '创建第一章', exact: true }),
      ]
      const boxes = await Promise.all(links.map(link => link.boundingBox()))
      assert.ok(boxes.every(box => Math.abs(box.y - boxes[0].y) <= 1 && box.height === 32), '同一行的下一步按钮应等高并对齐')
    }
    await page.waitForFunction(wide => {
      const search = document.querySelector('[aria-label="搜索项目"]')
      const create = document.querySelector('.project-lobby-create')
      return Boolean(search.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING) === wide
    }, width >= 1024)
    assert.equal(await page.getByText(/更新于 2026-09-15/).count(), 1)
    const title = await page.getByRole('heading', { name: '项目', exact: true }).boundingBox()
    const createButton = page.getByRole('button', { name: /新建项目/ })
    const create = await createButton.boundingBox()
    const searchBox = await search.boundingBox()
    const count = await page.getByText('显示 4 个', { exact: true }).boundingBox()
    const center = box => box.y + box.height / 2
    assert.ok(Math.abs(center(title) - center(count)) < 3, `${width}px 的标题和数量应在同一行`)
    assert.ok(Math.abs(center(title) - center(create)) < 3, `${width}px 的标题和新建应在同一行`)
    assert.equal(await createButton.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(36, 95, 197)')
    const filter = page.getByRole('combobox', { name: '制作阶段筛选' })
    if (width >= 1024) {
      assert.ok(Math.abs(center(create) - center(searchBox)) < 2)
      assert.ok(create.x > searchBox.x + searchBox.width)
      assert.ok(title.height <= 30)
    } else {
      assert.ok(searchBox.y >= create.y + create.height)
      const firstCard = await card.boundingBox()
      const longCard = await projectCard(longProjectName).boundingBox()
      assert.equal(firstCard.x, longCard.x)
      assert.equal(firstCard.width, longCard.width)
      await createButton.focus()
      await page.keyboard.press('Tab')
      assert.equal(await search.evaluate(element => element === document.activeElement), true)
    }
    await search.focus()
    for (const control of width >= 1024 ? [filter, displayOptions, createButton] : [filter, displayOptions]) {
      await page.keyboard.press('Tab')
      assert.equal(await control.evaluate(element => element === document.activeElement), true)
    }
    await page.getByRole('heading', { name: '项目', exact: true }).click()
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
  assert.equal(await page.getByText(/^显示 \d+ 个$/).count(), 0)
  assert.equal(await page.getByText(/暂无项目/).count(), 0)
  failProjects = false
  await projectFailure.getByRole('button', { name: /^重\s*试$/ }).click()
  await projectFailure.waitFor({ state: 'hidden' })
  await card.waitFor()

  const rain = projectCard('雨停以前')
  await rain.getByRole('button', { name: '删除 雨停以前', exact: true }).click()
  await deleteDialog.getByRole('button', { name: /^删\s*除$/ }).click()
  await deleteDialog.getByText(/fixture unavailable/).waitFor()
  await rain.waitFor()
  await deleteDialog.getByRole('button', { name: /^取\s*消$/ }).click()
  await deleteDialog.waitFor({ state: 'hidden' })
  deletes.length = 0

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

  await page.setViewportSize({ width: 375, height: 812 })
  await projectCard('轨道尽头').getByRole('button', { name: '删除 轨道尽头', exact: true }).click()
  await deleteDialog.getByText(/轨道尽头/).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375)
  await deleteDialog.getByRole('button', { name: /^删\s*除$/ }).click()
  await deleteDialog.waitFor({ state: 'hidden' })
  await projectCard('轨道尽头').waitFor({ state: 'hidden' })
  await page.getByText('显示 1 个', { exact: true }).waitFor()
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.getByRole('button', { name: /新建项目/ }).click()
  const createDialog = page.getByRole('dialog', { name: '新建短剧项目' })
  await createDialog.getByRole('textbox', { name: /项目名称/ }).fill('新的制作项目')
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
