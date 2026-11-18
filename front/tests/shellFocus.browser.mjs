import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = process.env.SHELL_EVIDENCE_DIR || '/tmp/jellyfish-shell-focus'
await mkdir(output, { recursive: true })
process.chdir(root)
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4185, strictPort: true, open: false } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN' })
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith('/recent-canvases')
      ? [{ id: 'free', kind: 'free', name: '焦点验收画布', updated_at: '2026-11-10T10:30:00Z', cover_file_id: null, project_name: null }]
      : { items: [], next_cursor: null }
    return route.fulfill({ json: { code: 200, data } })
  })
  const measurements = []
  for (const width of [1440, 1024, 375]) {
    await page.setViewportSize({ width, height: 812 })
    await page.goto('http://127.0.0.1:4185/')
    const navigation = page.getByRole('navigation', { name: '主导航', exact: true })
    await navigation.getByRole('link', { name: '首页', exact: true }).waitFor()
    assert.deepEqual(await navigation.getByRole('link').allTextContents(), ['首页', '画布', '项目', '管理', '实验室'])
    assert.equal(await navigation.getByRole('link', { name: '首页', exact: true }).getAttribute('aria-current'), 'page')
    const canvas = page.getByRole('region', { name: '最近更新的画布' })
    await canvas.getByRole('heading', { name: '焦点验收画布', exact: true }).waitFor()
    assert.equal(await canvas.getByRole('link').count(), 0)
    const link = navigation.getByRole('link', { name: '项目', exact: true })
    await link.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    const measured = await link.evaluate(element => {
      const style = getComputedStyle(element)
      return { focused: document.activeElement === element, outline: style.outlineStyle, outlineWidth: style.outlineWidth }
    })
    assert.equal(measured.focused, true)
    assert.notEqual(measured.outline, 'none')
    measurements.push({ width, ...measured })
    await page.screenshot({ path: `${output}/${width}-navigation-focus.png`, animations: 'disabled' })
    await page.keyboard.press('Enter')
    await page.waitForURL('**/projects')
    await page.getByRole('link', { name: 'Jellyfish 首页' }).click()
    await page.waitForURL('http://127.0.0.1:4185/')
    await page.goBack()
    await page.waitForURL('**/projects')
    await page.reload()
    await navigation.getByRole('link', { name: '项目', exact: true }).waitFor()
    assert.equal(await navigation.getByRole('link', { name: '项目', exact: true }).getAttribute('aria-current'), 'page')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))

  }
  await writeFile(`${output}/focus.json`, JSON.stringify(measurements, null, 2))
  console.log(JSON.stringify({ output, measurements }))
} finally {
  await browser?.close()
  await server.close()
}
