import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-provider-management-')
const port = 4791
const origin = `http://127.0.0.1:${port}`
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
const provider = {
  id: 'provider1',
  name: '验收供应商',
  base_url: 'https://example.invalid/v1',
  description: '完整供应商描述',
  created_by: '验收用户',
  status: 'active',
}
let browser
let listFails = false
let saveFails = true
let credentialsReads = 0
let deleteRequests = 0
let lastSearch = ''
let providerExists = true
const cleanup = browserCleanup(() => ({ browser, server }))

try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(6000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url())
    const method = route.request().method()
    const respond = data => route.fulfill({ json: { code: 200, data } })
    if (pathname.endsWith('/providers')) {
      lastSearch = searchParams.get('q') ?? ''
      if (listFails) return route.fulfill({ status: 500, json: { message: '读取失败' } })
      const items = providerExists && (!lastSearch || provider.name.includes(lastSearch)) ? [provider] : []
      return respond({ items, pagination: { total: items.length, page: 1, page_size: 20, max_page: 1 } })
    }
    if (pathname.endsWith('/providers/provider1/credentials')) {
      credentialsReads += 1
      return respond({ api_key: 'isolated-key', api_secret: 'isolated-secret' })
    }
    if (pathname.endsWith('/providers/provider1') && method === 'PATCH') {
      const body = route.request().postDataJSON()
      assert.equal(body.description, '更新的供应商描述')
      if (saveFails) return route.fulfill({ status: 500, json: { message: '保存失败' } })
      provider.description = body.description
      return respond(provider)
    }
    if (pathname.endsWith('/providers/provider1') && method === 'DELETE') {
      deleteRequests += 1
      providerExists = false
      return respond(null)
    }
    if (pathname.endsWith('/models')) return respond({ items: [], pagination: { total: 2 } })
    if (pathname.endsWith('/supported')) return respond([])
    return respond({ items: [], next_cursor: null })
  })

  page.on('pageerror', error => console.error(error.message))
  page.on('requestfailed', request => console.error(request.url(), request.failure()))
  await page.goto(origin + '/models')
  const create = page.getByRole('button', { name: /添加供应商$/ })
  await create.waitFor().catch(async error => {
    console.error(await page.locator('body').innerText())
    throw error
  })
  assert.equal(await create.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(36, 95, 197)')
  await page.getByRole('columnheader', { name: '凭据配置状态' }).waitFor()
  const name = page.getByRole('button', { name: provider.name, exact: true })
  await name.focus()
  await page.keyboard.press('Enter')
  const details = page.getByRole('dialog').filter({ hasText: '供应商详情' })
  await details.getByText(provider.description).waitFor()
  await details.getByText(provider.base_url, { exact: true }).waitFor()
  await details.screenshot({ animations: 'disabled' })
  await details.getByRole('button', { name: 'Close' }).focus()
  await page.keyboard.press('Escape')
  await details.waitFor({ state: 'hidden' })
  await name.and(page.locator(':focus')).waitFor()
  assert.equal(credentialsReads, 0, '只读详情不得请求真实凭据')
  assert.equal(await page.getByRole('button', { name: /测试.*暂未接入/ }).isDisabled(), true)

  await page.getByRole('button', { name: `编辑 ${provider.name}`, exact: true }).click()
  const edit = page.getByRole('dialog', { name: '编辑供应商' })
  const description = edit.getByRole('textbox', { name: '描述', exact: true })
  await description.fill('更新的供应商描述')
  const save = edit.getByRole('button', { name: /确\s*定/ })
  await save.click()
  await page.getByText('保存供应商失败，请重试').waitFor()
  assert.equal(await description.inputValue(), '更新的供应商描述')
  assert.equal(credentialsReads, 1)
  saveFails = false
  await save.click()
  await edit.waitFor({ state: 'hidden' })

  const search = page.getByRole('textbox', { name: '搜索供应商' })
  listFails = true
  await search.fill('验收')
  await page.getByText('刷新供应商失败，仍显示上次结果').waitFor()
  await name.waitFor()
  assert.equal(await search.inputValue(), '验收')
  listFails = false
  await Promise.all([
    page.waitForResponse(response => response.ok() && new URL(response.url()).searchParams.get('q') === '验收'),
    page.getByRole('button', { name: /重\s*试/ }).click(),
  ])
  await page.getByText('刷新供应商失败，仍显示上次结果').waitFor({ state: 'hidden' })
  assert.equal(lastSearch, '验收')
  await search.fill('没有结果')
  await page.getByText('无匹配结果').waitFor()
  await page.getByRole('button', { name: '清除搜索' }).click()
  await name.waitFor()
  await page.getByText('供应商已更新').waitFor({ state: 'hidden' })

  for (const appearance of ['gradient', 'solid']) {
    for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768], [1023, 768], [375, 812]]) {
      await page.setViewportSize({ width, height })
      await page.screenshot({
        path: width === 1440 || width === 375 ? output + `/providers-${appearance}-${width}.png` : undefined,
        animations: 'disabled',
      })
      assert.equal(await create.evaluate(el => Math.round(el.getBoundingClientRect().height)), width < 1024 ? 36 : 32)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    }
    if (appearance === 'gradient') {
      await page.getByRole('button', { name: '用户与语言设置' }).click()
      await page.getByRole('menuitemradio', { name: /雾蓝纯色/ }).click()
      assert.equal(await create.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(36, 95, 197)')
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: `${provider.name}的更多操作` }).click()
  await page.getByRole('menuitem', { name: /删除/ }).click()
  const confirmation = page.getByRole('dialog').filter({ hasText: `删除供应商「${provider.name}」？` })
  await confirmation.getByText(/关联 2 个模型/).waitFor()
  await confirmation.getByRole('button', { name: /取\s*消/ }).click()
  await confirmation.waitFor({ state: 'hidden' })
  assert.equal(deleteRequests, 0)
  await page.getByRole('button', { name: `${provider.name}的更多操作` }).click()
  await page.getByRole('menuitem', { name: /删除/ }).click()
  listFails = true
  await confirmation.getByRole('button', { name: /删\s*除/ }).click()
  await page.getByText('刷新供应商失败，仍显示上次结果').waitFor()
  assert.equal(await name.count(), 0, '已确认删除的供应商不能因刷新失败恢复到可操作列表')
  listFails = false
  await page.getByRole('button', { name: /重\s*试/ }).click()
  await page.getByText('暂无供应商').waitFor()
  assert.equal(deleteRequests, 1)

  listFails = true
  await page.reload()
  await page.getByText('加载供应商失败', { exact: true }).waitFor()
  assert.equal(await page.getByText('暂无供应商', { exact: true }).count(), 0)
  assert.equal(await page.getByText('共 0 个供应商').count(), 0)
  console.log('供应商管理：主题、视口、详情焦点、编辑重试、删除及数据状态通过。')
} finally {
  await cleanup()
}
