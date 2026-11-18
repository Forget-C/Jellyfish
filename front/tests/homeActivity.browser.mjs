import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-home-activity-')
const origin = 'http://127.0.0.1:4798'
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4798, strictPort: true, open: false } })
const list = items => ({ items, pagination: { total: items.length, page: 1, page_size: 10, total_pages: 1 } })
const project = { id: 'p1', name: '真实项目验收', style: '现实主义', progress: 85 }
const partialProject = { id: 'p2', name: '缺少场次信息的项目', style: '现实主义' }
const newProject = { id: 'p3', name: '尚未建章的项目', style: '现实主义' }
const chapter = { id: 'ch1', index: 2, project_id: 'p1', title: '第二章验收', raw_text: '', sequence_count: 0 }
const partialChapter = { id: 'ch2', index: 1, project_id: 'p2', title: '待确认章节' }
const session = { id: 'image1', lab_type: 'image', title: '真实图片会话', last_message_preview: '最后一条消息摘要', updated_at: '2026-11-10T10:30:00Z', created_at: '2026-11-09T10:00:00Z' }
const olderSessions = Array.from({ length: 5 }, (_, index) => ({
  ...session, id: 'older' + index, title: '更早会话 ' + index, updated_at: '2026-11-09T10:00:00Z',
}))
const updated_at = '2026-11-10T10:30:00Z'
const canvasRows = [
  { id: 'scene-canvas', kind: 'scene', name: '真实场次画布', project_name: project.name, cover_file_id: 'home-cover', updated_at },
  { id: 'free-canvas', kind: 'free', name: '真实生成画布', project_name: null, cover_file_id: null, updated_at },
]
const assetRows = ['actor', 'scene', 'prop', 'costume', 'actor', 'scene'].map((type, index) => ({
  id: String(index), type, name: '真实资产 ' + index, updated_at,
  thumbnail: index === 2 ? null : '/api/v1/studio/files/home-image/download',
}))
let state = 'loaded'
let failedHome = ''
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    const { pathname } = url
    const respond = data => route.fulfill({ json: { code: 200, data } })
    const fail = () => route.fulfill({ status: 503, json: { detail: '暂时不可用' } })
    if (pathname.endsWith('/recent-canvases')) return failedHome === 'canvases' ? fail() : respond(state === 'empty' ? [] : canvasRows)
    if (pathname.endsWith('/recent-assets')) return failedHome === 'assets' ? fail() : respond(state === 'empty' ? [] : assetRows)
    if (/\/files\/home-(?:image|cover)\/download$/.test(pathname)) return route.fulfill({
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6aYAAAAASUVORK5CYII=', 'base64'),
    })
    if (pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (pathname.endsWith('/projects')) {
      if (state === 'error') return fail()
      return respond(list(state === 'empty' ? [] : [project, partialProject, newProject]))
    }
    if (pathname.endsWith('/projects/p1')) return respond(project)
    if (pathname.endsWith('/chapters')) {
      const id = url.searchParams.get('project_id')
      if (state === 'partial-error' && id === 'p2') return fail()
      return respond(list(id === 'p1' ? [chapter] : id === 'p2' ? [partialChapter] : []))
    }
    if (pathname.endsWith('/chapters/ch1')) return respond(chapter)
    if (pathname.endsWith('/experiment-sessions')) {
      if (state === 'error') return fail()
      const type = url.searchParams.get('lab_type')
      if (state === 'partial-error' && type === 'text') return fail()
      return respond(state !== 'empty' && type === 'image' ? [session, ...olderSessions] : [])
    }
    if (pathname.endsWith('/messages')) return respond([])
    return respond(list([]))
  })

  await page.goto(origin)
  const progress = page.getByRole('region', { name: '项目进展', exact: true })
  const sessions = page.getByRole('region', { name: '最近实验室会话', exact: true })
  const canvases = page.getByRole('region', { name: '最近更新的画布', exact: true })
  const assets = page.getByRole('region', { name: '最近资产', exact: true })
  const assetCards = assets.getByRole('listitem')
  await page.getByRole('heading', { name: '工作概览', level: 1 }).waitFor({ state: 'attached' })
  await canvases.getByRole('heading', { name: canvasRows[0].name, exact: true }).waitFor()
  await canvases.getByText('独立画布', { exact: false }).waitFor()
  assert.equal(await canvases.getByRole('article').count(), 2)
  assert.equal(await canvases.getByText('示例数据', { exact: true }).count(), 0)
  const canvasHeading = await canvases.getByRole('heading').first().boundingBox()
  const main = await page.getByRole('main').boundingBox()
  assert.ok(canvasHeading.y - main.y <= 32, '首页首个可见区块应紧接页面顶栏')
  await progress.getByRole('link', { name: project.name, exact: true }).waitFor()
  await progress.getByText('第 2 章 · 第二章验收', { exact: true }).waitFor()
  assert.equal(await progress.getByRole('listitem').count(), 3)
  await progress.getByText('待补原文', { exact: true }).first().waitFor()
  assert.equal(await progress.getByText('85%').count(), 0)
  const example = progress.getByRole('region', { name: '项目进展示例', exact: true })
  await example.getByText('示例数据', { exact: true }).waitFor()
  assert.equal(await example.getByRole('link').count(), 0)
  assert.equal(await example.getByRole('button').count(), 0)
  await sessions.getByRole('link', { name: new RegExp(session.title) }).waitFor()
  await sessions.getByText(session.last_message_preview, { exact: false }).first().waitFor()
  assert.equal(await sessions.getByRole('listitem').count(), 3)
  for (const [label, mode] of [['新建文本实验', 'text'], ['新建图片实验', 'image'], ['新建视频实验', 'video']]) {
    assert.equal(await sessions.getByRole('link', { name: label }).getAttribute('href'), '/lab?mode=' + mode)
  }
  await sessions.getByRole('link', { name: '打开实验室' }).waitFor()
  assert.ok((await canvases.boundingBox()).y < (await progress.boundingBox()).y)
  assert.equal((await progress.boundingBox()).y, (await sessions.boundingBox()).y)
  const assetButton = assetCards.first().getByRole('button')
  const assetName = await assetButton.getAttribute('aria-label')
  await assetButton.focus()
  await page.keyboard.press('Enter')
  const preview = page.getByRole('dialog', { name: assetName, exact: true })
  await preview.getByText('演员', { exact: true }).waitFor()
  await preview.getByRole('img', { name: assetName, exact: true }).waitFor()
  await page.waitForFunction(() => document.activeElement?.closest('.home-asset-preview'))
  await page.keyboard.press('Escape')
  await preview.waitFor({ state: 'hidden' })
  await page.waitForFunction(name => document.activeElement?.getAttribute('aria-label') === name, assetName)
  assert.equal(await assets.getByRole('link', { name: '查看资产库' }).getAttribute('href'), '/assets')
  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080], [1024, 440]]) {
    await page.setViewportSize({ width, height })
    const left = await progress.boundingBox()
    const right = await sessions.boundingBox()
    assert.ok(Math.abs(left.width - right.width) <= 1 && left.height === right.height)
    assert.ok(await page.getByRole('main').evaluate(element => element.scrollHeight <= element.clientHeight + 1))
    for (const link of [progress.getByRole('link', { name: '查看全部项目' }), sessions.getByRole('link', { name: '打开实验室' })]) {
      const bounds = await link.boundingBox()
      assert.ok(bounds.y + bounds.height <= height)
    }
    if (height === 440) {
      const lastSession = sessions.getByRole('listitem').last()
      const footer = sessions.getByRole('link', { name: '打开实验室' })
      const footerBefore = await footer.boundingBox()
      await lastSession.scrollIntoViewIfNeeded()
      const last = await lastSession.boundingBox()
      assert.ok(last.y + last.height <= footerBefore.y)
      assert.deepEqual(await footer.boundingBox(), footerBefore)
      assert.equal(await page.getByRole('main').evaluate(element => element.scrollTop), 0)
      const openAssets = assets.getByRole('button', { name: '查看最近资产' })
      await openAssets.click()
      const drawer = page.getByRole('dialog').filter({ hasText: '最近资产' })
      await drawer.waitFor()
      assert.equal(await drawer.getByRole('listitem').count(), 6)
      const drawerCard = drawer.getByRole('listitem').last().getByRole('button')
      await drawerCard.click()
      const drawerPreview = page.getByRole('dialog', { name: await drawerCard.getAttribute('aria-label'), exact: true })
      await drawerPreview.getByText('场景', { exact: true }).waitFor()
      await drawerPreview.getByRole('button', { name: 'Close', exact: true }).click({ trial: true })
      await page.waitForFunction(() => document.activeElement?.closest('.home-asset-preview'))
      await page.keyboard.press('Escape')
      await drawerPreview.waitFor({ state: 'hidden' })
      assert.ok(await drawer.isVisible())
      await page.waitForFunction(() => document.activeElement?.matches('.home-assets-drawer .home-asset-card'))
      await page.keyboard.press('Escape')
      await drawer.waitFor({ state: 'hidden' })
      await page.waitForFunction(() => document.activeElement?.textContent.trim() === '查看最近资产')
    } else {
      assert.equal(await assets.getByText('示例数据', { exact: true }).count(), 0)
      assert.equal(await assets.getByRole('button', { name: '查看最近资产' }).count(), 0)
      const cards = await assetCards.all()
      assert.equal(cards.length, width === 1366 ? 4 : 6)
      const bounds = await Promise.all(cards.map(card => card.boundingBox()))
      assert.ok(bounds.every(card => card.y === bounds[0].y && card.y + card.height <= height))
      for (const panel of [progress, sessions]) {
        const list = panel.getByRole('list')
        const lastRow = await list.getByRole('listitem').last().boundingBox()
        const footer = await panel.getByRole('link', { name: /查看全部项目|打开实验室/ }).boundingBox()
        assert.ok(lastRow.y + lastRow.height <= footer.y)
      }
    }
    await page.screenshot({ path: output + '/' + width + 'x' + height + '-home.png', animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  const brokenImage = new URL(await assetButton.locator('img').getAttribute('src'), origin).href
  const failImage = route => route.abort()
  await page.route(brokenImage, failImage)
  await page.reload()
  await assetButton.getByText('暂无预览', { exact: true }).waitFor()
  await page.unroute(brokenImage, failImage)
  await page.reload()

  const edit = progress.getByRole('link', { name: '编辑原文', exact: true })
  await edit.focus()
  await page.keyboard.press('Enter')
  await page.waitForURL(url => url.pathname === '/projects/p1' && url.searchParams.get('edit') === 'ch1')
  await page.goto(origin)
  await sessions.getByRole('link', { name: new RegExp(session.title) }).click()
  await page.waitForURL(url => url.pathname === '/lab' && url.searchParams.get('session') === session.id)
  await page.goto(origin)
  for (const width of [1024, 480, 375]) {
    await page.setViewportSize({ width, height: 812 })
    await progress.getByRole('link', { name: project.name }).waitFor()
    if (width < 1024) assert.ok((await progress.boundingBox()).y < (await sessions.boundingBox()).y)
    if (width < 1024) {
      const cards = await assetCards.all()
      assert.equal(cards.length, 6)
      const [first, second] = await Promise.all(cards.slice(0, 2).map(card => card.boundingBox()))
      assert.equal(first.y === second.y, width === 480)
      await assets.getByText('暂无预览', { exact: true }).waitFor()
    }
    assert.ok(await page.getByRole('main').evaluate(element => element.scrollWidth <= element.clientWidth + 2))
    await page.screenshot({ path: output + '/' + width + '-home.png', animations: 'disabled' })
  }

  await canvases.getByRole('heading', { name: canvasRows[0].name, exact: true }).waitFor()
  for (const [failure, region, other, otherText] of [
    ['canvases', canvases, assets, assetRows[0].name],
    ['assets', assets, canvases, canvasRows[0].name],
  ]) {
    failedHome = failure
    await page.reload()
    await region.getByRole('alert').waitFor()
    await other.getByText(otherText, { exact: true }).waitFor()
    failedHome = ''
    await region.getByRole('button', { name: '重试' }).click()
    await region.getByRole('alert').waitFor({ state: 'hidden' })
    await region.getByText(failure === 'assets' ? assetRows[0].name : canvasRows[0].name, { exact: true }).waitFor()
  }

  state = 'empty'
  await page.reload()
  await canvases.getByText('暂无画布', { exact: true }).waitFor()
  await assets.getByText('暂无资产', { exact: true }).waitFor()
  await progress.getByText('暂无项目', { exact: true }).waitFor()
  await sessions.getByText('暂无实验室会话', { exact: true }).waitFor()
  state = 'partial-error'
  await page.reload()
  await progress.getByText('读取章节失败', { exact: true }).waitFor()
  await sessions.getByText('部分实验室会话读取失败', { exact: true }).waitFor()
  await sessions.getByRole('link', { name: new RegExp(session.title) }).waitFor()
  state = 'error'
  await page.reload()
  await progress.getByText('读取项目失败', { exact: true }).waitFor()
  await sessions.getByText('读取实验室会话失败', { exact: true }).waitFor()
  assert.equal(await example.count(), 0)
  state = 'loaded'
  await progress.getByRole('button', { name: '重试', exact: true }).click()
  await sessions.getByRole('button', { name: '重试', exact: true }).click()
  await progress.getByRole('link', { name: project.name }).waitFor()
  await sessions.getByRole('link', { name: new RegExp(session.title) }).waitFor()
  console.log('Home activity layout, live links, samples, empty states and retry verified.')
} finally {
  await cleanup()
}
