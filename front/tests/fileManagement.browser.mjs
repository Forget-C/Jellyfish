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
  { id: 'file1', name: '雨中对白', type: 'image', thumbnail: '/file-thumb.svg', tags: ['首帧', '城市夜景'], createdAt: '2026-03-01 14:35' },
  { id: 'file2', name: '街道成片', type: 'video', thumbnail: '/missing-file.svg', tags: ['成片'] },
]
let browser
let listFails = true
let listResult = files
const fileRequests = []
const cleanup = browserCleanup(() => ({ browser, server }))

try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/files') {
      fileRequests.push(route.request().method())
      if (listFails) return route.fulfill({ status: 500, json: { message: '测试读取失败' } })
      return route.fulfill({ json: listResult })
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
  assert.equal(await page.getByText('已加载 2 个文件').count(), 1)
  const imageCard = page.getByRole('article', { name: '雨中对白' })
  const videoCard = page.getByRole('article', { name: '街道成片' })
  await imageCard.getByRole('img', { name: '雨中对白缩略图' }).waitFor()
  await videoCard.getByText('暂无缩略图').waitFor()
  await videoCard.getByText('视频', { exact: true }).waitFor()
  await videoCard.getByText('时间未知').waitFor()
  assert.equal(await page.getByRole('checkbox').count(), 0)
  assert.equal(await page.getByRole('button', { name: /批量导出/ }).count(), 0)
  await imageCard.getByRole('heading').click()
  assert.equal(await page.getByRole('checkbox').count(), 0)

  const filter = page.getByRole('combobox', { name: '按标签筛选' })
  await filter.press('Enter')
  await page.getByText('成片', { exact: true }).last().click()
  await imageCard.waitFor({ state: 'hidden' })
  await videoCard.waitFor()
  const search = page.getByRole('textbox', { name: '搜索文件' })
  await search.fill('雨中')
  await page.getByText('无匹配文件').waitFor()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await imageCard.waitFor()
  await videoCard.waitFor()
  assert.equal(await search.inputValue(), '')

  const batch = page.getByRole('button', { name: '批量管理', exact: true })
  await batch.press('Enter')
  const selectImage = imageCard.getByRole('checkbox', { name: '选择雨中对白' })
  await selectImage.press('Space')
  assert.equal(await selectImage.isChecked(), true)
  await page.getByRole('status').filter({ hasText: '已选 1 项' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /批量标记.*暂未接入/ }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: /批量导出.*暂未接入/ }).isDisabled(), true)
  await search.fill('成片')
  await imageCard.waitFor({ state: 'hidden' })
  await page.getByText(/已选 1 项.*1 项不在当前筛选/).waitFor()
  await page.getByRole('button', { name: '退出批量管理' }).click()
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

  listResult = []
  await page.getByRole('button', { name: /刷\s*新/ }).click()
  await page.getByText('暂无文件', { exact: true }).waitFor()
  assert.ok(fileRequests.length > 0 && fileRequests.every(method => method === 'GET'))
  console.log('文件管理：读取重试、筛选、独立批量选择、缺图、主题及视口通过。')
} finally {
  await cleanup()
}
