import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-runtime-settings-')
const origin = 'http://127.0.0.1:4632'
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4632, strictPort: true, open: false } })
let settings = { id: 1, api_timeout: 60, log_level: 'info', default_text_model_id: 'text-model' }
let browser
let loadFails = true
let saveFails = true
let saveCount = 0
let submitted
let finishSave
let holdSave = false
const cleanup = browserCleanup(() => ({ browser, server }))

try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url())
    const respond = data => route.fulfill({ json: { code: 200, data } })
    if (pathname.endsWith('/model-settings')) {
      if (route.request().method() === 'PUT') {
        saveCount += 1
        submitted = route.request().postDataJSON()
        if (holdSave) await new Promise(resolve => { finishSave = resolve })
        if (saveFails) return route.fulfill({ status: 500, json: { message: '测试保存失败' } })
        settings = { ...settings, ...submitted }
      } else if (loadFails) {
        return route.fulfill({ status: 500, json: { message: '测试读取失败' } })
      }
      return respond(settings)
    }
    if (pathname.endsWith('/supported')) return respond([])
    return respond({ items: [], pagination: { total: 0 }, next_cursor: null })
  })

  await page.goto(origin + '/models')
  await page.getByRole('tab', { name: '运行设置', exact: true }).click()
  await page.getByRole('alert').getByText('读取运行设置失败').waitFor()
  assert.equal(await page.getByRole('button', { name: '保存设置' }).count(), 0)
  loadFails = false
  await page.getByRole('button', { name: /重\s*试/ }).click()
  const timeout = page.getByRole('spinbutton', { name: 'API 超时（秒）' })
  await timeout.waitFor()
  assert.equal(await timeout.inputValue(), '60')
  const section = page.getByRole('region', { name: '模型运行设置' })
  const logLevel = section.getByRole('combobox', { name: '日志级别' })
  const selectedWarn = section.getByTitle('Warn', { exact: true })
  const save = section.getByRole('button', { name: /保存设置/ })
  await timeout.focus()
  await page.keyboard.press('Tab')
  await logLevel.and(page.locator(':focus')).waitFor()
  await page.keyboard.press('Tab')
  await save.and(page.locator(':focus')).waitFor()

  await timeout.fill('')
  await save.click()
  await section.getByText('请输入 5 至 300 之间的整数秒数').waitFor()
  assert.equal(saveCount, 0)

  await timeout.fill('120')
  await logLevel.press('Enter')
  await page.getByText('Warn', { exact: true }).filter({ visible: true }).click()
  await selectedWarn.waitFor()
  await save.click()
  await section.getByRole('alert').getByText(/输入已保留/).waitFor()
  assert.equal(await timeout.inputValue(), '120')
  assert.equal(await selectedWarn.isVisible(), true)
  assert.deepEqual(submitted, { api_timeout: 120, log_level: 'warn' })

  saveFails = false
  holdSave = true
  const request = page.waitForRequest(r => r.url().endsWith('/model-settings') && r.method() === 'PUT')
  await save.click()
  await request
  assert.equal(await save.isDisabled(), true)
  assert.equal(await timeout.isDisabled(), true)
  await page.keyboard.press('Enter')
  assert.equal(saveCount, 2)
  finishSave()
  await section.getByRole('status').getByText('设置已保存').waitFor()
  assert.equal(settings.default_text_model_id, 'text-model')
  assert.deepEqual(submitted, { api_timeout: 120, log_level: 'warn' })

  for (const appearance of ['gradient', 'solid']) {
    for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768], [1023, 768], [375, 812]]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.screenshot({
        path: width === 1440 || width === 375 ? output + `/runtime-settings-${appearance}-${width}.png` : undefined,
        animations: 'disabled',
      })
      const bounds = await section.boundingBox()
      assert.ok(bounds.width <= 640 && bounds.x + bounds.width <= width)
      assert.equal(Math.round((await save.boundingBox()).height), 36)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    }
    if (appearance === 'gradient') {
      await page.getByRole('button', { name: '用户与语言设置' }).click()
      await page.getByRole('menuitemradio', { name: /雾蓝纯色/ }).click()
    }
  }

  await section.getByRole('button', { name: '前往模型页' }).press('Enter')
  const model = page.getByRole('tab', { name: '模型', exact: true })
  await model.and(page.locator('[aria-selected="true"]:focus')).waitFor()
  await page.getByRole('button', { name: /默认模型/ }).waitFor()

  settings = { id: 1 }
  await page.getByRole('tab', { name: '运行设置', exact: true }).click()
  await timeout.waitFor()
  assert.equal(await timeout.inputValue(), '')
  await section.getByText('未知，请选择').waitFor()
  await save.click()
  await section.getByText('请选择日志级别').waitFor()
  assert.equal(saveCount, 2)
  console.log('运行设置：读取失败重试、输入校验、保存防重、默认模型跳转及主题视口通过。')
} finally {
  await cleanup()
}
