import { assertDetailDrawerLayout } from './detailLayout.assertions.mjs'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-prompt-management-')
const origin = 'http://127.0.0.1:4634'
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4634, strictPort: true, open: false } })
const template = {
  id: 'custom', category: 'video_prompt', name: '创作模板', preview: '简短的内容简介',
  content: Array.from({ length: 70 }, (_, index) => `第 ${index + 1} 行：请描述 {{subject}} 的动作。`).join('\n'),
  variables: ['subject'], variable_defaults: { subject: '主角', note: 'LongValue'.repeat(36) + '\n"保留引号"' }, version: 1,
  is_default: true, is_system: false, created_at: '2026-11-10', updated_at: '2026-11-10',
}
let browser
let listFails = false
let lastQuery = ''
let saveFails = true
let restoreFails = true
let patches = 0
let deletes = 0
let lastPage = 1
const listRequests = []
const system = { ...template, id: 'system', name: '系统模板（用于验证窄屏下长标题与属性标签自动换行）', content: '短正文', variables: [], variable_defaults: {}, is_system: true, is_default: false }
const lateMatch = { ...template, is_default: false, id: 'late-match', name: '后续页模板', preview: '只在后续页简介出现的关键字' }
const allTemplates = [template, system, ...Array.from({ length: 10 }, (_, i) => ({ ...template, is_default: false, id: `extra-${i}`, name: i === 9 ? '长模板名称'.repeat(18) : `其他模板 ${i}`, category: 'bgm' })), ...Array.from({ length: 88 }, (_, i) => ({ ...template, is_default: false, id: `more-${i}`, name: `补充模板 ${i}` })), lateMatch]
// The first service result belongs to a later visual group.
allTemplates.unshift(...allTemplates.splice(2, 1))
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', reducedMotion: 'reduce', viewport: { width: 1366, height: 768 } })
  page.setDefaultTimeout(6000)
  await page.addInitScript(() => {
    window.__ENV = { BACKEND_URL: location.origin }
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedPromptJson = text } } })
  })
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url())
    const respond = data => route.fulfill({ json: { code: 200, data } })
    if (pathname.endsWith('/prompts/categories')) return respond([{ value: 'video_prompt', label: '视频提示词' }])
    if (pathname.endsWith('/prompts/summaries')) {
      lastQuery = searchParams.get('q') ?? ''
      lastPage = Number(searchParams.get('page') || 1)
      if (listFails) return route.fulfill({ status: 500, json: { message: '读取失败' } })
      const size = Number(searchParams.get('page_size') || 10)
      listRequests.push({ page: lastPage, size, q: lastQuery })
      const matches = allTemplates.filter(item => !lastQuery || item.name.includes(lastQuery) || item.preview.includes(lastQuery))
      return respond({ items: matches.slice((lastPage - 1) * size, lastPage * size).map(({id, category, name}) => ({id, category, name})), pagination: { total: matches.length, page: lastPage, page_size: size, max_page: Math.ceil(matches.length / size) } })
    }
    if (route.request().method() === 'GET' && pathname.includes('/prompts/'))
      return respond(allTemplates.find(item => item.id === pathname.split('/').pop()))
    if (pathname.endsWith('/prompts') && route.request().method() === 'POST') {
      const data = route.request().postDataJSON()
      assert.deepEqual(data, {
        category: 'video_prompt', name: '新建模板', content: '镜头使用 {{scene}}',
        variables: ['scene'], variable_defaults: { scene: '外景' }, is_default: false,
      })
      const created = { ...template, ...data, id: 'created' }
      allTemplates.unshift(created)
      return respond(created)
    }
    if (pathname.endsWith('/prompts/custom') && route.request().method() === 'PATCH') {
      patches += 1
      const data = route.request().postDataJSON()
      assert.equal(data.preview, '编辑后的简介')
      if (saveFails) {
        assert.equal(data.is_default, false)
        return route.fulfill({ status: 409, json: { message: '请先将同类别的其他模板设为默认' } })
      }
      Object.assign(template, data)
      return respond(template)
    }
    if (pathname.endsWith('/prompts/system') && route.request().method() === 'PATCH') {
      patches += 1
      assert.deepEqual(route.request().postDataJSON(), { is_default: true })
      if (restoreFails) return route.fulfill({ status: 500, json: { message: '恢复失败' } })
      template.is_default = false
      system.is_default = true
      return respond(system)
    }
    if (pathname.endsWith('/prompts/custom') && route.request().method() === 'DELETE') {
      deletes += 1
      allTemplates.splice(allTemplates.indexOf(template), 1)
      return respond(null)
    }
    return respond({ items: [], next_cursor: null })
  })
  await page.goto(origin + '/prompts')
  await page.getByRole('textbox', { name: '搜索模板名称或简介' }).waitFor()
  const name = page.getByRole('button', { name: template.name, exact: true })
  const other = page.getByRole('button', { name: system.name, exact: true })
  const reader = page.getByRole('region', { name: '模板阅读' })
  await reader.getByRole('heading', { name: template.name, exact: true }).waitFor()
  assert.equal(await name.getAttribute('aria-pressed'), 'true')
  const title = reader.getByRole('heading', { name: template.name, exact: true })
  const defaultTag = reader.getByText('默认提示词', { exact: true })
  assert.ok(Math.abs((await title.boundingBox()).y - (await defaultTag.boundingBox()).y) <= 6)
  assert.equal(await reader.getByText(template.preview, { exact: true }).evaluate(node => getComputedStyle(node).fontSize), '13px')
  assert.equal(await reader.getByRole('heading', { name: '正文', exact: true }).evaluate(node => getComputedStyle(node).fontSize), '14px')
  await reader.getByRole('button', { name: /^复制 JSON$/ }).click()
  await page.waitForFunction(expected => window.copiedPromptJson === expected, JSON.stringify(template.variable_defaults, null, 2))
  let releaseDetail
  const heldDetail = new Promise(resolve => { releaseDetail = resolve })
  await page.route('**/prompts/custom', async route => {
    await heldDetail
    await route.fulfill({ json: { code: 200, data: template } })
  })
  const detailStarted = page.waitForRequest(request => request.url().endsWith('/prompts/custom'))
  await name.press('Enter')
  await detailStarted
  await other.click()
  await page.getByRole('heading', { name: system.name, exact: true }).waitFor()
  for (const [heading, minHeight] of [['正文', 120], ['变量', 64], ['变量默认值', 88]]) {
    const box = await reader.getByRole('heading', { name: heading, exact: true }).evaluate(node => node.closest('section').getBoundingClientRect().height)
    assert.ok(box >= minHeight)
  }
  await reader.getByText('暂无默认值', { exact: true }).waitFor()
  assert.equal(await reader.getByRole('button', { name: '复制 JSON' }).count(), 0)
  const detailFinished = page.waitForEvent('requestfinished', request => request.url().endsWith('/prompts/custom'))
  releaseDetail()
  await detailFinished
  await page.getByRole('heading', { name: system.name, exact: true }).waitFor()
  await page.unroute('**/prompts/custom')
  await page.route('**/prompts/custom', route => route.fulfill({ status: 503, json: {} }), { times: 1 })
  await name.press('Enter')
  await page.getByText('无法读取模板详情').waitFor()
  await page.getByRole('alert').getByRole('button').click()
  await reader.getByRole('heading', { name: template.name }).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0)
  const content = reader.getByText(template.content, { exact: true })
  assert((await content.boundingBox()).height > 400, '正文应自然展开而非矮小预览框')
  assert(await reader.evaluate(element => element.scrollHeight > element.clientHeight), '长正文由阅读区域滚动')
  const list = page.getByRole('region', { name: '模板列表' })
  assert.equal(Math.round((await list.boundingBox()).width), 300)
  await page.screenshot({ path: `${output}/desktop.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await name.and(page.locator('[aria-pressed="true"]')).waitFor()
  await reader.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('dialog').count(), 0, 'the initial mobile selection does not open the reader')
  await name.press('Enter')
  const drawer = page.getByRole('dialog').filter({ hasText: '模板阅读' })
  await drawer.getByRole('heading', { name: template.name }).waitFor()
  await assertDetailDrawerLayout(drawer)
  const json = drawer.locator('pre').filter({ hasText: 'LongValue' })
  assert.equal(await json.textContent(), JSON.stringify(template.variable_defaults, null, 2))
  assert.equal(await json.evaluate(node => node.scrollWidth > node.clientWidth), false)
  await drawer.getByRole('button', { name: /Close|关闭/ }).press('Escape')
  await drawer.waitFor({ state: 'hidden' })
  await name.and(page.locator(':focus')).waitFor()
  await other.press('Enter')
  const systemTitle = drawer.getByRole('heading', { name: system.name, exact: true })
  await systemTitle.waitFor()
  const systemTag = drawer.getByText('系统预置', { exact: true })
  assert.ok((await systemTag.boundingBox()).y > (await systemTitle.boundingBox()).y)
  assert.equal(await drawer.locator('.ant-drawer-body').evaluate(body => body.scrollWidth > body.clientWidth), false)
  await drawer.getByRole('button', { name: /Close|关闭/ }).press('Escape')
  await drawer.waitFor({ state: 'hidden' })
  await other.and(page.locator(':focus')).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.setViewportSize({ width: 1440, height: 900 })
  const search = page.getByRole('textbox', { name: '搜索模板名称或简介' })
  assert.ok(listRequests.every(request => request.page === 1 && request.size === 10), '普通浏览只读取当前页')
  // Older successful or failed searches must not replace the most recent page.
  for (const status of [200, 503]) {
    let release
    const held = new Promise(resolve => { release = resolve })
    const slow = '**/summaries?q=slow*'
    await page.route(slow, async route => {
      await held
      await route.fulfill({ status, json: { data: { items: [], pagination: { total: 0 } } } })
    })
    const pending = page.waitForRequest(request => request.url().includes('q=slow'))
    await search.fill('slow')
    await search.press('Enter')
    await pending
    await search.fill('创作模板')
    await search.press('Enter')
    await page.getByText('共 1 项', { exact: true }).waitFor()
    const finished = page.waitForEvent('requestfinished', request => request.url().includes('q=slow'))
    release()
    await finished
    await name.waitFor()
    assert.equal(await page.getByText('刷新模板失败，已保留当前内容', { exact: true }).count(), 0)
    await page.unroute(slow)
  }
  await search.fill('后续页简介')
  await search.press('Enter')
  await page.getByRole('button', { name: lateMatch.name, exact: true }).and(page.locator('[aria-pressed="true"]')).waitFor()
  await reader.getByRole('heading', { name: lateMatch.name, exact: true }).waitFor()
  await page.getByText('共 1 项', { exact: true }).waitFor()
  assert.ok(listRequests.some(request => request.page === 1 && request.size === 10 && request.q === '后续页简介'))
  await search.fill('简短')
  await search.press('Enter')
  await name.waitFor()
  listFails = true
  await page.getByRole('button', { name: '刷新模板', exact: true }).click()
  await page.getByText('刷新模板失败，已保留当前内容', { exact: true }).waitFor()
  assert.equal(await search.inputValue(), '简短')
  await name.waitFor()
  listFails = false
  await page.getByRole('button', { name: /重\s*试/ }).click()
  await page.getByText('刷新模板失败，已保留当前内容', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(lastQuery, '简短')
  await search.fill('正文不会参与搜索')
  await search.press('Enter')
  await page.getByText('没有匹配的模板', { exact: true }).waitFor()
  await reader.getByText('暂无模板可阅读', { exact: true }).waitFor()
  await page.getByRole('button', { name: '清除搜索' }).click()
  await name.waitFor()
  listFails = true
  await page.reload()
  await page.getByText('无法读取模板列表', { exact: true }).waitFor()
  assert.equal(await reader.getByText('暂无模板可阅读', { exact: true }).count(), 0)
  assert.equal(await page.getByText('共 0 项', { exact: true }).count(), 0)
  assert.equal(await page.getByText('暂无提示词模板', { exact: true }).count(), 0)
  listFails = false
  await page.getByRole('button', { name: /重\s*试/ }).click()
  await page.getByRole('button', { name: template.name, exact: true }).waitFor()
  await page.getByTitle('下一页', { exact: true }).click()
  await page.getByRole('button', { name: '其他模板 8', exact: true }).waitFor()
  assert.equal(lastPage, 2)
  await page.getByTitle('上一页', { exact: true }).click()
  await name.click()
  await page.getByRole('button', { name: '用户与语言设置' }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.getByRole('region', { name: 'Template reader' }).getByRole('button', { name: 'Edit' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit prompt' })
  await edit.waitFor()
  const desktopDrawer = await edit.boundingBox()
  assert.equal(Math.round(desktopDrawer.width), 720)
  assert.equal(Math.round(desktopDrawer.x + desktopDrawer.width), 1366)
  const desktopCategory = await edit.getByRole('combobox', { name: 'Template category' }).boundingBox()
  const desktopName = await edit.getByRole('textbox', { name: 'Template name' }).boundingBox()
  assert.ok(Math.abs(desktopCategory.y - desktopName.y) <= 3 && desktopCategory.x < desktopName.x)
  await edit.getByRole('textbox', { name: 'Preview text' }).fill('编辑后的简介')
  await edit.getByRole('textbox', { name: 'Template content' }).fill('')
  await edit.getByRole('button', { name: 'Save', exact: true }).click()
  await edit.getByText('Enter template content', { exact: true }).waitFor()
  await edit.getByRole('textbox', { name: 'Template content' }).fill('中文 · English {{scene}}')
  await edit.getByRole('switch').click()
  await edit.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Set another template in this category as the default first.', { exact: true }).waitFor()
  assert.equal(await edit.getByRole('textbox', { name: 'Preview text' }).inputValue(), '编辑后的简介')
  saveFails = false
  await edit.getByRole('switch').click()
  await edit.getByRole('button', { name: 'Save' }).click()
  await edit.waitFor({ state: 'hidden' })
  assert.equal(template.content, '中文 · English {{scene}}')
  await page.getByRole('button', { name: 'User and language settings' }).click()
  await page.getByRole('menuitem', { name: '简体中文', exact: true }).click()
  await reader.getByText('中文 · English {{scene}}', { exact: true }).waitFor()
  await reader.getByText('编辑后的简介', { exact: true }).waitFor()
  await page.getByRole('button', { name: system.name, exact: true }).click()
  assert.equal(await reader.getByRole('button', { name: /编\s*辑|删\s*除/ }).count(), 0)
  await reader.getByText('系统预置', { exact: true }).waitFor()
  await reader.getByRole('button', { name: '恢复默认', exact: true }).click()
  const restore = page.getByRole('dialog').filter({ hasText: '恢复系统默认模板' })
  await restore.getByText(/系统模板/).waitFor()
  assert.equal(patches, 2, '确认前不能提交恢复默认')
  await restore.getByRole('button', { name: '恢复默认', exact: true }).click()
  await page.getByText('恢复系统默认模板失败', { exact: true }).waitFor()
  assert.equal(await restore.isVisible(), true)
  restoreFails = false
  await restore.getByRole('button', { name: '恢复默认', exact: true }).click()
  await restore.waitFor({ state: 'hidden' })
  await reader.getByText('默认提示词', { exact: true }).waitFor()
  await name.click()
  assert.equal(await reader.getByText('默认提示词', { exact: true }).count(), 0)
  await reader.getByRole('button', { name: /删\s*除/ }).click()
  const remove = page.getByRole('dialog').filter({ hasText: '删除提示词' })
  await remove.getByText(/确定删除「创作模板」/).waitFor()
  await remove.getByRole('button', { name: /取\s*消/ }).click()
  assert.equal(deletes, 0)
  await remove.waitFor({ state: 'hidden' })
  await page.getByText('已恢复系统默认模板', { exact: true }).waitFor({ state: 'hidden' })
  for (const width of [1440, 1366, 1024, 1023, 768, 767, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
    await page.getByRole('button', { name: '用户与语言设置' }).click()
    await page.getByRole('menuitemradio', { name: '雾蓝纯色', exact: true }).click()
    await page.getByRole('menu').waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const create = page.getByRole('button', { name: '添加提示词', exact: true })
    assert.equal(await create.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(36, 95, 197)')
    const title = page.getByRole('heading', { name: '提示词模板', exact: true })
    assert.equal(await title.evaluate(element => getComputedStyle(element).fontSize), '16px')
    if (width === 375 || width === 1366) await page.screenshot({ path: `${output}/solid-${width}.png` })
    await page.getByRole('button', { name: '用户与语言设置' }).click()
    await page.getByRole('menuitemradio', { name: '雾蓝微渐变', exact: true }).click()
    await page.getByRole('menu').waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await name.press('Enter')
  const mobileReader = page.getByRole('dialog').filter({ hasText: '模板阅读' })
  await mobileReader.getByRole('button', { name: /编\s*辑/ }).click()
  const mobileEdit = page.getByRole('dialog', { name: '编辑提示词' })
  await mobileEdit.waitFor()
  await mobileReader.waitFor({ state: 'hidden' })
  const mobileDrawer = await mobileEdit.boundingBox()
  assert.equal(Math.round(mobileDrawer.width), 390)
  assert.equal(await mobileEdit.locator('.ant-drawer-body').evaluate(body => body.scrollWidth > body.clientWidth), false)
  const templateName = mobileEdit.getByRole('textbox', { name: '模板名称' })
  assert.equal(await templateName.inputValue(), template.name)
  const mobileCategory = await mobileEdit.getByRole('combobox', { name: '模板类别' }).boundingBox()
  assert.ok((await templateName.boundingBox()).y > mobileCategory.y)
  const mobileSave = await mobileEdit.getByRole('button', { name: /保\s*存/ }).boundingBox()
  assert.ok(mobileSave.y >= 0 && mobileSave.y + mobileSave.height <= 844)
  await templateName.fill('未保存的模板名称')
  await mobileEdit.getByRole('button', { name: '返回' }).click()
  const discard = page.getByRole('dialog', { name: '放弃未保存的修改？' })
  await discard.getByRole('button', { name: '继续编辑' }).click()
  assert.equal(await templateName.inputValue(), '未保存的模板名称')
  await mobileEdit.getByRole('button', { name: '返回' }).press('Escape')
  await discard.getByRole('button', { name: '放弃修改' }).click()
  await mobileEdit.waitFor({ state: 'hidden' })
  await mobileReader.getByRole('heading', { name: template.name }).waitFor()
  const mobileEditTrigger = mobileReader.getByRole('button', { name: /编\s*辑/ })
  await mobileEditTrigger.and(page.locator(':focus')).waitFor()
  await mobileEditTrigger.click()
  await templateName.fill('已还原的模板名称')
  await templateName.fill(template.name)
  await mobileEdit.getByRole('button', { name: '返回' }).click()
  await mobileEdit.waitFor({ state: 'hidden' })
  await mobileEditTrigger.and(page.locator(':focus')).waitFor()
  await mobileReader.getByRole('button', { name: /Close|关闭/ }).click()
  await mobileReader.waitFor({ state: 'hidden' })
  await name.and(page.locator(':focus')).waitFor()
  await page.setViewportSize({ width: 1440, height: 900 })
  await name.click()
  await reader.getByRole('button', { name: /删\s*除/ }).click()
  listFails = true
  await remove.getByRole('button', { name: /删\s*除/ }).click()
  await page.getByText('刷新模板失败，已保留当前内容', { exact: true }).waitFor()
  assert.equal(await name.count(), 0, '已确认删除的模板不能因刷新失败恢复到可操作列表')
  listFails = false
  allTemplates.length = 0
  await page.getByRole('button', { name: '刷新模板', exact: true }).click()
  await page.getByText('暂无提示词模板', { exact: true }).waitFor()
  await page.getByText('共 0 项', { exact: true }).waitFor()
  await page.setViewportSize({ width: 1366, height: 768 })
  const create = page.getByRole('button', { name: '添加提示词', exact: true })
  await create.click()
  const newEditor = page.getByRole('dialog', { name: '添加提示词', exact: true })
  const newName = newEditor.getByRole('textbox', { name: '模板名称' })
  await newName.fill('新建模板')
  await newEditor.getByRole('textbox', { name: '模板内容' }).fill('镜头使用 {{scene}}')
  const category = newEditor.getByRole('combobox', { name: '模板类别' })
  await category.press('ArrowDown')
  await category.and(page.locator('[aria-expanded="true"]')).waitFor()
  await category.press('Escape')
  await category.and(page.locator('[aria-expanded="false"]')).waitFor()
  assert.equal(await newEditor.isVisible(), true)
  await page.mouse.click(4, 4)
  await discard.getByRole('button', { name: '继续编辑' }).click()
  const summary = newEditor.getByText('变量设置', { exact: true })
  await summary.click()
  const variables = newEditor.getByRole('combobox', { name: '变量（回车添加）' })
  await variables.fill('scene')
  await variables.press('Enter')
  const defaults = newEditor.getByRole('textbox', { name: '变量默认值（JSON 对象）' })
  await defaults.fill('[]')
  await summary.click()
  const submitCreate = newEditor.getByRole('button', { name: /^创\s*建$/ })
  await submitCreate.click()
  await newEditor.getByText('变量默认值必须是 JSON 对象', { exact: true }).waitFor()
  await defaults.and(page.locator(':focus')).waitFor()
  await defaults.fill('{"scene":"外景"}')
  await submitCreate.click()
  await newEditor.waitFor({ state: 'hidden' })
  await create.and(page.locator(':focus')).waitFor()
  await page.getByRole('button', { name: '新建模板', exact: true }).waitFor()
  console.log('Prompt reading, data recovery, pagination, protected actions and responsive themes passed')
} finally { await cleanup() }
