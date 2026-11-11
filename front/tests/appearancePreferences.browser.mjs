import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'
import { makeWorkspace } from './directing-fixtures.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-appearance-')
const port = 4782
const origin = `http://127.0.0.1:${port}`
process.chdir(root)

const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
let browser, page
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page = await context.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  const workspace = makeWorkspace()
  const installFixtures = async target => {
    target.on('pageerror', error => errors.push(error.message))
    await target.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
    await target.route('**/api/**', route => {
      const { pathname } = new URL(route.request().url())
      const respond = data => route.fulfill({ json: { code: 200, data } })
      if (pathname.endsWith('/directing/sequences/s1')) return respond(workspace)
      if (pathname.endsWith('/versions') || pathname.includes('/generation-canvases/')) return respond([])
      return respond({ items: [], next_cursor: null })
    })
  }
  await installFixtures(page)
  const background = target => target.getByRole('banner').evaluate(header => {
    const { backgroundColor, backgroundImage, color } = getComputedStyle(header.parentElement)
    return { backgroundColor, backgroundImage, color }
  })
  const solidBackground = { backgroundColor: 'rgb(247, 248, 251)', backgroundImage: 'none', color: 'rgb(38, 50, 68)' }
  const canvases = [
    ['/projects/p1/generation-canvas', '生成画布工作台'],
    ['/projects/p1/chapters/ch1/sequences/s1', '场次画布工作台'],
  ]
  const canvasColors = async (path, label) => {
    await page.goto(`${origin}${path}`)
    const canvas = page.getByRole('region', { name: label, exact: true })
    await canvas.waitFor()
    assert.equal(await page.getByRole('button', { name: '用户与语言设置' }).count(), 0)
    const task = canvas.getByRole('button', { name: '任务中心', exact: true })
    await task.click()
    const overlay = page.getByRole('dialog').filter({ hasText: '任务中心' })
    await overlay.waitFor()
    const readColors = element => {
      const { backgroundColor, backgroundImage, color } = getComputedStyle(element)
      return { backgroundColor, backgroundImage, color }
    }
    const colors = { canvas: await canvas.evaluate(readColors), overlay: await overlay.evaluate(readColors) }
    await overlay.getByRole('button', { name: /Close|关闭/ }).click()
    await overlay.waitFor({ state: 'hidden' })
    return colors
  }
  const originalCanvasColors = []
  for (const [path, label] of canvases) originalCanvasColors.push(await canvasColors(path, label))
  await page.goto(`${origin}/settings`)

  const settings = page.getByRole('radiogroup', { name: '外观' })
  const mist = settings.getByRole('radio', { name: '雾蓝微渐变', exact: true })
  const solid = settings.getByRole('radio', { name: '雾蓝纯色', exact: true })
  await mist.waitFor()
  assert.equal(await mist.isChecked(), true)
  const initial = await background(page)
  assert.match(initial.backgroundImage, /rgb\(240, 245, 252\).*rgb\(247, 248, 251\)/)
  assert.equal(await page.getByRole('switch', { name: /深色模式/ }).count(), 0)
  const nickname = page.getByRole('textbox', { name: /昵称/ })
  await nickname.fill('未保存的昵称')
  await solid.check()
  assert.deepEqual(await background(page), solidBackground)
  assert.equal(await nickname.inputValue(), '未保存的昵称')
  assert.equal(await page.getByText('已更新基础信息（示例）', { exact: true }).count(), 0)
  const account = page.getByRole('button', { name: '用户与语言设置', exact: true })
  await account.press('Enter')
  const menu = page.getByRole('menu')
  const mistMenu = page.getByRole('menuitemradio', { name: '雾蓝微渐变', exact: true })
  const solidMenu = page.getByRole('menuitemradio', { name: '雾蓝纯色', exact: true })
  await solidMenu.waitFor()
  assert.equal(await solidMenu.getAttribute('aria-checked'), 'true')
  await page.waitForFunction(() => document.activeElement?.closest('[role="menu"]'))
  const reachOption = async option => {
    for (let step = 0; step < 7 && !await option.evaluate(element => element === document.activeElement); step += 1) {
      const focused = await page.evaluate(() => document.activeElement?.textContent)
      await page.keyboard.press('ArrowDown')
      await page.waitForFunction(previous => document.activeElement?.textContent !== previous, focused)
    }
    await option.and(page.locator(':focus')).waitFor()
  }
  await reachOption(mistMenu)
  await page.screenshot({ path: `${output}/appearance-1440.png`, animations: 'disabled' })
  await page.keyboard.press('Enter')
  await menu.waitFor({ state: 'hidden' })
  await account.and(page.locator(':focus')).waitFor()
  assert.equal(await mist.isChecked(), true)
  assert.deepEqual(await background(page), initial)

  await account.press('Enter')
  await solidMenu.waitFor()
  await page.waitForFunction(() => document.activeElement?.closest('[role="menu"]'))
  await reachOption(solidMenu)
  await page.keyboard.press('Enter')
  await menu.waitFor({ state: 'hidden' })
  assert.equal(await solid.isChecked(), true)
  await page.reload()
  await solid.waitFor()
  assert.equal(await solid.isChecked(), true)
  assert.deepEqual(await background(page), solidBackground)
  assert.equal(await nickname.inputValue(), 'Admin')

  const reopened = await page.context().newPage()
  await installFixtures(reopened)
  await reopened.goto(origin)
  assert.deepEqual(await background(reopened), solidBackground)
  await reopened.close()

  for (const [index, [path, label]] of canvases.entries()) {
    const colors = await canvasColors(path, label)
    assert.deepEqual(colors, originalCanvasColors[index])
    assert.equal(colors.canvas.backgroundColor, 'rgb(13, 13, 13)')
    assert.notEqual(colors.overlay.backgroundColor, 'rgb(255, 255, 255)')
  }

  await page.goto(`${origin}/settings`)
  await page.setViewportSize({ width: 375, height: 812 })
  await account.press('Enter')
  await solidMenu.waitFor()
  assert.equal(await solidMenu.getAttribute('aria-checked'), 'true')
  await page.waitForFunction(() => document.activeElement?.closest('[role="menu"]'))
  const box = await menu.boundingBox()
  assert.ok(box.x >= 0 && box.x + box.width <= 375)
  await page.screenshot({ path: `${output}/appearance-375.png`, animations: 'disabled' })
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  await account.and(page.locator(':focus')).waitFor()

  const fallback = await browser.newPage({ locale: 'zh-CN' })
  await installFixtures(fallback)
  await fallback.addInitScript(() => localStorage.setItem('jellyfish_appearance', 'unsupported'))
  await fallback.goto(origin)
  assert.deepEqual(await background(fallback), initial)
  await fallback.close()

  const blocked = await browser.newPage({ locale: 'zh-CN' })
  await installFixtures(blocked)
  await blocked.addInitScript(() => {
    for (const method of ['getItem', 'setItem']) {
      const original = Storage.prototype[method]
      Storage.prototype[method] = function (key, ...args) {
        if (key === 'jellyfish_appearance') throw new DOMException('Appearance storage disabled', 'SecurityError')
        return original.call(this, key, ...args)
      }
    }
  })
  await blocked.goto(`${origin}/settings`)
  assert.deepEqual(await background(blocked), initial)
  await blocked.getByRole('radio', { name: '雾蓝纯色' }).check()
  assert.deepEqual(await background(blocked), solidBackground)
  await blocked.getByRole('link', { name: '首页', exact: true }).click()
  await blocked.waitForURL(`${origin}/`)
  assert.deepEqual(await background(blocked), solidBackground)
  await blocked.reload()
  assert.deepEqual(await background(blocked), initial)
  assert.deepEqual(errors, [])
  console.log(`Appearance preference browser acceptance passed. Evidence: ${output}`)
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` })
  console.log(await page?.locator('body').ariaSnapshot())
  throw error
} finally {
  await cleanup()
}
