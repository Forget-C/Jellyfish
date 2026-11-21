import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'
import { makeSequence } from './directing-fixtures.mjs'

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
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
  page = await context.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  const sequence = makeSequence()
  const canvases = [
    { path: '/canvases/free-appearance', id: 'free-appearance', projectId: null, name: '自由画布配色验收' },
    { path: '/projects/p1/chapters/ch1/sequences/s1/canvas-workbench?canvas=storyboard-appearance',
      id: 'storyboard-appearance', projectId: 'p1', name: '分镜配色验收' },
  ]
  const sceneCanvas = canvases[1]
  let sceneUnavailable = false
  const installFixtures = async target => {
    target.on('pageerror', error => errors.push(error.message))
    await target.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
    await target.route('**/api/**', route => {
      const { pathname, searchParams } = new URL(route.request().url())
      const respond = data => route.fulfill({ json: { code: 200, data } })
      if (pathname === '/api/v1/studio/projects/p1/directing/chapters/ch1/sequences/s1/canvases') {
        return respond({ sequence, canvases: sceneUnavailable ? [] : [
          { id: sceneCanvas.id, name: sceneCanvas.name, can_open: true },
        ] })
      }
      if (pathname.endsWith('/home/recent-canvases')) return respond([{ id: 'recent', name: '画布一', kind: 'free', updated_at: '2024-11-08T00:00:00Z' }])
      const canvasRequest = pathname.match(/^\/api\/v1\/studio\/generation-canvases\/([^/]+)(.*)$/)
      if (canvasRequest) {
        const [, id, operation] = canvasRequest
        const canvas = canvases.find(item => item.id === id && (item.projectId ?? '') === (searchParams.get('project_id') ?? ''))
        if (!canvas) return route.fulfill({ status: 404, json: { code: 404, message: '画布不存在', data: null } })
        if (!operation) return respond({
          id, project_id: canvas.projectId, revision: 0,
          document: { id, project_id: canvas.projectId, name: canvas.name, schema_version: 2, cards: [], edges: [], input_order: {}, groups: [] },
          ...(canvas.projectId ? { scene: { chapter_id: 'ch1', sequence_id: 's1', is_current: true } } : {}),
        })
        if (operation === '/catalog') return respond({ cards: [], connection_policies: [] })
        if (operation === '/runtime') return respond({ cursor: 0, runs: [], current_outputs: {} })
        if (operation === '/events/connection') return respond({ url: `${origin}${pathname.replace(/\/connection$/, '')}?${searchParams}` })
        if (operation === '/events') return route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' })
      }
      return respond({ items: [], next_cursor: null })
    })
  }
  await installFixtures(page)
  await page.goto(origin)
  await page.getByRole('heading', { name: '工作概览' }).waitFor()
  await page.getByRole('button', { name: '用户与语言设置' }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  await page.getByRole('heading', { name: 'Work overview' }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Work overview' }).waitFor()
  assert.match(await page.locator('time').first().innerText(), /Nov/)
  const invalid = await browser.newContext({ locale: 'en-US' })
  await invalid.addInitScript(() => localStorage.setItem('jellyfish_language', 'fr-FR'))
  const invalidPage = await invalid.newPage()
  await installFixtures(invalidPage)
  await invalidPage.goto(origin)
  await invalidPage.getByRole('heading', { name: '工作概览' }).waitFor()
  await invalid.close()
  const direct = await context.newPage()
  await installFixtures(direct)
  await direct.goto(origin + canvases[0].path)
  await direct.getByRole('button', { name: 'Canvas appearance', exact: true }).waitFor()
  await direct.getByRole('button', { name: 'Canvas appearance', exact: true }).click()
  await direct.getByRole('menuitemradio', { name: 'Classic dark', exact: true }).waitFor()
  assert.equal(await direct.locator('html').getAttribute('lang'), 'en-US')
  await direct.close()
  await page.goto(origin + '/settings')
  await page.getByText('Administrator', { exact: true }).first().waitFor()
  await page.getByRole('textbox', { name: 'Nickname' }).waitFor()
  await page.goto(origin + '/missing-i18n-page')
  await page.getByRole('button', { name: 'Back Home' }).click()
  await page.getByRole('button', { name: 'User and language settings' }).click()
  await page.getByRole('menuitem', { name: '简体中文', exact: true }).click()
  await page.reload()
  await page.getByRole('heading', { name: '工作概览' }).waitFor()
  await page.goto(origin + '/missing-i18n-page')
  await page.getByRole('button', { name: '返回首页' }).click()
  const background = target => target.getByRole('banner').evaluate(header => {
    const { backgroundColor, backgroundImage, color } = getComputedStyle(header.parentElement)
    return { backgroundColor, backgroundImage, color }
  })
  const solidBackground = { backgroundColor: 'rgb(247, 248, 251)', backgroundImage: 'none', color: 'rgb(38, 50, 68)' }
  const canvasColors = async ({ path, name }) => {
    await page.goto(`${origin}${path}`)
    const canvas = page.getByRole('region', { name: '生成画布工作台', exact: true })
    await canvas.getByText(name, { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '用户与语言设置' }).count(), 0)
    const task = canvas.getByRole('button', { name: '任务中心', exact: true })
    await task.click()
    const overlay = page.getByRole('dialog').filter({ hasText: '任务中心' })
    await overlay.waitFor()
    const readColors = element => {
      const { backgroundColor, backgroundImage, color } = getComputedStyle(element)
      return { backgroundColor, backgroundImage, color }
    }
    const colors = { canvas: await canvas.locator('.generation-surface').evaluate(readColors), overlay: await overlay.evaluate(readColors) }
    await overlay.getByRole('button', { name: /Close|关闭/ }).click()
    await overlay.waitFor({ state: 'hidden' })
    return colors
  }
  const originalCanvasColors = []
  for (const canvas of canvases) originalCanvasColors.push(await canvasColors(canvas))
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

  for (const [index, canvas] of canvases.entries()) {
    const colors = await canvasColors(canvas)
    assert.equal(colors.canvas.backgroundColor, solidBackground.backgroundColor)
    assert.doesNotMatch(colors.canvas.backgroundImage, /linear-gradient/, 'default follows the current site appearance')
    assert.notDeepEqual(colors.canvas, originalCanvasColors[index].canvas)
    assert.equal(colors.overlay.backgroundColor, 'rgb(237, 242, 248)', 'task portal follows light theme')
    const picker = page.getByRole('button', { name: '画布配色', exact: true })
    const choose = async name => {
      await picker.press('Enter')
      const option = page.getByRole('menuitemradio', { name, exact: true })
      await option.waitFor()
      await option.click()
      await option.waitFor({ state: 'hidden' })
    }
    await choose('经典深色')
    const dark = await canvasColors(canvas)
    assert.equal(dark.canvas.backgroundColor, 'rgb(13, 13, 13)')
    assert.equal(dark.canvas.color, 'rgb(229, 229, 229)')
    assert.equal(dark.overlay.backgroundColor, 'rgb(36, 36, 36)')
    await choose('雾蓝微渐变')
    const light = await canvasColors(canvas)
    assert.match(light.canvas.backgroundImage, /linear-gradient/)
    assert.equal(light.canvas.color, 'rgb(38, 50, 68)')
    await page.reload()
    await picker.waitFor()
    await picker.press('Enter')
    assert.equal(await page.getByRole('menuitemradio', { name: '雾蓝微渐变', exact: true }).getAttribute('aria-checked'), 'true')
    await page.keyboard.press('Escape')
    await choose('雾蓝纯色')
    assert.deepEqual((await canvasColors(canvas)).canvas, colors.canvas)
    await page.setViewportSize({ width: 390, height: 844 })
    await picker.press('Enter')
    const palette = page.getByRole('menu')
    await palette.waitFor()
    await page.waitForFunction(() => {
      const option = [...document.querySelectorAll('[role="menuitemradio"]')].find(element => element.getClientRects().length)
      if (!option) return false
      const box = option.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return !!hit && option.contains(hit)
    })
    const bounds = await palette.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, 'palette fits narrow viewport')
    await page.screenshot({ path: `${output}/canvas-palette-${index}-390.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1440, height: 900 })
    await choose('跟随主站')
  }

  sceneUnavailable = true
  await page.goto(`${origin}${sceneCanvas.path}`)
  await page.getByText('此画布不属于当前场次或已不可用', { exact: true }).waitFor()
  assert.equal(await page.locator('.workbench-ui').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(247, 248, 251)', 'storyboard unavailable state follows the same appearance')
  sceneUnavailable = false
  await page.goto(`${origin}/settings`)
  const canvasSettings = page.getByRole('radiogroup', { name: '画布配色', exact: true })
  await canvasSettings.getByRole('radio', { name: '经典深色', exact: true }).check()
  await nickname.fill('画布切换不提交表单')
  await canvasSettings.getByRole('radio', { name: '雾蓝纯色', exact: true }).check()
  assert.equal(await nickname.inputValue(), '画布切换不提交表单')
  await page.reload()
  assert.equal(await canvasSettings.getByRole('radio', { name: '雾蓝纯色', exact: true }).isChecked(), true)
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
  await fallback.addInitScript(() => { localStorage.setItem('jellyfish_appearance', 'unsupported'); localStorage.setItem('jellyfish_canvas_appearance', 'unsupported') })
  await fallback.goto(origin)
  assert.deepEqual(await background(fallback), initial)
  await fallback.goto(`${origin}/settings`)
  assert.equal(await fallback.getByRole('radiogroup', { name: '画布配色' }).getByRole('radio', { name: '跟随主站', exact: true }).isChecked(), true)
  await fallback.close()

  const blocked = await browser.newPage({ locale: 'zh-CN' })
  await installFixtures(blocked)
  await blocked.addInitScript(() => {
    for (const method of ['getItem', 'setItem']) {
      const original = Storage.prototype[method]
      Storage.prototype[method] = function (key, ...args) {
        if (['jellyfish_appearance', 'jellyfish_canvas_appearance', 'jellyfish_language'].includes(key)) throw new DOMException('Appearance storage disabled', 'SecurityError')
        return original.call(this, key, ...args)
      }
    }
  })
  await blocked.goto(`${origin}/settings`)
  assert.deepEqual(await background(blocked), initial)
  await blocked.getByRole('radiogroup', { name: '画布配色' }).getByRole('radio', { name: '经典深色' }).check()
  assert.equal(await blocked.getByRole('radiogroup', { name: '画布配色' }).getByRole('radio', { name: '经典深色' }).isChecked(), true)
  await blocked.getByRole('radiogroup', { name: '外观', exact: true }).getByRole('radio', { name: '雾蓝纯色' }).check()
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
