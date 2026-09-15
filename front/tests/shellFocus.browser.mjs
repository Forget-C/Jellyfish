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
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ locale: 'zh-CN' })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', route => route.fulfill({ json: { success: true, data: { items: [], next_cursor: null } } }))
  const measurements = []
  for (const width of [1586, 375]) {
    await page.setViewportSize({ width, height: 812 })
    await page.goto('http://127.0.0.1:4185/settings')
    if (width === 375) {
      const trigger = page.getByRole('button', { name: '打开主导航' })
      await trigger.focus()
      await page.keyboard.press('Enter')
    }
    await page.waitForTimeout(400)
    const navigation = page.getByRole('navigation', { name: width === 375 ? '移动主导航' : '主导航', exact: true })
    const link = navigation.getByRole('link', { name: '资产管理', exact: true })
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
    if (width === 375) {
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      assert.equal(await page.getByRole('button', { name: '打开主导航' }).getAttribute('aria-expanded'), 'false')
    }
  }
  await writeFile(`${output}/focus.json`, JSON.stringify(measurements, null, 2))
  console.log(JSON.stringify({ output, measurements }))
} finally {
  await browser?.close()
  await server.close()
}
