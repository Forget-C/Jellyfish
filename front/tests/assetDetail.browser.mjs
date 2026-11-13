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
assets.character = { id:'a1', name:'项目角色档案', description:'角色简介', visual_style:'现实', style:'真人都市' }
slots.character = [{id:1,view_angle:'FRONT',file_id:'portrait'}]
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
    const match = path.match(/\/entities\/(actor|scene|prop|costume|character)\/a1(\/images)?$/)
    if (match) {
      const [, type, images] = match
      if (images) {
        if (request.method() === 'POST') {
          posts++
          if (failSlot) return fail()
          const row = { id: slots[type].length + 1, ...request.postDataJSON() }
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
  const save = page.getByRole('button', { name: '保存设定', exact: true })
  const enlarge=page.getByRole('button',{name:'放大正面图片 1',exact:true})
  await enlarge.and(page.locator(':enabled')).waitFor()
  await enlarge.focus()
  await page.keyboard.press('Enter')
  await page.locator('.ant-image-preview-wrap').waitFor()
  await page.waitForFunction(()=>document.activeElement?.closest('.ant-image-preview-wrap'))
  await page.keyboard.press('Escape')
  await page.locator('.ant-image-preview-wrap').waitFor({state:'hidden'})
  await name.fill('修改后的演员')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  const leave = page.getByRole('dialog', { name: '离开资产详情', exact: true })
  await leave.getByRole('button', { name: '继续编辑', exact: true }).and(page.locator(':focus')).waitFor()
  await page.keyboard.press('Escape')
  await leave.waitFor({ state: 'hidden' })
  assert.equal(await name.inputValue(), '修改后的演员')
  failSave = true
  await save.click()
  await page.getByRole('alert').filter({ hasText: '测试失败' }).waitFor()
  assert.equal(await name.inputValue(), '修改后的演员')
  failSave = false
  await save.click()
  await page.waitForFunction(() => !document.querySelector('.resource-editor-drawer .ant-btn-loading'))
  assert.equal(assets.actor.name, '修改后的演员')
  await page.getByRole('tab', { name: '侧面', exact: true }).first().click()
  await page.getByText('当前视角暂无图片', { exact: true }).first().waitFor()
  // Cancellation acknowledgement is not terminal, and failed cancellation remains retryable.
  await name.fill('检测时未保存的名称')
  await page.getByRole('button', { name: '智能检测', exact: true }).click()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  const detecting = page.getByRole('dialog', { name: '智能检测进行中', exact: true })
  await detecting.getByRole('button', { name: '取消检测', exact: true }).click()
  await detecting.getByText('取消检测失败，请重试或继续等待。', { exact: true }).waitFor()
  cancelFails = false
  await detecting.getByRole('button', { name: '取消检测', exact: true }).click()
  await detecting.getByRole('button', { name: '等待取消确认', exact: true }).waitFor()
  assert.equal(await name.inputValue(), '检测时未保存的名称')
  detectionStatus = 'cancelled'
  await leave.waitFor()
  await leave.getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.equal(cancelCalls, 2)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await leave.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await page.goto(origin + '/assets/actors/a1/edit')
  await name.waitFor()
  failHistory = true
  await page.getByRole('button', { name: '图片历史', exact: true }).first().click()
  await page.getByText('读取候选图片失败，请从图片历史重试', { exact: true }).waitFor()
  failHistory = false
  await page.getByRole('button', { name: '图片历史', exact: true }).first().click()
  await page.getByRole('button', { name: '加入视角文件夹', exact: true }).waitFor()
  const original = slots.actor[0].file_id
  await page.getByRole('button', { name: '加入视角文件夹', exact: true }).click()
  assert.equal(slots.actor[0].file_id, original, '历史采用追加图片，保留原图')
  assert.equal(posts, 1)
  // Initial read failure is explicit and recoverable.
  failAsset = true
  await page.goto(origin + '/assets/props/a1/edit')
  await page.getByRole('button', { name: '重试读取对象', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '保存设定', exact: true }).isDisabled(), true)
  failAsset = false
  await page.getByRole('button', { name: '重试读取对象', exact: true }).click()
  await name.and(page.locator(':enabled')).waitFor()
  for (const [type, path] of types) {
    for (const [width, height, theme] of [[1440, 900, 'mist'], [1366, 600, 'solid'], [1024, 768, 'solid'], [600, 812, 'mist'], [375, 812, 'solid']]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(value => localStorage.setItem('jellyfish_appearance', value), theme)
      await page.goto(origin + '/assets/' + path + '/a1/edit')
      await name.and(page.locator(':enabled')).waitFor()
      const dialog = page.getByRole('dialog', { name: assets[type].name, exact: true })
      await page.waitForFunction(expected => {
        const node=document.querySelector('.resource-editor-drawer .ant-drawer-content')
        return node && Math.abs(node.getBoundingClientRect().x-expected)<1
      }, width >= 1024 ? 216 : 0)
      const layout = await dialog.evaluate(node => ({
        x: node.getBoundingClientRect().x,
        overflow: node.scrollWidth > node.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
        titleSize: getComputedStyle(node.parentElement.querySelector('.ant-drawer-title')).fontSize,
      }))
      assert.equal(layout.overflow, false, type + ' horizontal overflow')
      assert.ok(Math.abs(layout.x - (width >= 1024 ? 216 : 0)) <= 1, '抽屉不覆盖桌面左侧菜单')
      assert.equal(layout.titleSize, '16px')
      if (width < 768) await dialog.getByRole('tab', { name: '图片', exact: true }).click()
      await dialog.getByRole('img', { name: '正面图片 1', exact: true }).waitFor()
      await dialog.getByRole('img', { name: '正面图片 1', exact: true }).evaluate(image => image.decode())
      await page.screenshot({ path: output + '/' + type + '-' + width + '.png' })
      await dialog.getByRole('button', { name: '关闭', exact: true }).scrollIntoViewIfNeeded()
      assert.equal(await dialog.getByRole('button', { name: '关闭', exact: true }).isVisible(), true)
    }
  }
  assets.actor.source_character_id = 'converted-role'
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(origin + '/assets/actors/a1/edit')
  await page.getByText('从角色转化 · 只读', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '名称', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '生成图片', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS drawer detail, save/leave recovery, analysis cancellation, history append, readonly and responsive layout')
} finally { await cleanup() }
