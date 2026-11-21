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
    const home = page.locator('main#content')
    assert.ok(await home.getByText('Jellyfish AI 短剧创作工作台', { exact: true }).isVisible())
    assert.equal(await home.getByRole('heading', { level: 1 }).innerText(), '雾海来信')
    assert.equal(await home.getByRole('button', { name: /剧照优先|画布优先/ }).count(), 0)
    for (const name of ['分镜画布', '镜头结果', '章节原文']) {
      const button = home.getByRole('button', { name, exact: true })
      await button.focus()
      await page.keyboard.press('Enter')
      assert.equal(await button.getAttribute('aria-pressed'), 'true')
      assert.ok(await page.locator('#' + await button.getAttribute('aria-controls')).isVisible())
    }
    const graph = home.getByRole('region', { name: '这一镜是怎样生成的' })
    assert.ok(await graph.isVisible())
    for (const [name, source] of [[/角色 林夏/, 'references'], [/分镜描述/, 'description'], [/选作首帧/, 'candidate']]) {
      const node = graph.getByRole('button', { name })
      await node.focus()
      await page.keyboard.press('Enter')
      assert.equal(await node.getAttribute('aria-pressed'), 'true')
      assert.equal(await graph.locator('svg path.is-active[d]').getAttribute('data-from'), source)
    }
    for (const video of await home.locator('video').all()) {
      await video.evaluate(el => el.play())
      await video.evaluate(el => new Promise(resolve => {
        if (el.currentTime > 0) resolve()
        else el.addEventListener('timeupdate', resolve, { once: true })
      }))
      await video.evaluate(el => el.pause())
    }
    assert.equal(await home.locator('video').count(), 2)
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    }
    const deploy = home.getByRole('link', { name: /本地部署/ }).first()
    await page.evaluate(() => scrollTo(0, 0))
    const bounds = await deploy.boundingBox()
    assert.ok(bounds.y + bounds.height <= 900)
    await deploy.click()
    assert.equal(await page.locator('h1').innerText(), '准备安装环境')
    console.log(`Homepage scripts, navigation, media and layout passed: ${width}px`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
