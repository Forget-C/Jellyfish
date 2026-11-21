// Run with the current checkout served at SITE_BASE_URL, like home.browser.mjs.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = createRequire(new URL('../../front/package.json', import.meta.url))('playwright')
const site = fileURLToPath(new URL('../', import.meta.url))
const base = process.env.SITE_BASE_URL || 'http://localhost:1313/'
const temp = mkdtempSync(join(tmpdir(), 'jellyfish-placements-'))
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL })
try {
  for (const path of ['data', 'layouts', 'assets', 'content', 'hugo.yaml', 'go.mod', 'go.sum']) {
    cpSync(join(site, path), join(temp, path), { recursive: true })
  }
  const scenarios = [
    { sponsors: [{ name: '演示赞助方', url: 'product/', logo: 'images/logo.svg' }, { name: '独立创作者' }], contact: 'docs/', ad: { title: '演示广告', url: 'product/' } },
    { contact: 'docs/' }, { ad: { title: '演示广告', url: 'product/' } }, {}
  ]
  for (const placements of scenarios) {
    writeFileSync(join(temp, 'data/placements.yaml'), JSON.stringify(placements))
    execFileSync('hugo', ['--source', temp, '--baseURL', base, '--destination', join(temp, 'public')])
    const html = readFileSync(join(temp, 'public/index.html'), 'utf8')
    for (const width of [1440, 375, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      await page.route(base, route => route.fulfill({ contentType: 'text/html', body: html }))
      await page.goto(base)
      const home = page.locator('main')
      const sponsor = home.getByRole('region', { name: '项目赞助' })
      assert.equal(await sponsor.count(), Number(Boolean(placements.sponsors || placements.contact)))
      assert.equal(await home.getByRole('region', { name: '广告', exact: true }).count(), Number(Boolean(placements.ad)))
      if (placements.sponsors) {
        await sponsor.scrollIntoViewIfNeeded()
        await sponsor.locator('img').evaluate(el => el.decode())
        assert.ok(await sponsor.getByText('独立创作者').isVisible())
      }
      const target = placements.sponsors ? '演示赞助方' : placements.contact ? '联系赞助' : placements.ad ? '演示广告' : ''
      assert.equal(await home.getByRole('link', { name: '联系赞助' }).count(), Number(Boolean(placements.contact && !placements.sponsors)))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      if (target) {
        await home.getByRole('link', { name: target, exact: true }).click()
        assert.equal(new URL(page.url()).pathname, new URL(target === '联系赞助' ? 'docs/' : 'product/', base).pathname)
      } else {
        assert.ok(await home.locator('.sea-more + footer').count())
      }
      await page.close()
    }
  }
} finally {
  await browser.close()
  rmSync(temp, { recursive: true, force: true })
}
