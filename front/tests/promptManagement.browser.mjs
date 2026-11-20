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
  variables: ['subject'], variable_defaults: { subject: '主角' }, version: 1,
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
const system = { ...template, id: 'system', name: '系统模板', is_system: true, is_default: false }
const lateMatch = { ...template, id: 'late-match', name: '后续页模板', preview: '只在后续页简介出现的关键字' }
const allTemplates = [template, system, ...Array.from({ length: 10 }, (_, i) => ({ ...template, id: `extra-${i}`, name: i === 9 ? '长模板名称'.repeat(18) : `其他模板 ${i}`, category: 'bgm' })), ...Array.from({ length: 88 }, (_, i) => ({ ...template, id: `more-${i}`, name: `补充模板 ${i}` })), lateMatch]
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(6000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url())
    const respond = data => route.fulfill({ json: { code: 200, data } })
    if (pathname.endsWith('/prompts/categories')) return respond([{ value: 'video_prompt', label: '视频提示词' }])
    if (pathname.endsWith('/prompts')) {
      lastQuery = searchParams.get('q') ?? ''
      lastPage = Number(searchParams.get('page') || 1)
      if (listFails) return route.fulfill({ status: 500, json: { message: '读取失败' } })
      const size = Number(searchParams.get('page_size') || 10)
      listRequests.push({ page: lastPage, size, q: lastQuery })
      const matches = allTemplates.filter(item => !lastQuery || item.name.includes(lastQuery))
      return respond({ items: matches.slice((lastPage - 1) * size, lastPage * size), pagination: { total: matches.length, page: lastPage, page_size: size, max_page: Math.ceil(matches.length / size) } })
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
  await page.getByText('选择模板阅读正文', { exact: true }).waitFor()
  const name = page.getByRole('button', { name: template.name, exact: true })
  await name.press('Enter')
  const reader = page.getByRole('region', { name: '模板阅读' })
  await reader.getByRole('heading', { name: template.name }).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0)
  const content = reader.getByText(template.content, { exact: true })
  assert((await content.boundingBox()).height > 400, '正文应自然展开而非矮小预览框')
  assert(await reader.evaluate(element => element.scrollHeight > element.clientHeight), '长正文由阅读区域滚动')
  const list = page.getByRole('region', { name: '模板列表' })
  assert.equal(Math.round((await list.boundingBox()).width), 300)
  await page.screenshot({ path: `${output}/desktop.png` })
  await page.setViewportSize({ width: 375, height: 812 })
  await reader.waitFor({ state: 'hidden' })
  await name.press('Enter')
  const drawer = page.getByRole('dialog').filter({ hasText: '模板阅读' })
  await drawer.getByRole('heading', { name: template.name }).waitFor()
  await assertDetailDrawerLayout(drawer)
  await drawer.getByRole('button', { name: /Close|关闭/ }).press('Escape')
  await drawer.waitFor({ state: 'hidden' })
  await name.and(page.locator(':focus')).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.setViewportSize({ width: 1440, height: 900 })
  const search = page.getByRole('textbox', { name: '搜索模板名称或简介' })
  assert.ok(listRequests.every(request => request.page === 1 && request.size === 10), '普通浏览只读取当前页')
  await search.fill('后续页简介')
  await search.press('Enter')
  await page.getByRole('button', { name: lateMatch.name, exact: true }).waitFor()
  await page.getByText('共 1 项', { exact: true }).waitFor()
  assert.ok(listRequests.some(request => request.page === 2 && request.size === 100 && !request.q))
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
  assert.equal(lastQuery, '', '不能把简介查询发送给只匹配名称的后端 q')
  await search.fill('正文不会参与搜索')
  await search.press('Enter')
  await page.getByText('没有匹配的模板', { exact: true }).waitFor()
  await page.getByRole('button', { name: '清除搜索' }).click()
  await name.waitFor()
  listFails = true
  await page.reload()
  await page.getByText('无法读取模板列表', { exact: true }).waitFor()
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
  await reader.getByRole('button', { name: /编\s*辑/ }).click()
  const edit = page.getByRole('dialog', { name: '编辑提示词' })
  await edit.getByRole('textbox', { name: '预览文案' }).fill('编辑后的简介')
  await edit.getByRole('switch').click()
  await edit.getByRole('button', { name: /保\s*存/ }).click()
  await page.getByText('请先将同类别的其他模板设为默认', { exact: true }).waitFor()
  assert.equal(await edit.getByRole('textbox', { name: '预览文案' }).inputValue(), '编辑后的简介')
  saveFails = false
  await edit.getByRole('switch').click()
  await edit.getByRole('button', { name: /保\s*存/ }).click()
  await edit.waitFor({ state: 'hidden' })
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
  await name.press('Enter')
  const mobileReader = page.getByRole('dialog').filter({ hasText: '模板阅读' })
  await mobileReader.getByRole('button', { name: /编\s*辑/ }).click()
  await edit.waitFor()
  await edit.getByRole('button', { name: /取\s*消/ }).click()
  await edit.waitFor({ state: 'hidden' })
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
  console.log('Prompt reading, data recovery, pagination, protected actions and responsive themes passed')
} finally { await cleanup() }
