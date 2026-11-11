import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-management-assets-')
const port = 4794
const origin = `http://127.0.0.1:${port}`
process.chdir(root)
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
let browser, page
const cleanup = browserCleanup(() => ({ browser, server }))
const types = [['actor', '演员', 'actors'], ['scene', '场景', 'scenes'], ['prop', '道具', 'props'], ['costume', '服装', 'costumes']]
const records = Object.fromEntries(types.map(([type, label]) => [type, [
  { id: type + '-tall', name: label + '竖图', thumbnail: 'tall', description: '很长的描述。'.repeat(28), tags: ['标签一', '标签二', '标签三'] },
  { id: type + '-wide', name: label + '宽图', thumbnail: 'wide' },
  { id: type + '-missing', name: label + '缺图' },
  { id: type + '-broken', name: label + '损坏封面', thumbnail: 'broken' },
]]))
records.costume.push(...Array.from({ length: 9 }, (_, index) => ({ id: `costume-page-${index + 1}`, name: `服装分页 ${index + 1}` })))
let failRead, failDelete = true, generationStatus = 'running', generationCount = 0, deleteCount = 0
const promptRequests = []
let releaseGeneration
const holdGeneration = new Promise(resolve => { releaseGeneration = resolve })
const box = async locator => {
  const bounds = await locator.boundingBox()
  assert.ok(bounds)
  return bounds
}
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    const respond = data => route.fulfill({ json: { success: true, data } })
    const list = (items, total = items.length) => respond({ items, pagination: { total, page: 1, page_size: 12 } })
    if (/\/files\/(tall|wide|broken)\/download$/.test(path)) {
      if (path.includes('broken')) return route.fulfill({ status: 404 })
      const [width, height] = path.includes('tall') ? [100, 1600] : [1600, 100]
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="steelblue"/></svg>` })
    }
    if (path.endsWith('/film/tasks/task-asset/status')) {
      if (generationStatus === 'succeeded') records.actor.find(asset => asset.id === 'actor-missing').thumbnail = 'wide'
      return respond({ task_id: 'task-asset', status: generationStatus })
    }
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    const match = path.match(/\/entities\/(actor|scene|prop|costume)(?:\/([^/]+))?(\/images)?$/)
    if (match) {
      const [, type, id, images] = match
      if (images) return list([{ id: 19, view_angle: 'FRONT', file_id: records[type].find(asset => asset.id === id)?.thumbnail }])
      if (id && request.method() === 'DELETE') {
        deleteCount++
        if (failDelete) return route.fulfill({ status: 409, json: { detail: '仍有关联引用' } })
        records[type] = records[type].filter(asset => asset.id !== id)
        return respond(null)
      }
      if (id) return respond(records[type].find(asset => asset.id === id))
      if (type === failRead) return route.fulfill({ status: 503 })
      const q = url.searchParams.get('q') || ''
      const items = records[type].filter(asset => asset.name.includes(q))
      const pageNumber = Number(url.searchParams.get('page') || 1)
      const pageSize = Number(url.searchParams.get('page_size') || 12)
      const pageItems = items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize)
      if (type === 'scene') return respond({ items: pageItems })
      return list(pageItems, items.length)
    }
    if (path.endsWith('/generation-prompts/assets/actor/actor-missing/slots/19/render')) {
      promptRequests.push(path)
      return respond({ render_id: 'render-asset', template_id: 'tpl', template_version: 1, variables_snapshot: {}, execution_prompt: '画一个演员', recommended_media: { references: [] } })
    }
    if (path.endsWith('/generation-tasks/actors/actor-missing/slots/19/tasks')) {
      generationCount++
      await holdGeneration
      assert.equal(request.postDataJSON().execution_prompt, '画一个演员')
      return respond({ task_id: 'task-asset' })
    }
    return respond([])
  })
  const card = name => page.getByRole('article').filter({ has: page.getByRole('link', { name, exact: true }) })
  await page.goto(origin + '/assets?tab=actor')
  const tall = page.getByRole('img', { name: '演员竖图', exact: true })
  await tall.waitFor()
  await tall.evaluate(image => image.decode())
  assert.equal(Math.round((await box(tall)).height), 160, '高比例封面受统一的 160px 预览区限制')
  await page.getByRole('heading', { name: '资产库', exact: true }).waitFor()
  const thumbnail = card('演员竖图').getByRole('button', { name: '预览演员竖图', exact: true })
  const wide = card('演员宽图').getByRole('img', { name: '演员宽图', exact: true })
  await wide.evaluate(image => image.decode())
  assert.equal((await box(wide)).height, (await box(tall)).height)
  assert.equal((await box(card('演员竖图').getByRole('button', { name: '重新生成', exact: true }))).y,
    (await box(card('演员缺图').getByRole('button', { name: '生成', exact: true }))).y)
  await thumbnail.press('Enter')
  const preview = page.getByRole('dialog', { name: '演员竖图 · 图片预览' })
  const full = preview.getByRole('img', { name: '演员竖图', exact: true })
  await full.waitFor()
  const previewBounds = await box(preview)
  const imageBounds = await box(full)
  assert.ok(imageBounds.height < previewBounds.height)
  await page.waitForFunction(() => document.activeElement?.closest('[role="dialog"]'))
  await page.keyboard.press('Escape')
  await preview.waitFor({ state: 'hidden' })
  await thumbnail.and(page.locator(':focus')).waitFor()

  for (const [type, label, route] of types) {
    await page.getByRole('tab', { name: label, exact: true }).click()
    await page.waitForURL(url => url.searchParams.get('tab') === type)
    await card(label + '损坏封面').getByText('图片加载失败', { exact: true }).waitFor()
    const missing = card(label + '缺图')
    await missing.getByText('暂无封面', { exact: true }).waitFor()
    await missing.getByText('未填写简介', { exact: true }).waitFor()
    assert.equal(await missing.getByText('暂无标签',{exact:true}).count(),0)
    assert.equal(await missing.getByRole('button', { name: '生成', exact: true }).count(), 1)
    assert.equal(await missing.getByRole('link', { name: label + '缺图' }).getAttribute('href'), `/assets/${route}/${type}-missing/edit`)
    if (type === 'scene') await page.getByText('已加载 4 项', { exact: true }).waitFor()
  }
  await page.getByTitle('2', { exact: true }).click()
  await card('服装分页 9').waitFor()
  assert.equal(await card('服装竖图').count(), 0)
  await page.getByTitle('1', { exact: true }).click()
  await card('服装竖图').getByRole('link', { name: '服装竖图' }).click()
  await page.waitForURL('**/assets/costumes/costume-tall/edit')
  await page.goBack()
  await page.waitForURL(url => url.searchParams.get('tab') === 'costume')

  await page.getByRole('tab', { name: '演员', exact: true }).click()
  const missingActor = card('演员缺图')
  const generationRequest = page.waitForRequest(request =>
    request.method() === 'POST' && request.url().endsWith('/generation-tasks/actors/actor-missing/slots/19/tasks'))
  await missingActor.getByRole('button', { name: '生成', exact: true }).click()
  await generationRequest
  const busy = missingActor.getByRole('button', { name: '生成中', exact: true })
  await busy.waitFor()
  assert.equal(await busy.isDisabled(), true)
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await card('场景竖图').waitFor()
  await page.getByRole('tab', { name: '演员', exact: true }).click()
  await busy.waitFor()
  assert.equal(await busy.isDisabled(), true, '请求还在等待时切回资产分类，生成入口仍锁定')
  releaseGeneration()
  await page.getByText('已创建演员图片生成任务', { exact: true }).waitFor()
  assert.equal(generationCount, 1)
  assert.equal(promptRequests.length, 1)
  await page.waitForResponse(response => response.url().endsWith('/film/tasks/task-asset/status'))
  assert.equal(await busy.isDisabled(), true)
  generationStatus = 'succeeded'
  await missingActor.getByRole('button', { name: '重新生成', exact: true }).waitFor()
  generationStatus = 'failed'
  await missingActor.getByRole('button', { name: '重新生成', exact: true }).click()
  await page.getByText('演员图片生成失败', { exact: true }).waitFor()
  assert.equal(generationCount, 2)

  const search = page.getByRole('textbox', { name: '搜索演员' })
  await search.fill('缺图')
  await search.press('Enter')
  await page.getByText('共 1 项', { exact: true }).waitFor()
  failRead = 'actor'
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText('刷新资产失败，保留已显示的数据', { exact: true }).waitFor()
  await missingActor.waitFor()
  assert.equal(await search.inputValue(), '缺图')
  failRead = undefined
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByText('刷新资产失败，保留已显示的数据', { exact: true }).waitFor({ state: 'hidden' })
  await search.fill('无结果')
  await search.press('Enter')
  await page.getByText('无匹配资产', { exact: true }).waitFor()
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()

  await missingActor.getByRole('button', { name: '演员缺图更多操作' }).click()
  await page.getByRole('menuitem', { name: '删除', exact: true }).click()
  const confirm = page.getByRole('dialog').filter({ hasText: '删除演员「演员缺图」？' })
  await confirm.getByText(/删除后无法恢复/).waitFor()
  assert.equal(deleteCount, 0)
  await confirm.getByRole('button', { name: /^删\s*除$/ }).click()
  await page.getByText('删除演员失败，请重试', { exact: true }).waitFor()
  await confirm.waitFor()
  await missingActor.waitFor()
  failDelete = false
  await confirm.getByRole('button', { name: /^删\s*除$/ }).click()
  await confirm.waitFor({ state: 'hidden' })
  await missingActor.waitFor({ state: 'hidden' })
  assert.equal(deleteCount, 2)

  failRead = 'prop'
  await page.goto(origin + '/assets?tab=prop')
  await page.getByText('读取道具资产失败', { exact: true }).waitFor()
  assert.equal(await page.getByText('暂无道具资产', { exact: true }).count(), 0)
  assert.equal(await page.getByText('共 0 项', { exact: true }).count(), 0)
  failRead = undefined
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await card('道具竖图').waitFor()
  records.prop = []
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText('暂无道具资产', { exact: true }).waitFor()
  const longName='长名称资产'.repeat(18)
  records.actor.push({id:'actor-long',name:longName,description:'用于核对常驻进入箭头'})
  await page.goto(origin + '/assets?tab=actor')

  for (const [width, height, theme] of [[1440, 900, '雾蓝微渐变'], [1366, 768, '雾蓝纯色'], [1024, 768, '雾蓝纯色'], [1023, 768, '雾蓝纯色'], [600, 812, '雾蓝纯色'], [375, 812, '雾蓝微渐变']]) {
    await page.setViewportSize({ width, height })
    const account = page.getByRole('button', { name: '用户与语言设置' })
    await account.click()
    const appearance = page.getByRole('menuitemradio', { name: theme, exact: true })
    await appearance.click()
    await appearance.waitFor({ state: 'hidden' })
    const backdrop = await page.getByRole('banner').evaluate(banner => getComputedStyle(banner.parentElement).backgroundImage)
    assert.equal(backdrop === 'none', theme === '雾蓝纯色')
    const longCard=card(longName)
    const longLink=longCard.getByRole('link',{name:longName,exact:true})
    const arrow=await box(longLink.locator('svg'))
    const titleBox=await box(longLink)
    assert.ok(arrow.x>=titleBox.x && arrow.x+arrow.width<=titleBox.x+titleBox.width+1, 'long-name navigation arrow stays within the visible link')
    const primary = page.getByRole('button', { name: '新建演员', exact: true })
    assert.equal(await primary.evaluate(button => getComputedStyle(button).backgroundColor), 'rgb(36, 95, 197)')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    if (width >= 1024) {
      const searchBounds = await box(search), createBounds = await box(primary)
      assert.ok(createBounds.x > searchBounds.x + searchBounds.width)
      assert.ok(Math.abs(createBounds.y + createBounds.height / 2 - searchBounds.y - searchBounds.height / 2) < 2)
    }
    if (width <= 767) assert.equal((await box(card('演员竖图'))).x, (await box(card('演员宽图'))).x)
    await page.screenshot({ path: join(output, `assets-${width}.png`), animations: 'disabled' })
  }
  assert.deepEqual(errors, [])
  console.log('Asset library covers, preview, generation, recovery, deletion and responsive layout verified.')
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') })
  console.log('Browser evidence:', output)
  throw error
} finally {
  releaseGeneration()
  await cleanup()
}
