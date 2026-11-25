import { openLabAddition } from './lab-composer-actions.mjs'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-lab-composer-')
const origin = 'http://127.0.0.1:4811'
const timestamp = '2026-11-11T00:00:00Z'
const modes = { text: '文本', image: '图片', video: '视频' }
const server = await createServer({ root, cacheDir: output + '/vite', server: { host: '127.0.0.1', port: 4811, strictPort: true, open: false } })
let browser
let longModels = false
let modelGate
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(6000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (url.pathname.endsWith('/experiment-sessions')) {
      const mode = url.searchParams.get('lab_type')
      return respond([{ id: mode, lab_type: mode, title: modes[mode] + '输入验收', created_at: timestamp, updated_at: timestamp }])
    }
    if (url.pathname.endsWith('/model-settings')) return respond({ default_text_model_id: 'model-2' })
    if (url.pathname.endsWith('/models')) { await modelGate; return respond({ items: Array.from({ length: 10 }, (_, i) => ({ id: 'model-' + i, name: longModels ? '很长的模型名称'.repeat(8) + i : '模型 ' + i, category: url.searchParams.get('category') })) }) }
    if (url.pathname.endsWith('/video-generation-options')) return respond({ model_id: url.searchParams.get('model_id'), allowed_ratios: ['16:9', '9:16'] })
    if (url.pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (url.pathname.endsWith('/files')) return respond({ items: Array.from({ length: 5 }, (_, i) => ({ id: 'file-' + i, type: 'image', name: '参考图 ' + i })) })
    if (url.pathname.endsWith('/download')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="240"><rect width="120" height="240" fill="steelblue"/></svg>' })
    if (url.pathname.endsWith('/prompts')) return respond({ items: [] })
    return respond([])
  })
  for (const mode of Object.keys(modes)) {
    await page.goto(origin + '/lab?session=' + mode)
    await page.getByRole('button', { name: mode === 'text' ? '已选模型' : '选择模型', exact: true }).click()
    const option = page.getByRole('menuitemradio', { name: '模型 0', exact: true })
    await option.waitFor()
    if (mode === 'text') assert.equal(await page.getByRole('menuitemradio', { name: '模型 2', exact: true }).getAttribute('aria-checked'), 'true')
    await page.getByRole('textbox', { name: '搜索模型', exact: true }).fill('模型 9')
    await page.getByRole('menuitemradio', { name: '模型 9', exact: true }).click()
    await page.getByRole('button', { name: '模型 9', exact: true }).and(page.locator(':focus')).waitFor()
    await page.getByRole('menuitemradio').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '添加内容', exact: true }).click()
    await page.getByRole('menuitem', { name: '选择提示词模板', exact: true }).waitFor()
    assert.equal(await page.getByRole('menuitem', { name: mode === 'image' ? '添加参考图' : '配置参考素材', exact: true }).count(), mode === 'text' ? 0 : 1)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '添加内容', exact: true }).and(page.locator(':focus')).waitFor()
    assert.equal(await page.getByRole('button', { name: /^发\s*送$/ }).count(), 1)
  }
  // A delayed first read still supports Escape and restores keyboard focus.
  let releaseModels
  modelGate = new Promise(resolve => { releaseModels = resolve })
  await page.goto(origin + '/lab?session=text')
  const loadingTrigger = page.getByRole('button', { name: '已选模型', exact: true })
  await loadingTrigger.click()
  await page.getByText('正在加载模型…', { exact: true }).waitFor()
  await loadingTrigger.press('Escape')
  await loadingTrigger.and(page.locator('[aria-expanded="false"]')).waitFor()
  releaseModels()
  modelGate = undefined
  await page.goto(origin + '/lab?session=image')
  await page.getByRole('button', { name: '添加内容', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加参考图', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '配置参考图', exact: true })
  await panel.getByRole('tab', { name: '资料库', exact: true }).click()
  for (let i = 0; i < 5; i++) await panel.getByRole('checkbox', { name: '参考图 ' + i, exact: true }).check()
  await panel.getByRole('button', { name: '应用参考图', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  const summary = page.getByRole('list', { name: '本轮参考图', exact: true })
  assert.equal(await summary.getByRole('button').count(), 3)
  const thumb = summary.getByRole('button', { name: '预览参考图：参考图 0', exact: true })
  const bounds = await thumb.boundingBox()
  assert.equal(bounds.width, 32)
  assert.equal(bounds.height, 32)
  const more = page.getByRole('button', { name: '查看全部 5 项素材', exact: true })
  assert.equal((await more.textContent()).trim(), '+2')
  assert.equal(await summary.getByRole('button', { name: /移除/ }).count(), 0)
  await thumb.click()
  const preview = page.getByRole('dialog', { name: '预览参考图：参考图 0', exact: true })
  await preview.getByRole('button', { name: '移除参考图', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  assert.equal((await page.getByRole('button', { name: '查看全部 4 项素材', exact: true }).textContent()).trim(), '+1')
  await page.screenshot({ path: output + '/image-summary.png' })
  await page.goto(origin + '/lab?session=video')
  await page.getByRole('button', { name: '添加内容', exact: true }).click()
  await page.getByRole('menuitem', { name: '配置参考素材', exact: true }).click()
  const videoPanel = page.getByRole('dialog', { name: '配置视频参考素材', exact: true })
  for (const role of ['首帧', '尾帧']) {
    await videoPanel.getByRole('button', { name: '选择' + role, exact: true }).click()
    await videoPanel.getByRole('button', { name: '参考图 0', exact: true }).click()
    await videoPanel.getByRole('button', { name: '返回已选素材', exact: true }).click()
  }
  await videoPanel.getByRole('button', { name: '添加主体', exact: true }).click()
  await videoPanel.getByRole('textbox', { name: '主体 1 名称', exact: true }).fill('海鸥')
  await videoPanel.getByRole('button', { name: '选择主体1图片', exact: true }).click()
  await videoPanel.getByRole('button', { name: '参考图 0', exact: true }).click()
  await videoPanel.getByRole('button', { name: '返回已选素材', exact: true }).click()
  await videoPanel.getByRole('button', { name: '应用参考素材', exact: true }).click()
  await videoPanel.waitFor({ state: 'hidden' })
  const videoSummary = page.getByRole('list', { name: '本轮参考素材', exact: true })
  await videoSummary.getByRole('button', { name: '预览首帧：参考图 0', exact: true }).waitFor()
  await videoSummary.getByRole('button', { name: '预览尾帧：参考图 0', exact: true }).click()
  const videoPreview = page.getByRole('dialog', { name: '预览参考素材：参考图 0', exact: true })
  await videoPreview.getByRole('button', { name: '移除本项参考素材', exact: true }).click()
  await videoPreview.waitFor({ state: 'hidden' })
  assert.equal(await videoSummary.getByRole('button', { name: '预览首帧：参考图 0', exact: true }).count(), 1)
  assert.equal(await videoSummary.getByRole('button', { name: '预览尾帧：参考图 0', exact: true }).count(), 0)
  await videoSummary.getByRole('button', { name: '预览主体 海鸥 · 第 1 项：参考图 0', exact: true }).click()
  await videoPreview.getByText('主体 海鸥 · 第 1 项：参考图 0', { exact: true }).waitFor()
  await videoPreview.getByRole('button', { name: /^(Close|关闭)$/ }).press('Escape')
  await videoPreview.waitFor({ state: 'hidden' })
  longModels = true
  for (const mode of Object.keys(modes)) {
    for (const theme of ['mist', 'solid']) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.evaluate(value => localStorage.setItem('jellyfish_appearance', value), theme)
      await page.goto(origin + '/lab?session=' + mode)
      await page.locator('.experiment-model-trigger').click()
      await page.getByRole('menuitemradio').first().click()
      if (mode === 'image') {
        await openLabAddition(page, '添加参考图')
        await panel.getByRole('tab', { name: '资料库', exact: true }).click()
        for (let i = 0; i < 5; i++) await panel.getByRole('checkbox', { name: '参考图 ' + i, exact: true }).check()
        await panel.getByRole('button', { name: '应用参考图', exact: true }).click()
        await panel.waitFor({ state: 'hidden' })
      }
      if (mode === 'video') {
        await openLabAddition(page, '配置参考素材')
        await videoPanel.getByRole('button', { name: '选择首帧', exact: true }).click()
        await videoPanel.getByRole('button', { name: '参考图 0', exact: true }).click()
        await videoPanel.getByRole('button', { name: '返回已选素材', exact: true }).click()
        await videoPanel.getByRole('button', { name: '应用参考素材', exact: true }).click()
        await videoPanel.waitFor({ state: 'hidden' })
      }
      for (const [width, height] of [[1440, 900], [1366, 768], [1024, 440], [600, 812], [375, 812]]) {
        await page.setViewportSize({ width, height })
        await page.getByRole('textbox', { name: modes[mode] + '提示词', exact: true }).fill('用于检查输入区布局。\n'.repeat(20))
        const send = page.getByRole('button', { name: /^发\s*送$/ })
        await send.scrollIntoViewIfNeeded()
        const geometry = await page.locator('.experiment-composer').evaluate(root => {
          const toolbar = root.querySelector('.experiment-composer-toolbar')
          const buttons = [...toolbar.querySelectorAll('button')].map(button => {
            const rect = button.getBoundingClientRect()
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
          })
          return { overflow: document.documentElement.scrollWidth > innerWidth || root.scrollWidth > root.clientWidth + 1,
            buttons, width: innerWidth, height: innerHeight }
        })
        assert.equal(geometry.overflow, false, mode + ' toolbar overflow at ' + width)
        assert.ok(geometry.buttons.every(button => button.left >= 0 && button.right <= geometry.width && button.top >= 0 && button.bottom <= geometry.height), mode + ' controls must be visible')
        assert.equal(new Set(geometry.buttons.map(button => Math.round(button.top))).size <= 2, true, 'toolbar stays in a single row')
        const backdrop = await page.getByRole('banner').evaluate(banner => getComputedStyle(banner.parentElement).backgroundImage)
        assert.equal(backdrop === 'none', theme === 'solid')
        if (mode === 'image') {
          assert.equal(await page.getByRole('list', { name: '本轮参考图', exact: true }).getByRole('button').count(), height <= 540 || width <= 480 ? 0 : width <= 767 ? 1 : 3)
        }
        await page.screenshot({ path: output + '/' + mode + '-' + theme + '-' + width + '.png' })
      }
    }
  }
  assert.deepEqual(errors, [])
  console.log('Lab composer selection and action layout verified.')
} finally { await cleanup() }
