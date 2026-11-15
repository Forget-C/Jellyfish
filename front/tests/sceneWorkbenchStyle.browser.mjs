import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { closeWorkbenchDetails } from './workbenchControls.mjs'
import { checkWorkbenchStyleDetails } from './workbenchStyleDetails.mjs'
import { selectWorkbenchOption, workbenchShot, directorObject, directorSelect } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-workbench-style-')
const api = 'http://127.0.0.1:8193'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: process.env.UV_CACHE_DIR || '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193', SCENE_BROWSER_TEST_LEGACY_TAKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
captureBackend(backend, output)
const errors = [], measurements = []
async function menu(name) {
  const trigger = page.getByRole('button', { name, exact: true })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
}
async function locate(name) {
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
async function screenshot(name) {
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))) })
  await page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' })
}
async function checkChrome(name) {
  const measured = await page.evaluate(() => {
    const root = document.querySelector('.canvas-workbench')
    const toolbar = root.querySelector('.canvas-workbench-toolbar')
    const viewport = [...root.querySelectorAll('.director-canvas-surface')].find(element => element.getClientRects().length)
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    return { width: innerWidth, height: innerHeight, background: getComputedStyle(root).backgroundColor,
      toolbar: rect(toolbar), viewport: rect(viewport),
      buttons: [...toolbar.querySelectorAll('button')].filter(button => button.getClientRects().length && !button.closest('[hidden]')).map(button => ({ label: button.getAttribute('aria-label') || button.textContent, ...rect(button) })),
      card: getComputedStyle(root.querySelector('.canvas-workbench-card')).backgroundColor }
  })
  assert.equal(measured.background, 'rgb(13, 13, 13)')
  assert.equal(measured.card, 'rgb(27, 27, 27)')
  assert.ok(measured.viewport.y >= measured.toolbar.y + measured.toolbar.height, '画布从工具栏下方开始')
  for (const button of measured.buttons) {
    assert.ok(button.x >= -1 && button.x + button.width <= measured.width + 1, `${name}: ${button.label} 超出视口`)
  }
  for (let index = 0; index < measured.buttons.length; index++) {
    const a = measured.buttons[index]
    for (const b of measured.buttons.slice(index + 1)) {
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      assert.ok(overlapX <= 1 || overlapY <= 1, `${name}: ${a.label} 与 ${b.label} 重叠`)
    }
  }
  measurements.push({ name, ...measured })
}
try {
  let chapter
  for (let attempt = 0; attempt < 100; attempt++) {
    if (backend.exitCode !== null) throw new Error(backendOutput)
    try {
      const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`)
      if (response.ok) { chapter = (await response.json()).data; break }
    } catch { /* Wait for the isolated backend. */ }
    await delay(250)
  }
  assert.ok(chapter, backendOutput)
  const sequenceId = chapter.sequences[0].id
  const versionsUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/versions`
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message) })
  page.on('response', response => { if (response.status() >= 400) console.error('HTTP ERROR', response.status(), response.url()) })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const url = `http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}`
  await page.goto(url)
  await page.getByRole('button', { name: '版本管理', exact: true }).waitFor()
  await menu('版本管理')
  await page.getByRole('button', { name: '新建场次版本', exact: true }).click()
  await page.locator('[data-layout-view="overview"]').waitFor()
  await page.getByRole('button', { name: '展开关系树', exact: true }).waitFor()
  assert.equal(await page.locator('.scene-relations-tree-content').count(), 0)
  await checkChrome('empty-director')
  await screenshot('empty-director')
  await page.getByRole('button', { name: 'AI 设计', exact: true }).click()
  const ai = page.getByRole('dialog', { name: 'AI 设计', exact: true })
  await ai.getByRole('button', { name: '生成场次设计', exact: true }).waitFor()
  assert.equal(await ai.getByRole('button', { name: '调整部分设计', exact: true }).count(), 0)
  assert.equal(await ai.getByRole('button', { name: '展开原文', exact: true }).count(), 0)
  await ai.getByRole('button', { name: '只设计部分内容', exact: true }).click()
  assert.equal(await ai.getByRole('button', { name: '生成所选内容', exact: true }).isDisabled(), true)
  await ai.getByRole('button', { name: '整场设计', exact: true }).click()
  await ai.getByRole('textbox', { name: '设计要求（可选）', exact: true }).fill('保留关闭前的要求')
  await ai.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: 'AI 设计', exact: true }).click()
  assert.equal(await ai.getByRole('textbox', { name: '设计要求（可选）', exact: true }).inputValue(), '保留关闭前的要求')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    const submit = ai.getByRole('button', { name: '生成场次设计', exact: true })
    await submit.click({ trial: true })
    const bounds = await submit.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= (width === 390 ? 844 : 960))
    await screenshot(`ai-prepare-${width}`)
  }
  await ai.getByRole('button', { name: '取消', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 960 })
  const version = (await (await fetch(versionsUrl)).json()).data[0]
  const versionRoute = '**/versions'
  await page.route(versionRoute, async route => {
    const response = await route.fetch()
    const data = await response.json()
    data.data.find(row => row.id === version.id).content.basis.text = '长原文验证：他把旧信放在桌上，她缓缓抬头。'.repeat(100)
    await route.fulfill({ response, json: data })
  })
  await page.reload()
  await page.getByRole('button', { name: 'AI 设计', exact: true }).click()
  await ai.getByRole('button', { name: '展开原文', exact: true }).click()
  assert.equal(await ai.locator('.scene-ai-source-text').count(), 1)
  assert.equal(await ai.locator('.scene-ai-source .is-collapsed').count(), 0)
  const scrollStyle = await ai.locator('.ant-modal-body').evaluate(node => ({ gutter: getComputedStyle(node).scrollbarGutter, color: getComputedStyle(node).scrollbarColor, height: node.clientHeight, content: node.scrollHeight }))
  assert.equal(scrollStyle.gutter, 'stable')
  assert.equal(scrollStyle.color, 'rgb(80, 80, 80) rgba(0, 0, 0, 0)')
  assert.ok(scrollStyle.content > scrollStyle.height)
  await ai.locator('.ant-modal-body').evaluate(node => { node.scrollTop = 180 })
  await screenshot('ai-long-source')
  await ai.getByRole('button', { name: '收起原文', exact: true }).click()
  assert.equal(await ai.locator('.scene-ai-source .is-collapsed').count(), 1)
  await ai.getByRole('button', { name: '取消', exact: true }).click()
  await page.unroute(versionRoute)
  const content = version.content
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'style', version: '1' }] })
  content.design.direction.viewpoint = note('从她的视点观察旧信，保留停顿和目光中的犹豫。'.repeat(18))
  content.design.direction.shots = Array.from({ length: 12 }, (_, index) => ({ id: `shot-${index + 1}`, beat_ids: [], event_ids: [], blocking_state_ids: [], criterion_ids: [], narrative_function: {}, visible_result: note(index === 0 ? '他把旧信放在桌上，她缓缓抬头。' : `镜头 ${index + 1}：视线和动作继续展开。`) }))
  content.units = [{ id: 'unit-1', ratio: '16:9', duration_ms: 6000, model_id: 'browser-video-model', instruction: '保持人物视线连续，镜头从旧信缓缓抬起。'.repeat(40), coverage: [{ id: 'coverage-1', shot_id: 'shot-1', action_scope: '放下旧信，停顿后抬头' }] }]
  content.timeline.items = [{ id: 'planned-1', kind: 'planned', shot_id: 'shot-1', estimated_duration_ms: 6000, timeline_start_ms: 0 }]
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.reload()
  await directorObject(page, '全场叙事与约束')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await menu('保存设置')
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '展开叙事视点', exact: true }).count(), 0)
  assert.match(await page.locator('[data-canvas-node="overview"]').innerText(), /从她的视点观察旧信/)
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.revision, 2, '阅读摘要不保存业务内容')
  const transform = () => page.locator('.director-canvas-surface:visible .director-canvas-content').evaluate(content => content.style.transform)
  const originalTransform = await transform()
  await directorObject(page, '全场叙事与约束')
  await page.getByRole('textbox', { name: '观察视点', exact: true }).fill('浮层切换保留未保存的观察视点')
  const detail = page.getByRole('complementary', { name: '全场叙事与约束', exact: true })
  await detail.waitFor()
  const editor = detail.getByRole('textbox', { name: '观察视点', exact: true })
  await editor.focus()
  await detail.getByRole('button', { name: '展开详情', exact: true }).click()
  assert.equal(await editor.inputValue(), '浮层切换保留未保存的观察视点')
  assert.equal(await detail.getAttribute('aria-modal'), null, '桌面详情不锁定画布')
  assert.equal(await transform(), originalTransform, '展开详情不移动视角')
  await detail.getByRole('button', { name: '收起详情', exact: true }).click()
  const cardMenu = page.getByRole('button', { name: '更多操作：全场叙事与约束', exact: true })
  await cardMenu.click()
  const popup = page.getByRole('menu')
  await popup.waitFor()
  await page.keyboard.press('Escape')
  await popup.waitFor({ state: 'hidden', timeout: 2000 })
  assert.equal(await detail.isVisible(), true, '第一次 Escape 只关闭画布菜单，不穿透关闭详情')
  assert.equal(await cardMenu.evaluate(node => document.activeElement === node), true, '菜单关闭后恢复到菜单入口')
  assert.equal(await editor.inputValue(), '浮层切换保留未保存的观察视点')
  assert.equal(await transform(), originalTransform, '关闭菜单不移动画布')
  await page.keyboard.press('Escape')
  await detail.waitFor({ state: 'hidden' })
  await directorObject(page, '全场叙事与约束')
  assert.equal(await editor.inputValue(), '浮层切换保留未保存的观察视点', '关闭详情后重开保留未保存输入')
  await page.getByRole('button', { name: 'AI 设计', exact: true }).click()
  const overlay = page.getByRole('dialog', { name: 'AI 设计', exact: true })
  await overlay.waitFor()
  await page.waitForFunction(() => document.querySelector('.wb-details:not([hidden])')?.inert === true)
  await overlay.locator('.ant-modal-close').click()
  await page.waitForFunction(() => document.querySelector('.wb-details:not([hidden])')?.inert === false)
  assert.equal(await editor.inputValue(), '浮层切换保留未保存的观察视点', '操作弹窗保留底层输入')
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileDetail = page.getByRole('dialog', { name: '全场叙事与约束', exact: true })
  await mobileDetail.waitFor()
  const bounds = await mobileDetail.boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, '窄屏详情保留边距且不越界')
  assert.equal(await mobileDetail.getAttribute('aria-modal'), 'true')
  await mobileDetail.getByRole('button', { name: '关闭详情', exact: true }).focus()
  await page.keyboard.press('Tab')
  assert.equal(await mobileDetail.evaluate(node => node.contains(document.activeElement)), true, '窄屏焦点保留在详情')
  await page.keyboard.press('Escape')
  await mobileDetail.waitFor({ state: 'hidden' })
  const mobileOpener = page.getByRole('button', { name: '查看节点：全场叙事与约束', exact: true })
  await mobileOpener.focus()
  await page.keyboard.press('Enter')
  await mobileDetail.waitFor()
  assert.equal(await mobileDetail.getByRole('textbox', { name: '观察视点', exact: true }).inputValue(), '浮层切换保留未保存的观察视点')
  await page.keyboard.press('Escape')
  await mobileDetail.waitFor({ state: 'hidden' })
  assert.equal(await mobileOpener.evaluate(node => document.activeElement === node), true, '窄屏 Escape 关闭详情后回到实际打开入口')
  await page.keyboard.press('Enter')
  await mobileDetail.waitFor()
  assert.equal(await mobileDetail.getByRole('textbox', { name: '观察视点', exact: true }).inputValue(), '浮层切换保留未保存的观察视点', '窄屏关闭与键盘重开不丢草稿')
  await screenshot('design-details-390')
  await page.setViewportSize({ width: 1440, height: 960 })
  assert.equal(await transform(), originalTransform, '打开编辑浮层不移动视角')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await directorObject(page, '全场叙事与约束')
  assert.equal(await page.getByRole('textbox', { name: '观察视点', exact: true }).inputValue(), content.design.direction.viewpoint.text)
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await directorObject(page, '全场叙事与约束')
  assert.equal(await page.getByRole('textbox', { name: '观察视点', exact: true }).inputValue(), '浮层切换保留未保存的观察视点')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '展开关系树', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '观察视点', exact: true }).count(), 0)
  assert.equal(await transform(), originalTransform, '切换到关系树不移动视角')
  await page.getByRole('button', { name: '收起关系树', exact: true }).click()
  await directorObject(page, '全场叙事与约束')
  assert.equal(await page.getByRole('textbox', { name: '观察视点', exact: true }).inputValue(), '浮层切换保留未保存的观察视点')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  assert.equal(await transform(), originalTransform, '关闭浮层不移动视角')
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.design.direction.viewpoint.text, content.design.direction.viewpoint.text)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor()
  const design = await directorObject(page, '空间规则')
  const designBounds = await design.boundingBox()
  assert.ok(designBounds.width >= 300 && designBounds.x + designBounds.width <= 1440)
  await screenshot('design-modal')
  await design.getByRole('button', { name: '关闭详情', exact: true }).click()
  await (await workbenchShot(page, '镜头 2：镜头 2：视线和动作继续展开。')).click()
  await (await workbenchShot(page, '镜头 1：他把旧信放在桌上，她缓缓抬头。')).click()
  assert.equal(await page.getByRole('dialog').count(), 0, '选择镜头只切换查看上下文')
  for (const width of [1920, 1440, 1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    for (const [key, name] of [['director', '导演画布'], ['units', '单元画布'], ['instructions', '指令画布'], ['edit', '编辑画布']]) {
      await page.getByRole('navigation', { name: '画布切换', exact: true }).getByRole('button', { name, exact: true }).click()
      if (key === 'units') await selectWorkbenchOption(page, '当前单元', '单元 1')
      if (key === 'director') { await closeWorkbenchDetails(page); await directorSelect(page, '设计域', '导演画布'); await closeWorkbenchDetails(page) }
      if (key === 'edit' && await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).count()) {
        await page.getByLabel('整场剪辑画布视口', { exact: true }).waitFor()
        await checkChrome(`edit-graph-${width}`)
        await screenshot(`edit-graph-${width}`)
        await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
      }
      await page.getByLabel(`${name}视口`, { exact: true }).waitFor()
      if (key === 'instructions') await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).waitFor()
      if (key === 'edit') await page.getByRole('button', { name: '选择素材 1', exact: true }).waitFor()
      if (key === 'instructions') await page.waitForFunction(() => !document.querySelector('.canvas-toolbar-primary')?.textContent.includes('正在核对'))
      if (width === 390) await locate({ director: '原文依据', units: '单元 1', instructions: '当前指令', edit: '当前素材' }[key])
      if (key === 'units' && width === 1920) {
        const design = await page.getByRole('button', { name: 'AI设计', exact: true }).boundingBox()
        const instruction = await page.getByRole('button', { name: '进入指令画布', exact: true }).boundingBox()
        assert.ok(design && instruction && Math.abs(design.y - instruction.y) <= 2, '宽屏单元状态栏的主操作应横向对齐')
      }
      await checkChrome(`${key}-${width}`)
      await screenshot(`${key}-${width}`)
      const before = await transform()
      await page.getByRole('button', { name: '展开关系树', exact: true }).click()
      const tree = page.locator('.scene-relations-tree-content')
      await tree.waitFor()
      const treeRect = await tree.boundingBox()
      assert.ok(treeRect.x >= 0 && treeRect.x + treeRect.width <= width + 1)
      assert.equal(await transform(), before)
      await page.getByRole('button', { name: '收起关系树', exact: true }).click()
      assert.equal(await transform(), before)
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await locate('同场次素材')
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  await locate('当前素材')
  await page.getByRole('button', { name: '预览当前素材', exact: true }).click()
  const video = page.getByLabel('当前素材视频', { exact: true })
  await video.waitFor()
  await page.waitForFunction(() => document.querySelector('video[aria-label="当前素材视频"]')?.readyState >= 1)
  assert.equal(await video.evaluate(node => node.paused), true)
  await screenshot('edit-real-media')
  await locate('时间线')
  await page.getByRole('button', { name: '编辑片段 1', exact: true }).click()
  await screenshot('edit-timeline')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const exportDialog = page.getByRole('dialog', { name: '整场导出', exact: true })
  await exportDialog.waitFor()
  await exportDialog.getByRole('combobox', { name: '导出尺寸', exact: true }).waitFor()
  await exportDialog.getByRole('button', { name: '导出整场视频', exact: true }).click()
  await exportDialog.getByText(/仍为待拍占位，请补齐真实媒体后导出/).waitFor()
  await screenshot('export-validation')
  await exportDialog.getByRole('button', { name: '导出记录', exact: true }).click()
  const history = page.getByRole('complementary', { name: '整场导出记录', exact: true })
  await history.waitFor()
  await history.getByRole('button', { name: '返回画布', exact: true }).click()
  await exportDialog.waitFor({ state: 'hidden' })
  await menu('更多操作')
  await page.getByRole('button', { name: '批量拍摄', exact: true }).click()
  const batchDialog = page.getByRole('dialog', { name: '批量预检与拍摄', exact: true })
  await batchDialog.waitFor()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    await batchDialog.getByRole('button', { name: '返回画布', exact: true }).click({ trial: true })
    for (const action of await batchDialog.locator('.wb-dialog-actions button').all()) {
      const bounds = await action.boundingBox()
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= (width === 390 ? 844 : 960), `批量动作不越界：${width} ${JSON.stringify(bounds)}`)
      if (width === 390) assert.ok(bounds.height >= 36, '窄屏固定动作至少 36px')
    }
    await screenshot(`batch-actions-${width}`)
  }
  await batchDialog.getByRole('button', { name: '返回画布', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 960 })
  await menu('版本管理')
  await page.getByRole('button', { name: '另存为新版本', exact: true }).click()
  await page.waitForURL(current => current.searchParams.get('version') !== version.id)
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor()
  const versions = (await (await fetch(versionsUrl)).json()).data
  assert.equal(versions.length, 2)
  assert.deepEqual(versions[0].content, versions[1].content, '菜单另存保留完整方案')
  await checkWorkbenchStyleDetails(page, output)
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'measurements.json'), JSON.stringify(measurements, null, 2))
  console.log(`PASS four-canvas style, desktop/narrow controls, shared floating panels, unchanged viewport, saved/unsaved input, real media, timeline and export menus; evidence: ${output}`)
} catch (error) {
  if (page) await screenshot('failure').catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally { await cleanup() }
