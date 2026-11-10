import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-management-navigation-')
const origin = 'http://127.0.0.1:4196'
const sections = [
  ['模型管理', '/models'], ['资产库', '/assets'], ['提示词模板', '/prompts'],
  ['文件管理', '/files'], ['Agent 管理', '/agents'],
]
const list = items => ({
  items, total: items.length, page: 1, page_size: 100,
  pagination: { total: items.length, page: 1, page_size: 100, total_pages: 1 },
})
const agent = { id: 'agent1', name: '验收 Agent', type: 'plot', description: '', createdBy: '验收', enabled: true, version: '1.0' }
const model = { id: 'model1', name: '验收文本模型', category: 'text', provider_id: 'provider1', params: {} }
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4196, strictPort: true, open: false } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url())
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (pathname === '/api/agents') return route.fulfill({ json: [agent] })
    if (pathname === '/api/agents/agent1') return route.fulfill({ json: agent })
    if (pathname === '/api/files') return route.fulfill({ json: [] })
    if (pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (pathname.endsWith('/models')) return respond(list(new URL(route.request().url()).searchParams.get('category') === 'image' ? [] : [model]))
    if (pathname.endsWith('/providers')) return respond(list([{ id: 'provider1', name: '验收供应商', base_url: 'https://example.invalid', status: 'active' }]))
    if (pathname.endsWith('/entities/actor/a1')) return respond({ id: 'a1', name: '验收演员', description: '测试档案', tags: [] })
    if (pathname.endsWith('/model-settings')) return respond({ id: 1, api_timeout: 60, log_level: 'INFO' })
    if (/\/(styles|assets|batches|categories|supported)$/.test(pathname)) return respond([])
    return respond(list([]))
  })

  await page.goto(origin)
  const primary = page.getByRole('navigation', { name: '主导航', exact: true })
  const enterManagement = primary.getByRole('link', { name: '管理', exact: true })
  await enterManagement.click()
  await page.waitForURL(origin + '/models')
  const secondary = page.getByRole('navigation', { name: '管理导航', exact: true })
  await secondary.getByRole('link', { name: '模型管理', exact: true }).waitFor()
  assert.deepEqual(await secondary.getByRole('link').allTextContents(), sections.map(([name]) => name))
  for (const [name, path] of sections) {
    const link = secondary.getByRole('link', { name, exact: true })
    await link.click()
    await page.waitForURL(url => url.pathname === path)
    assert.equal(await link.getAttribute('aria-current'), 'page')
    assert.equal(await enterManagement.getAttribute('aria-current'), 'page')
  }
  await page.goto(origin + '/assets/actors/a1/edit')
  const assets = secondary.getByRole('link', { name: '资产库', exact: true })
  assert.equal(await assets.getAttribute('aria-current'), 'page')
  const assetName = page.getByRole('textbox', { name: '名称', exact: true })
  await assetName.waitFor()
  assert.equal(await assetName.inputValue(), '验收演员')

  await page.goto(origin + '/agents/agent1/edit')
  const agents = secondary.getByRole('link', { name: 'Agent 管理', exact: true })
  assert.equal(await agents.getAttribute('aria-current'), 'page')
  await page.getByRole('textbox').first().waitFor()
  await primary.getByRole('link', { name: '首页', exact: true }).click()
  await page.reload()
  await enterManagement.click()
  await page.waitForURL(origin + '/agents')
  await page.goBack()
  await page.waitForURL(origin + '/')
  await page.goForward()
  await page.waitForURL(origin + '/agents')
  assert.equal(await agents.getAttribute('aria-current'), 'page')
  await page.getByRole('cell', { name: '验收 Agent', exact: true }).waitFor()
  await page.getByRole('button', { name: '类型筛选', exact: true }).click()
  const agentFilters = page.getByRole('dialog').filter({ has: page.getByText('类型筛选', { exact: true }) })
  await agentFilters.getByText('角色提取 (0)', { exact: true }).click()
  await page.keyboard.press('Escape')
  await agentFilters.waitFor({ state: 'hidden' })
  await page.getByRole('cell', { name: '验收 Agent', exact: true }).waitFor({ state: 'hidden' })

  await secondary.getByRole('link', { name: '模型管理', exact: true }).click()
  await page.getByRole('tab', { name: '模型', exact: true }).click()
  await page.getByText('验收文本模型', { exact: true }).waitFor()
  await page.getByRole('button', { name: '筛选', exact: true }).click()
  const filters = page.getByRole('dialog').filter({ has: page.getByText('筛选', { exact: true }) })
  await filters.getByText('图片生成', { exact: true }).click()
  await page.keyboard.press('Escape')
  await filters.waitFor({ state: 'hidden' })
  await page.getByText('无匹配结果', { exact: true }).waitFor()
  await page.screenshot({ path: output + '/desktop-management.png', animations: 'disabled' })

  for (const width of [900, 375]) {
    await page.setViewportSize({ width, height: 812 })
    const trigger = page.getByRole('button', { name: '打开管理导航' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole('dialog').filter({ has: page.getByRole('navigation', { name: '管理导航', exact: true }) })
    await drawer.getByRole('link', { name: '资产库' }).waitFor()
    const selectedLink = drawer.getByRole('link').and(page.locator('[aria-current="page"]'))
    assert.equal(await selectedLink.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(228, 237, 251)')
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'hidden' })
    await trigger.and(page.locator(':focus')).waitFor()
    await trigger.click()
    await drawer.getByRole('link', { name: '资产库' }).click()
    await drawer.waitFor({ state: 'hidden' })
    await page.waitForURL(url => url.pathname === '/assets')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    await page.screenshot({ path: output + '/' + width + '-management.png', animations: 'disabled' })
  }
  console.log('Management navigation verified at 1440px, 900px and 375px.')
} finally {
  await cleanup()
}
