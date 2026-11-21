// Run against the site root or its deployment prefix using SITE_BASE_URL.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(new URL('../../front/package.json', import.meta.url))('playwright')
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL })
try {
  const url = new URL('docs/guide/sequence-workflow/', process.env.SITE_BASE_URL || 'http://127.0.0.1:1313/')
  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.goto(url.href)
    const article = page.locator('main#content .content')
    for (const label of ['确认生成面板', '分镜已就绪', '运行预检', '分镜画布全景', '候选画面']) {
      const original = article.getByRole('link', { name: new RegExp(label) })
      assert.equal(await original.count(), 1, label + ' has a full-size image link')
      const image = original.locator('img')
      await image.scrollIntoViewIfNeeded()
      assert.ok(await image.evaluate(async element => {
        await element.decode()
        return element.naturalWidth > 300 && element.getBoundingClientRect().width <= innerWidth
      }))
      assert.equal(new URL(await original.getAttribute('href'), page.url()).href, await image.evaluate(el => el.currentSrc))
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.close()
  }
} finally {
  await browser.close()
}
