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
  { id: type + '-tall', name: label + '竖图', thumbnail: 'tall', origin: 'created', created_at: '2026-11-15T18:30:00Z', description: '很长的描述。'.repeat(28), tags: ['标签一', '标签二', '标签三'] },
  { id: type + '-wide', name: label + '宽图', thumbnail: 'wide', origin: 'upload', created_at: '2026-11-16T00:00:00' },
  { id: type + '-missing', name: label + '缺图', origin: 'project' },
  { id: type + '-broken', name: label + '损坏封面', thumbnail: 'broken', origin: 'library', source_character_id: type === 'actor' ? 'role-source' : null },
]]))
records.costume.push(...Array.from({ length: 9 }, (_, index) => ({ id: `costume-page-${index + 1}`, name: `服装分页 ${index + 1}` })))
const listRequests = []
let failRead, failDelete = true, generationRequests = 0, deleteCount = 0
const box = async locator => {
  const bounds = await locator.boundingBox()
  assert.ok(bounds)
  return bounds
}
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1440, height: 900 } })
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
    if (request.method() === 'POST' && (path.includes('/generation-') || path.endsWith('/images'))) generationRequests++
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    const match = path.match(/\/entities\/(actor|scene|prop|costume)(?:\/([^/]+))?(\/images)?$/)
    if (match) {
      const [, type, id, images] = match
      if (images) {
        const picture={ id: 19, view_angle: 'FRONT', file_id: records[type].find(asset => asset.id === id)?.thumbnail }
        return request.method()==='POST' ? respond({...picture,...request.postDataJSON()}) : list([picture])
      }
      if (id && request.method() === 'DELETE') {
        deleteCount++
        if (failDelete) return route.fulfill({ status: 409, json: { detail: '仍有关联引用' } })
        records[type] = records[type].filter(asset => asset.id !== id)
        return respond(null)
      }
      if (id) return respond(records[type].find(asset => asset.id === id))
      if (request.method() === 'POST') {
        const created = { origin: 'created', ...request.postDataJSON() }
        records[type].unshift(created)
        return respond(created)
      }
      const q = url.searchParams.get('q') || ''
      const items = records[type].filter(asset => asset.name.includes(q) || asset.description?.includes(q))
      const pageNumber = Number(url.searchParams.get('page') || 1)
      const pageSize = Number(url.searchParams.get('page_size') || 12)
      listRequests.push({ type, q, pageNumber, pageSize })
      if (type === failRead) return route.fulfill({ status: 503 })
      const pageItems = items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize)
      if (type === 'scene') return respond({ items: pageItems })
      return list(pageItems, items.length)
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
  assert.equal((await box(card('演员竖图').locator('.asset-library-description'))).height, (await box(card('演员缺图').locator('.asset-library-description'))).height)
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
    assert.equal(await missing.getByRole('button', { name: /生成/ }).count(), 0)
    const filled = card(label + '竖图')
    await filled.getByText('设定创建', { exact: true }).waitFor()
    await filled.getByLabel('创建日期 2026/11/16', { exact: true }).waitFor()
    await card(label + '宽图').getByText('上传', { exact: true }).waitFor()
    await missing.getByText('项目转化', { exact: true }).waitFor()
    await missing.getByText('日期未提供', { exact: true }).waitFor()
    await card(label + '损坏封面').getByText(type === 'actor' ? '从角色转化' : '资产库导入', { exact: true }).waitFor()
    assert.equal(await filled.locator('.asset-library-card-content > *').count(), 3, 'cards contain exactly three information rows')
    assert.equal((await box(filled)).height, (await box(missing)).height, 'empty descriptions reserve the same card height')
    const titleBox = await box(filled.locator('.project-resource-title-row')), metaBox = await box(filled.locator('.resource-card-metadata')), descriptionBox = await box(filled.locator('.asset-library-description'))
    assert.ok(titleBox.y + titleBox.height <= metaBox.y && metaBox.y + metaBox.height <= descriptionBox.y)
    assert.equal(descriptionBox.height, 40)
    const editLink = await missing.getByRole('link', { name: label + '缺图' }).getAttribute('href')
    assert.equal(new URL(editLink, origin).pathname, `/assets/${route}/${type}-missing/edit`)
    if (type === 'scene') await page.getByText('已加载 4 项', { exact: true }).waitFor()
  }
  const costumePages = page.getByRole('navigation', { name: '服装资产分页' })
  await page.setViewportSize({ width: 1440, height: 1260 })
  await card('服装分页 9').waitFor()
  assert.equal(listRequests.at(-1).pageSize, 18)
  assert.equal(await costumePages.count(), 0)
  const searchCostume = page.getByRole('textbox', { name: '搜索服装' })
  await searchCostume.fill('服装')
  await searchCostume.press('Enter')
  await page.getByText('匹配 13 项', { exact: true }).waitFor()
  await page.setViewportSize({ width: 1440, height: 900 })
  await costumePages.getByTitle('2', { exact: true }).click()
  const footer = await box(costumePages)
  assert.ok(footer.x > 1050 && footer.y > 840, '分页栏固定在右下方')
  const costumeLast = card('服装分页 9')
  await costumeLast.waitFor()
  assert.equal(await card('服装竖图').count(), 0)

  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByText('已加载 4 项', { exact: true }).waitFor()
  const restoredCostumePage = page.waitForResponse(response => {
    const { pathname, searchParams } = new URL(response.url())
    return pathname.endsWith('/entities/costume') && searchParams.get('page') === '2'
      && searchParams.get('page_size') === '12' && searchParams.get('q') === '服装'
  })
  await page.getByRole('tab', { name: '服装', exact: true }).click()
  await restoredCostumePage
  await costumeLast.waitFor()
  assert.deepEqual(listRequests.at(-1), { type: 'costume', q: '服装', pageNumber: 2, pageSize: 12 })
  assert.equal(await searchCostume.inputValue(), '服装')
  const lastLink = costumeLast.getByRole('link')
  await lastLink.click()
  await page.waitForURL(url => url.pathname === '/assets/costumes/costume-page-9/edit')
  await page.reload()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await lastLink.and(page.locator(':focus')).waitFor()
  assert.equal(listRequests.at(-1).pageNumber, 2)

  assert.equal(await searchCostume.inputValue(), '服装')
  await searchCostume.fill('分页 9')
  await searchCostume.press('Enter')
  await page.getByText('匹配 1 项', { exact: true }).waitFor()
  assert.equal(listRequests.at(-1).pageNumber, 1)
  await searchCostume.fill('')
  await searchCostume.press('Enter')
  await costumePages.getByTitle('2', { exact: true }).click()
  await costumeLast.waitFor()
  await page.setViewportSize({ width: 375, height: 700 })
  await costumePages.getByText('13 / 13', { exact: true }).waitFor()
  await costumeLast.waitFor()
  assert.equal(listRequests.at(-1).pageSize, 1)
  await page.setViewportSize({ width: 1440, height: 900 })
  await costumePages.getByTitle('2', { exact: true }).locator('..').waitFor()
  await costumeLast.waitFor()
  await costumeLast.getByRole('button', { name: '服装分页 9更多操作' }).click()
  await page.getByRole('menuitem', { name: '删除', exact: true }).click()
  failDelete = false
  await page.getByRole('dialog').getByRole('button', { name: /^删\s*除$/ }).click()
  await page.getByText('共 12 项', { exact: true }).waitFor()
  await card('服装竖图').waitFor()
  assert.equal(await costumePages.count(), 0)
  assert.equal(listRequests.at(-1).pageNumber, 1)
  records.costume.push({ id: 'costume-extra', name: '服装末页补充' })
  await searchCostume.fill('服装')
  await searchCostume.press('Enter')
  await costumePages.getByTitle('2', { exact: true }).click()
  await card('服装末页补充').waitFor()
  await page.getByRole('button', { name: '新建服装', exact: true }).click()
  await page.getByRole('button', { name: /^填写设定/ }).click()
  const create = page.getByRole('dialog', { name: '新建服装', exact: true })
  await create.getByRole('textbox', { name: '名称', exact: true }).fill('服装新建分页')
  await create.getByRole('button', { name: '保存设定', exact: true }).click()
  const created = page.getByRole('dialog', { name: '服装新建分页', exact: true })
  await created.getByRole('button', { name: '返回', exact: true }).click()
  await card('服装新建分页').waitFor()
  assert.deepEqual(listRequests.at(-1), { type: 'costume', q: '服装', pageNumber: 1, pageSize: 12 })

  deleteCount = 0
  failDelete = true

  await page.getByRole('tab', { name: '演员', exact: true }).click()
  const missingActor = card('演员缺图')
  await missingActor.waitFor()
  await page.getByRole('tab', { name: '服装', exact: true }).click()
  await card('服装新建分页').waitFor()
  failRead = 'actor'
  await page.getByRole('tab', { name: '演员', exact: true }).click()
  await page.getByText('刷新资产失败，保留已显示的数据', { exact: true }).waitFor()
  await missingActor.waitFor()
  failRead = undefined
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByText('刷新资产失败，保留已显示的数据', { exact: true }).waitFor({ state: 'hidden' })
  const search = page.getByRole('textbox', { name: '搜索演员' })
  await search.fill('缺图')
  await search.press('Enter')
  await page.getByText('匹配 1 项', { exact: true }).waitFor()
  failRead = 'actor'
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText('刷新资产失败，保留已显示的数据', { exact: true }).waitFor()
  await missingActor.waitFor()
  assert.equal(await search.inputValue(), '缺图')
  failRead = undefined
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByText('刷新资产失败，保留已显示的数据', { exact: true }).waitFor({ state: 'hidden' })
  failRead = 'actor'
  await search.fill('竖图')
  await search.press('Enter')
  await page.getByText('读取当前请求失败，仍显示上一次结果', { exact: true }).waitFor()
  const staleLink = await missingActor.getByRole('link').getAttribute('href')
  const staleReturnTo = new URL(staleLink, origin).searchParams.get('returnTo')
  assert.equal(new URL(staleReturnTo, origin).searchParams.get('actorQuery'), '缺图')
  await missingActor.getByRole('link').click()
  await page.waitForURL(url => url.pathname === '/assets/actors/actor-missing/edit')
  await page.getByText('演员缺图', { exact: true }).waitFor()
  await page.getByRole('button', { name: '生成图片', exact: true }).and(page.locator(':enabled')).waitFor()
  failRead = undefined
  await page.goBack()
  await missingActor.getByRole('link').and(page.locator(':focus')).waitFor()
  assert.equal(await search.inputValue(), '缺图')
  failRead = 'actor'
  await search.fill('竖图')
  await search.press('Enter')
  await page.getByText('读取当前请求失败，仍显示上一次结果', { exact: true }).waitFor()
  failRead = undefined
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await card('演员竖图').waitFor()
  assert.equal(listRequests.at(-1).q, '竖图')
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
  await page.getByText('仍有关联引用', { exact: true }).waitFor()
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
  await search.fill(longName)
  await search.press('Enter')
  await card(longName).waitFor()

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
    assert.ok(await page.locator('.asset-library-grid').first().evaluate(node => {
      const style = getComputedStyle(node)
      const gutter = parseFloat(getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--app-page-gutter'))
      const sidebar = true && window.innerWidth >= 1024 ? 216 : 0
      const expectedWidth = document.documentElement.clientWidth - sidebar - 2 * gutter
      if (Math.abs(node.getBoundingClientRect().width - expectedWidth) > 17) return false
      const columns = style.gridTemplateColumns.split(' ').map(parseFloat)
      const used = columns.reduce((sum, size) => sum + size, 0) + (columns.length - 1) * parseFloat(style.columnGap)
      const remainder = node.getBoundingClientRect().width - used
      return Math.abs(remainder) < 1
    }), 'equal-width tracks fill the content area')
    if (width >= 1024) {
      const searchBounds = await box(search), createBounds = await box(primary)
      assert.ok(createBounds.x > searchBounds.x + searchBounds.width)
      assert.ok(Math.abs(createBounds.y + createBounds.height / 2 - searchBounds.y - searchBounds.height / 2) < 2)
    }
    await page.screenshot({ path: join(output, `assets-${width}.png`), animations: 'disabled' })
  }
  assert.equal(generationRequests, 0, 'asset library cards never submit image generation')
  assert.deepEqual(errors, [])
  console.log('Asset library covers, metadata, preview, recovery, deletion and responsive layout verified.')
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') })
  console.log('Browser evidence:', output)
  console.error(await page?.locator('body').innerText())
  throw error
} finally {
  await cleanup()
}
