import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-file-management-')
const origin = 'http://127.0.0.1:4796'
const server = await createServer({
  root,
  define: { 'import.meta.env.VITE_BACKEND_URL': JSON.stringify(origin) },
  server: { host: '127.0.0.1', port: 4796, strictPort: true, open: false },
})
const files = [
  { id: 'file1', name: '雨中对白', type: 'image', thumbnail: '/file-thumb.svg', tags: ['首帧', '城市夜景'] },
  { id: 'file2', name: '街道成片', type: 'video', thumbnail: '/missing-file.svg', tags: ['成片'] },
  ...Array.from({ length: 22 }, (_, i) => ({ id: `file-${i}`, name: `其他文件 ${i + 1}`, type: 'image', tags: [] })),
  { id: 'file-last', name: '后续页文件', type: 'audio', tags: ['后续页标签'] },
]
let browser
let holdPage = false
let releasePage
const heldPage = new Promise(resolve => { releasePage = resolve })
let listFails = true
let listResult = files
const fileRequests = []
const cleanup = browserCleanup(() => ({ browser, server }))

try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/studio/files') {
      const page = Number(url.searchParams.get('page') || 1)
      const pageSize = Number(url.searchParams.get('page_size') || 10)
      const query = url.searchParams.get('q')
      fileRequests.push({ method: route.request().method(), page })
      if (listFails) return route.fulfill({ status: 500, json: { message: '测试读取失败' } })
      if (holdPage) await heldPage
      const matches = listResult.filter(file => !query || file.name.includes(query))
      return route.fulfill({ json: { code: 200, data: {
        items: matches.slice((page - 1) * pageSize, page * pageSize),
        pagination: { page, page_size: pageSize, total: matches.length, max_page: Math.ceil(matches.length / pageSize) },
      } } })
    }
    if (url.pathname === '/api/v1/studio/files/file1/download') {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>' })
    }
    return route.fulfill({ json: { code: 200, data: { items: [], next_cursor: null } } })
  })
  await page.route('**/file-thumb.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1366"><rect width="1024" height="1366" fill="#245fc5"/></svg>',
  }))
  await page.route('**/missing-file.svg', route => route.fulfill({ status: 404 }))

  await page.goto(origin + '/files')
  await page.getByRole('alert').getByText('读取文件失败').waitFor()
  assert.equal(await page.getByText('暂无文件', { exact: true }).count(), 0)
  listFails = false
  await page.getByRole('button', { name: /重\s*试/ }).click()
  await page.getByRole('heading', { name: '雨中对白' }).waitFor()
  assert.equal(await page.locator('.file-card-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 6, '宽屏六列')
  await page.getByText(/已加载 .*共 25/).waitFor()
  await page.getByText('已显示全部 25 个文件').waitFor()
  const imageCard = page.getByRole('article', { name: '雨中对白' })
  const videoCard = page.getByRole('article', { name: '街道成片' })
  await imageCard.getByRole('img', { name: '雨中对白缩略图' }).waitFor()
  await videoCard.getByText('暂无缩略图').waitFor()
  await videoCard.getByText('视频', { exact: true }).waitFor()
  await videoCard.getByText('时间未知').waitFor()
  assert.equal(await page.getByRole('checkbox').count(), 0)
  assert.equal(await page.getByRole('button', { name: /批量导出/ }).count(), 0)
  await imageCard.getByRole('button', { name: '预览雨中对白' }).press('Enter')
  const preview = page.getByRole('dialog', { name: '雨中对白 · 预览' })
  await preview.getByRole('img', { name: '雨中对白' }).waitFor()
  await preview.getByRole('button', { name: /Close|关闭/ }).click()
  await preview.waitFor({ state: 'hidden' })
  await imageCard.getByRole('button', { name: '预览雨中对白' }).and(page.locator(':focus')).waitFor()
  assert.equal(await page.getByRole('checkbox').count(), 0)

  const filter = page.getByRole('combobox', { name: '按标签筛选' })
  await filter.press('Enter')
  await page.getByText('成片', { exact: true }).last().click()
  await imageCard.waitFor({ state: 'hidden' })
  await videoCard.waitFor()
  const search = page.getByRole('textbox', { name: '搜索文件名或标签' })
  await search.fill('雨中')
  await search.press('Enter')
  await page.getByText('无匹配文件').waitFor()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await imageCard.waitFor()
  await videoCard.waitFor()
  assert.equal(await search.inputValue(), '')

  await search.fill('后续页标签')
  await search.press('Enter')
  await page.getByRole('heading', { name: '后续页文件' }).waitFor()
  await page.getByText('共 1 个文件', { exact: true }).waitFor()
  await search.fill('')
  await imageCard.waitFor()

  const batch = page.getByRole('button', { name: '批量管理', exact: true })
  await batch.press('Enter')
  const selectImage = imageCard.getByRole('checkbox', { name: '选择雨中对白' })
  await selectImage.press('Space')
  assert.equal(await selectImage.isChecked(), true)
  await page.getByRole('status').filter({ hasText: '已选 1 项' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /批量标记.*暂未接入/ }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: /批量导出.*暂未接入/ }).isDisabled(), true)
  await search.fill('成片')
  await search.press('Enter')
  await imageCard.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '批量管理', exact: true }).waitFor()
  assert.equal(await page.getByRole('checkbox').count(), 0)
  await batch.click()
  await page.getByRole('status').filter({ hasText: '已选 0 项' }).waitFor()
  await page.getByRole('button', { name: '退出批量管理' }).click()

  listFails = true
  await page.getByRole('button', { name: /刷\s*新/ }).click()
  await page.getByRole('alert').getByText('刷新文件失败，仍显示上次结果').waitFor()
  await videoCard.waitFor()
  assert.equal(await search.inputValue(), '成片')
  listFails = false
  await page.getByRole('button', { name: /重\s*试/ }).click()
  await page.getByRole('alert').waitFor({ state: 'hidden' })
  assert.equal(await search.inputValue(), '成片')
  await search.fill('')

  for (const appearance of ['gradient', 'solid']) {
    for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768], [1023, 768], [375, 812]]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.screenshot({
        path: width === 1440 || width === 375 ? output + `/file-management-${appearance}-${width}.png` : undefined,
        animations: 'disabled',
      })
      const imageBounds = await imageCard.boundingBox()
      const videoBounds = await videoCard.boundingBox()
      assert.ok(imageBounds.height < 300)
      assert.equal(imageBounds.height, videoBounds.height)
      if (width === 375) {
        assert.equal(imageBounds.x, videoBounds.x)
        assert.ok(videoBounds.y > imageBounds.y)
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    }
    if (appearance === 'gradient') {
      await page.getByRole('button', { name: '用户与语言设置' }).click()
      await page.getByRole('menuitemradio', { name: /雾蓝纯色/ }).click()
    }
  }

  listResult = Array.from({ length: 150 }, (_, i) => ({ id: `sparse${i}`, name: i === 130 ? '目标命中' : `普通${i}`, type: 'image', tags: [] }))
  const requestsBeforeSearch = fileRequests.length
  await search.fill('目标')
  await search.press('Enter')
  await page.getByText('已找到 0 项 · 已检查 96 项').waitFor()
  assert.equal(fileRequests.length - requestsBeforeSearch, 4, '每轮最多读取四页')
  await page.getByText('当前已检查范围内暂无匹配').waitFor()
  await page.getByRole('button', { name: '继续检索', exact: true }).click()
  await page.getByRole('heading', { name: '目标命中', exact: true }).waitFor()
  await page.getByText('共 1 个文件', { exact: true }).waitFor()
  await search.fill('')
  await page.getByRole('heading', { name: '普通0', exact: true }).waitFor()
  holdPage = true
  const startedOld = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/studio/files')
  await search.fill('旧筛选')
  await search.press('Enter')
  await startedOld
  const cancelled = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname === '/api/v1/studio/files' })
  holdPage = false
  await search.fill('目标')
  await search.press('Enter')
  await cancelled
  releasePage()
  await page.getByText('已找到 0 项 · 已检查 96 项').waitFor()
  await page.getByRole('button', { name: '继续检索', exact: true }).click()
  await page.getByRole('heading', { name: '目标命中', exact: true }).waitFor()
  await search.fill('')
  await page.getByRole('heading', { name: '普通0', exact: true }).waitFor()
  await page.getByRole('button', { name: '批量管理', exact: true }).click()
  await page.getByRole('button', { name: '选择已加载文件', exact: true }).click()
  const selectedBeforeRefresh = await page.getByRole('status').filter({ hasText: /^已选/ }).textContent()
  listFails = true
  await page.getByRole('button', { name: /刷\s*新/ }).click()
  await page.getByText('刷新文件失败，仍显示上次结果').waitFor()
  assert.equal(await page.getByRole('status').filter({ hasText: /^已选/ }).textContent(), selectedBeforeRefresh)
  listFails = false
  listResult = Array.from({ length: 96 }, (_, i) => ({ id: `refresh${i}`, name: i % 24 < 10 ? `匹配${i}` : `其他${i}`, type: 'image', tags: [] }))
  await search.fill('匹配')
  await search.press('Enter')
  await page.getByText('已找到 30 项 · 已检查 72 项').waitFor()
  await page.getByRole('button', { name: /刷\s*新/ }).click()
  await page.getByText('正在读取文件…', { exact: true }).waitFor({ state: 'hidden' })
  await page.getByText('已找到 30 项 · 已检查 72 项').waitFor()
  await page.getByRole('button', { name: '批量管理', exact: true }).waitFor()
  listResult = []
  await search.fill('')
  await page.getByText('暂无文件', { exact: true }).waitFor()
  await page.getByRole('button', { name: /刷\s*新/ }).click()
  await page.getByText('暂无文件', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '向下浏览文件', exact: true }).count(), 0, '空列表不显示箭头')
  assert.ok(fileRequests.length > 0 && fileRequests.every(request => request.method === 'GET'))
  console.log('文件管理：读取重试、筛选、独立批量选择、缺图、主题及视口通过。')
} finally {
  await cleanup()
}
