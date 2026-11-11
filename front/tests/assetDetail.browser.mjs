import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-asset-detail-')
const origin = 'http://127.0.0.1:4810'
const server = await createServer({ root, cacheDir: output + '/vite-cache', server: { host: '127.0.0.1', port: 4810, strictPort: true, open: false } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
const types = [['actor', 'actors', '演员'], ['scene', 'scenes', '场景'], ['prop', 'props', '道具'], ['costume', 'costumes', '服装']]
const assets = Object.fromEntries(types.map(([type, , label]) => [type, { id: 'a1', name: label + '档案', supplementary_info: '原始描述', tags: [], view_count: 1, visual_style: '现实', style: '真人都市' }]))
const slots = Object.fromEntries(types.map(([type]) => [type, [{ id: 1, view_angle: 'FRONT', file_id: type === 'scene' ? 'landscape' : 'portrait' }]]))
let failSave = false, failSlot = false, failImages = false, failAsset = false, missingAsset = false
let failHistory = false, adoptions = 0
let generationStatus, statusReads = 0, generationCalls = 0
let patches = 0, posts = 0
let detectionStatus, cancelFails = true, cancelRequested = false, cancelCalls = 0
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data } })
    const list = items => respond({ items, pagination: { total: items.length, page: 1, page_size: 100 } })
    const fail = () => route.fulfill({ status: 503, json: { detail: '测试失败' } })
    if (path.endsWith('/files/broken/download')) return route.fulfill({ status: 404 })
    if (/\/files\/(portrait|new-portrait|history|landscape)\/download$/.test(path)) return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${path.includes('landscape') ? 960 : 240}" height="480"><rect width="100%" height="100%" fill="#6f91b5"/></svg>` })
    if (path.endsWith('/analyze-character-portrait-async')) {
      detectionStatus = 'running'
      cancelRequested = false
      return respond({ task_id: 'detect', status: detectionStatus })
    }
    if (path.endsWith('/film/tasks/detect/status')) return respond({ task_id: 'detect', status: detectionStatus, stage: '', progress: 0, cancel_requested: cancelRequested })
    if (path.endsWith('/film/tasks/detect/cancel')) {
      cancelCalls++
      if (cancelFails) return fail()
      cancelRequested = true
      return respond({ task_id: 'detect', status: detectionStatus, cancel_requested: true, effective_immediately: false })
    }
    if (path.endsWith('/film/tasks/detect/result')) return respond({ status: detectionStatus })
    if (path.endsWith('/generation-prompts/assets/actor/a1/slots/1/render')) return respond({ render_id: 'render-1', execution_prompt: '生成演员测试图', variables_snapshot: {}, recommended_media: { references: [] } })
    if (path.endsWith('/generation-tasks/actors/a1/slots/1/tasks')) {
      generationCalls++
      generationStatus = 'running'
      return respond({ task_id: 'generated' })
    }
    if (path.endsWith('/film/tasks/generated/status')) { statusReads++; return fail() }
    if (path.endsWith('/film/tasks')) {
      const target = new URL(request.url()).searchParams.get('target_type')
      if (target?.includes('analysis')) return respond({ items: [], next_cursor: null })
      if (generationStatus === 'succeeded') slots.actor[0].file_id = 'new-portrait'
      return respond({ items: generationStatus ? [{ task_id: 'generated', status: generationStatus, stage: '', task_kind: 'image', title: '图片生成', source: { kind: 'actor', id: 'a1', title: '演员' }, target_type: 'actor_image_slot', target_id: '1', created_at_ts: 1, updated_at_ts: 2 }] : [], next_cursor: null })
    }
    if (path.endsWith('/style-options')) return respond({ visual_styles: ['现实', '动漫'], styles: ['真人都市'] })
    if (path.endsWith('/entities/actor/a1/images/1') && request.method() === 'PATCH') {
      adoptions++
      Object.assign(slots.actor[0], request.postDataJSON())
      return respond(slots.actor[0])
    }
    const match = path.match(/\/entities\/(actor|scene|prop|costume)\/a1(\/images)?$/)
    if (match) {
      const [, type, images] = match
      if (images) {
        if (request.method() === 'POST') {
          posts++
          if (failSlot) return fail()
          const row = { id: slots[type].length + 1, view_angle: request.postDataJSON().view_angle, file_id: null }
          slots[type].push(row)
          return respond(row)
        }
        return failImages ? fail() : list(slots[type])
      }
      if (request.method() === 'PATCH') {
        patches++
        if (failSave) return fail()
        Object.assign(assets[type], request.postDataJSON())
        return respond(assets[type])
      }
      if (failAsset) return fail()
      if (missingAsset) return route.fulfill({ status: 404, json: { detail: '资产不存在' } })
      return respond(assets[type])
    }
    if (path.endsWith('/film/tasks/outputs')) return failHistory ? fail() : respond({ items: [{ task_id: 'old', ordinal: 1, file_id: 'history' }], next_cursor: null })
    return list([])
  })
  await page.goto(origin + '/assets/actors/a1/edit')
  const name = page.getByRole('textbox', { name: '名称', exact: true })
  await name.waitFor()
  const save = page.getByRole('button', { name: '保存资产', exact: true })
  await page.getByRole('button', { name: '放大当前视角图片', exact: true }).waitFor()
  assert.equal(await page.getByRole('navigation', { name: '当前位置' }).count(), 0)
  await name.fill('修改后的演员')
  assert.equal(await page.getByRole('button', { name: '重新生成', exact: true }).isEnabled(), false)
  assert.equal(await page.getByRole('button', { name: '刷新', exact: true }).isEnabled(), false)
  await page.getByRole('link', { name: '首页', exact: true }).click()
  const leave = page.getByRole('dialog', { name: '离开资产详情', exact: true })
  await leave.getByRole('button', { name: '继续编辑', exact: true }).and(page.locator(':focus')).waitFor()
  await page.keyboard.press('Escape')
  await leave.waitFor({ state: 'hidden' })
  assert.equal(await name.inputValue(), '修改后的演员')
  failSave = true
  await save.click()
  await page.getByText('保存失败，修改已保留，请重试。', { exact: true }).waitFor()
  assert.equal(await name.inputValue(), '修改后的演员')
  failSave = false
  await page.getByRole('spinbutton', { name: '视角数', exact: true }).fill('2')
  failSlot = true
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await leave.getByRole('button', { name: '保存并离开', exact: true }).click()
  await leave.getByText('档案已保存，图片视角准备未完成。离开不会撤销已保存的档案。', { exact: true }).waitFor()
  assert.ok(page.url().endsWith('/assets/actors/a1/edit'))
  assert.equal(await leave.getByRole('button', { name: '放弃修改并离开', exact: true }).count(), 0)
  const patchCount = patches
  failSlot = false
  await leave.getByRole('button', { name: '重试视角准备并离开', exact: true }).click()
  await page.waitForURL(origin + '/')
  assert.equal(patches, patchCount, '准备视角重试不重复保存已确认的档案')
  assert.equal(posts, 2)
  await page.goto(origin + '/assets/actors/a1/edit')
  await name.waitFor()
  assert.equal(await name.inputValue(), '修改后的演员')
  await page.getByRole('button', { name: '切换到左侧视角', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '放大当前视角图片', exact: true }).count(), 0)
  await page.getByText('暂无图片', { exact: true }).first().waitFor()
  // Cancel acknowledgement is not terminal; failed cancellation stays recoverable.
  await name.fill('检测时未保存的名称')
  await page.getByRole('button', { name: '智能检测', exact: true }).click()
  await page.getByRole('link', { name: '首页', exact: true }).click()
  const detecting = page.getByRole('dialog', { name: '智能检测进行中', exact: true })
  await detecting.getByRole('button', { name: '取消检测', exact: true }).click()
  await detecting.getByText('取消检测失败，请重试或继续等待。', { exact: true }).waitFor()
  cancelFails = false
  await detecting.getByRole('button', { name: '取消检测', exact: true }).click()
  await detecting.getByRole('button', { name: '等待取消确认', exact: true }).waitFor()
  assert.equal(await name.inputValue(), '检测时未保存的名称')
  assert.equal(await detecting.getByRole('button', { name: '保存并离开', exact: true }).count(), 0)
  detectionStatus = 'cancelled'
  await leave.waitFor()
  await leave.getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.equal(await name.inputValue(), '检测时未保存的名称')
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await leave.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await page.waitForURL(origin + '/')
  assert.equal(cancelCalls, 2)
  // Retry is a refresh too: it must not overwrite edits made after a failed read.
  await page.goto(origin + '/assets/actors/a1/edit')
  await name.waitFor()
  failAsset = true
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText('刷新资产失败，保留已显示内容', { exact: true }).waitFor()
  await name.fill('刷新失败后继续编辑')
  assert.equal(await page.getByRole('button', { name: '重试读取资产', exact: true }).isEnabled(), false)
  failAsset = false
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await leave.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await page.waitForURL(origin + '/')
  // A failed local poll must yield to the canonical task terminal state.
  await page.goto(origin + '/assets/actors/a1/edit')
  await name.waitFor()
  await page.getByRole('button', { name: '重新生成', exact: true }).click()
  const prompt = page.getByRole('dialog', { name: '提示词内容预览', exact: true })
  await prompt.getByRole('button', { name: /^生\s*成$/ }).click()
  await page.waitForResponse(response => response.url().endsWith('/film/tasks/generated/status'))
  await prompt.getByRole('button', { name: /^取\s*消$/ }).click()
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await page.waitForURL(origin + '/')
  await page.goto(origin + '/assets/actors/a1/edit')
  await page.getByText('图片生成中', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '重新生成', exact: true }).isEnabled(), false)
  await name.fill('生成期间新增编辑')
  generationStatus = 'succeeded'
  await page.locator('.asset-detail-images img').first().and(page.locator('[src*="new-portrait"]')).waitFor()
  assert.equal(await name.inputValue(), '生成期间新增编辑')
  await save.click()
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor()
  assert.equal(await page.getByRole('button', { name: '重新生成', exact: true }).isEnabled(), true)
  assert.equal(generationCalls, 1)
  assert.ok(statusReads >= 1)
  generationStatus = undefined
  // History failure is distinct from empty history; dirty forms can browse but not adopt.
  failHistory = true
  await page.getByRole('button', { name: '历史图片', exact: true }).click()
  const history = page.getByRole('dialog', { name: '历史生成图片', exact: true })
  await history.getByText('读取历史图片失败', { exact: true }).waitFor()
  failHistory = false
  await history.getByRole('button', { name: '重试历史图片', exact: true }).click()
  await history.getByRole('button', { name: '用于当前视角', exact: true }).waitFor()
  await history.getByRole('button', { name: 'Close', exact: true }).click()
  await history.waitFor({ state: 'hidden' })
  await name.fill('浏览历史时的草稿')
  await page.getByRole('button', { name: '历史图片', exact: true }).click()
  assert.equal(await history.getByRole('button', { name: '用于当前视角', exact: true }).isEnabled(), false)
  await history.getByRole('button', { name: 'Close', exact: true }).click()
  await history.waitFor({ state: 'hidden' })
  await save.click()
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor()
  await page.getByRole('button', { name: '历史图片', exact: true }).click()
  await history.getByRole('button', { name: '用于当前视角', exact: true }).click()
  await history.waitFor({ state: 'hidden' })
  await page.locator('.asset-detail-images img[src*="history"]').first().waitFor()
  assert.equal(adoptions, 1)
  assert.equal(await name.inputValue(), '浏览历史时的草稿')
  // Four types, both themes, wide/short/narrow screens: one body scroll and reachable controls.
  for (const [type, path] of types) {
    for (const [width, height, theme] of [[1440, 900, 'mist'], [1366, 600, 'solid'], [1024, 768, 'solid'], [600, 812, 'mist'], [375, 812, 'solid']]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(value => localStorage.setItem('jellyfish_appearance', value), theme)
      await page.goto(origin + '/assets/' + path + '/a1/edit')
      await name.waitFor()
      const backdrop = await page.getByRole('banner').evaluate(banner => getComputedStyle(banner.parentElement).backgroundImage)
      assert.equal(backdrop === 'none', theme === 'solid')
      const enlarge = page.getByRole('button', { name: '放大当前视角图片', exact: true })
      await enlarge.waitFor()
      await name.and(page.locator(':enabled')).waitFor()
      const layout = await page.locator('.asset-library-detail').evaluate(root => {
        const toolbar = root.querySelector('.asset-detail-toolbar').getBoundingClientRect()
        const body = root.querySelector('.asset-dossier-body')
        const overview = root.querySelector('.asset-dossier-overview').getBoundingClientRect()
        const image = root.querySelector('.asset-detail-images').getBoundingClientRect()
        return { width: root.clientWidth, toolbarHeight: toolbar.height, sideBySide: image.left >= overview.right,
          bodyOverflow: body.scrollWidth > body.clientWidth + 1, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          sticky: getComputedStyle(root.querySelector('.asset-detail-images')).position,
          imageHeight: image.height, bodyHeight: body.clientHeight,
          titleSize: getComputedStyle(root.querySelector('.app-page-title')).fontSize }
      })
      assert.equal(layout.sideBySide, layout.width >= 1000, type + ' split follows available content width')
      assert.equal(layout.bodyOverflow || layout.documentOverflow, false, type + ' horizontal overflow')
      assert.equal(layout.titleSize, '16px')
      if (layout.width > 600) assert.ok(layout.toolbarHeight <= 56, 'compact toolbar')
      if (layout.imageHeight + 40 > layout.bodyHeight) assert.notEqual(layout.sticky, 'sticky', 'short screen must not trap image actions')
      await page.screenshot({ path: output + '/' + type + '-' + width + '-top.png' })
      await page.getByRole('spinbutton', { name: '视角数', exact: true }).scrollIntoViewIfNeeded()
      assert.equal(await page.getByRole('spinbutton', { name: '视角数', exact: true }).isVisible(), true)
      await page.screenshot({ path: output + '/' + type + '-' + width + '.png' })
      if (width === 1440) {
        await enlarge.focus()
        await page.keyboard.press('Enter')
        const preview = page.getByRole('dialog', { name: / · 正面$/ })
        await preview.waitFor()
        assert.equal(await preview.locator('img').first().evaluate(image => getComputedStyle(image).objectFit), 'contain')
        await preview.getByRole('button', { name: 'Close', exact: true }).focus()
        await page.keyboard.press('Escape')
        await preview.waitFor({ state: 'hidden' })
        await enlarge.and(page.locator(':focus')).waitFor()
      }
    }
  }
  // Initial read failures, independent image failures, and broken media have different recovery paths.
  await page.setViewportSize({ width: 1440, height: 900 })
  failAsset = true
  await page.goto(origin + '/assets/actors/a1/edit')
  await page.getByText('读取资产失败', { exact: true }).waitFor()
  failAsset = false
  await page.getByRole('button', { name: '重试读取资产', exact: true }).click()
  await name.waitFor()
  missingAsset = true
  await page.goto(origin + '/assets/scenes/a1/edit')
  await page.getByRole('button', { name: '返回资产库', exact: true }).waitFor()
  assert.equal(await name.count(), 0)
  missingAsset = false
  failImages = true
  await page.goto(origin + '/assets/actors/a1/edit')
  await page.getByText('读取图片失败，档案内容已保留', { exact: true }).waitFor()
  await name.fill('图片失败后编辑')
  failImages = false
  await page.getByRole('button', { name: '重试读取图片', exact: true }).click()
  await page.getByRole('button', { name: '放大当前视角图片', exact: true }).waitFor()
  assert.equal(await name.inputValue(), '图片失败后编辑')
  await save.click()
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor()
  slots.actor[0].file_id = 'broken'
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText('图片加载失败', { exact: true }).first().waitFor()
  assert.equal(await page.getByRole('button', { name: '放大当前视角图片', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('Asset detail: four types, themes, responsive layout, image actions, save/leave and task recovery verified.')
} finally { await cleanup() }
