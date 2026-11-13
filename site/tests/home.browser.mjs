// Run with Hugo serving the current checkout: node site/tests/home.browser.mjs.
// Reuse the repository's front Playwright installation and PLAYWRIGHT_CHANNEL.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(new URL('../../front/package.json', import.meta.url))('playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
const baseURL = process.env.SITE_BASE_URL || 'http://127.0.0.1:1313/'
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    assert.deepEqual(errors, [], 'Homepage scripts must initialize without errors')
    const sidebar = page.locator('.hextra-sidebar-container')
    const menu = page.locator('.hextra-hamburger-menu')
    if (width < 768) {
      assert.equal(await sidebar.getAttribute('aria-hidden'), 'true')
      await menu.click()
      assert.equal(await menu.getAttribute('aria-expanded'), 'true')
      assert.equal(await sidebar.getAttribute('aria-hidden'), 'false')
      const docs = sidebar.getByRole('link', { name: '文档', exact: true })
      assert.equal(await docs.count(), 1)
      await page.keyboard.press('Escape')
      assert.equal(await menu.getAttribute('aria-expanded'), 'false')
      assert.equal(await sidebar.getAttribute('aria-hidden'), 'true')
    } else {
      assert.equal(await sidebar.isVisible(), false)
    }
    const controls = page.locator('.jf-preview-button')
    await controls.nth(1).focus()
    await page.keyboard.press('Enter')
    assert.equal(await controls.nth(1).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('[data-preview]:visible').count(), 1)
    assert.equal(await page.locator('[aria-label="广告预留位"]').count(), 1)
    assert.equal(await page.locator('[aria-label="赞助预留位"]').count(), 1)
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    }
    console.log(`Homepage scripts, navigation, placements and layout passed: ${width}px`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
