import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { makeWorkspace } from './directing-fixtures.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(join(tmpdir(), 'jellyfish-design-cards-'))
const api = 'http://127.0.0.1:8197'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8197' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = '', server, browser, page
backend.stdout.on('data', data => { logs += data })
backend.stderr.on('data', data => { logs += data })
const errors = []
async function screenshot(name) {
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))) })
  await page.screenshot({ path: join(output, name), animations: 'disabled' })
}
async function request(url, body, method = 'POST') {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  return result.data
}
try {
  let chapter
  for (let i = 0; i < 100; i++) {
    if (backend.exitCode !== null) throw new Error(logs)
    try { const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`); if (response.ok) { chapter = (await response.json()).data; break } } catch {}
    await delay(250)
  }
  assert.ok(chapter, logs)
  const sequence = chapter.sequences[0].id
  const versions = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequence}/versions`
  let version = await request(versions, { request_id: crypto.randomUUID(), title: '设计卡片验收' })
  const location = await request(`${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequence}/assets`, { request_id: crypto.randomUUID(), kind: 'scene', name: '旧书房' })
  const design = makeWorkspace().designs[0].content
  design.direction.location_asset_id = location.id
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'browser', version: '1' }] })
  design.direction.information_change = note('读到旧信')
  design.participants[0].name = '读信者'
  design.direction.shots[0].visible_result = note('打开旧信')
  design.direction.shots.push({ ...structuredClone(design.direction.shots[0]), id: 'shot2', visible_result: note('望向门口') })
  design.performance.beats[0].physical_action = note('缓慢展开信纸')
  design.performance.beats[0].objective = note('确认落款')
  design.performance.beats[0].dialogue_ids = ['dialogue1']
  design.performance.situations[0].situation = note('刚收到旧信')
  design.performance.situations[0].relationship = note('与寄信人多年未见')
  design.direction.blocking_states[0].position = note('书桌左侧')
  design.direction.blocking_states[0].orientation = note('面向窗户')
  design.direction.blocking_states[0].path = note('走向门口')
  design.cinematography[0].composition = note('让信纸位于画面中央')
  design.cinematography[0].movement_path = note('缓慢推近')
  design.cinematography[0].end_frame = note('停在落款')
  design.staging.activities[0].ongoing_task = note('窗外行人经过')
  design.staging.activities[0].depth = note('前景书桌，背景行人')
  design.staging.activities.push({ ...structuredClone(design.staging.activities[0]), ongoing_task: note('整理桌上的物件') })
  design.continuity[0].before = note('信件封好')
  design.continuity[0].after = note('信件打开')
  design.continuity[0].following_constraint = note('信件保持展开')
  design.sound.dialogues[0].content = note('这封信终于到了')
  design.staging.environment = note('窗外人流经过')
  design.staging.intentional_absence = note('留出阅读停顿')
  design.sound.sources = note('远处钟声')
  design.sound.ambience_actions = note('纸张展开声')
  design.prompt.priorities = note('保留信件可读性')
  design.prompt.prohibitions = note('禁止改变落款')
  version = await request(`${versions}/${version.id}`, { request_id: crypto.randomUUID(), expected_revision: version.revision, content: { ...version.content, design } }, 'PUT')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4197, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin }; localStorage.setItem('jellyfish:scene-autosave:local-user', 'off') })
  await page.goto(`http://127.0.0.1:4197/projects/canvas-project/chapters/canvas-chapter/sequences/${sequence}?version=${version.id}`)
  await page.getByRole('button', { name: '角色工具', exact: true }).click()
  const assetTab = page.getByRole('dialog').getByRole('button', { name: '项目资产关联', exact: true })
  await assetTab.hover()
  await assetTab.evaluate(async node => { await new Promise(requestAnimationFrame); await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))) })
  await page.waitForFunction(() => {
    const tab = document.querySelector('[role="dialog"] .ant-btn:hover')
    return tab && getComputedStyle(tab).backgroundColor === 'rgb(64, 64, 64)'
  })
  await page.getByRole('dialog').getByRole('button', { name: '完成编辑', exact: true }).click()
  const locate = async label => { await page.getByRole('button', { name: '定位画布节点', exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click() }
  await locate('全场共享')
  const summary = page.locator('[data-canvas-node="全场共享"]')
  assert.match(await summary.innerText(), /成员 13 · 已填写/)
  await summary.getByRole('button', { name: '进入全场概览子图' }).click()
  await page.locator('[data-layout-view="summary"]').waitFor()
  const performance = page.locator('[data-canvas-node="performance:beat1:person1"]')
  await performance.waitFor()
  assert.match(await performance.innerText(), /缓慢展开信纸/)
  assert.match(await performance.innerText(), /关联 2 个镜头/)
  assert.equal(await page.locator('[data-canvas-node="beat:beat1"]').count(), 1)
  const positions = () => page.locator('.director-canvas-object').evaluateAll(nodes => nodes.map(node => [node.dataset.canvasNode, node.style.left, node.style.top]))
  await locate('表演 01 · 确认落款')
  const beforeEdit = await positions()
  await performance.getByRole('button', { name: '编辑此卡' }).click()
  const drawer = page.locator('.canvas-quick-editor')
  await drawer.getByRole('textbox', { name: '可见身体动作', exact: true }).fill('将信纸贴近胸口')
  await page.getByRole('button', { name: '关闭编辑区' }).click()
  assert.deepEqual(await positions(), beforeEdit, 'side editing preserves card positions')
  assert.equal(await performance.getByLabel('有未保存修改').count(), 1)
  await performance.getByRole('button', { name: /查看节点/ }).click()
  const modal = page.getByRole('dialog', { name: '表演 01 · 确认落款', exact: true })
  await modal.waitFor()
  assert.equal(await modal.getByRole('textbox', { name: '可见身体动作', exact: true }).inputValue(), '将信纸贴近胸口')
  await modal.getByRole('button', { name: '完成编辑', exact: true }).click()
  await page.getByRole('button', { name: '选择镜头', exact: true }).click()
  await page.getByRole('menuitem', { name: /^镜头 02 ·/ }).click()
  assert.equal(await page.locator('[data-layout-view="summary"]').count(), 1, 'the subgraph remains whole-scene when selecting a shot')
  assert.match(await performance.innerText(), /将信纸贴近胸口/)
  assert.equal(await page.locator('[data-canvas-node="camera:shot1"]').count(), 1)
  for (const [selector, expected] of [
    ['[data-canvas-node="camera:shot1"]', '缓慢推近'], ['[data-canvas-node="blocking:state1"]', '走向门口'],
    ['[data-canvas-node^="situation:"]', '刚收到旧信'], ['[data-canvas-node^="activity:"]', '前景书桌，背景行人'],
    ['[data-canvas-node="continuity:continuity1"]', '信件封好 → 信件打开'],
    ['[data-canvas-node="dialogue:dialogue1"]', '这封信终于到了'],
    ['[data-canvas-node="staging"]', '留出阅读停顿'], ['[data-canvas-node="sound"]', '待后期'],
    ['[data-canvas-node="prompt"]', '保留信件可读性'],
  ]) assert.match(await page.locator(selector).first().innerText(), new RegExp(expected))
  assert.equal(await page.locator('[data-canvas-node="overview"]').count(), 1)
  assert.equal(await page.locator('[data-canvas-node="全场共享"]').count(), 0)
  assert.equal(await page.locator(`[data-canvas-node="location:${location.id}"]`).count(), 0)
  const activity = page.locator('[data-canvas-node^="activity:"]').filter({ hasText: '窗外行人经过' })
  let activity2 = page.locator('[data-canvas-node^="activity:"]').filter({ hasText: '整理桌上的物件' })
  assert.match(await activity.innerText(), /未建立镜头关联/)
  await locate('镜内活动 02 · 整理桌上的物件')
  await activity2.getByRole('button', { name: '编辑此卡' }).click()
  await drawer.getByRole('textbox', { name: '持续任务', exact: true }).fill('整理好桌上的物件')
  await page.getByRole('button', { name: '关闭编辑区' }).click()
  activity2 = page.locator('[data-canvas-node^="activity:"]').filter({ hasText: '整理好桌上的物件' })
  assert.match(await activity.innerText(), /窗外行人经过/)
  await locate('环境活动与留白')
  await page.locator('[data-canvas-node="staging"]').getByRole('button', { name: '编辑此卡' }).click()
  assert.match(await drawer.innerText(), /全场适用/)
  await drawer.getByRole('textbox', { name: '环境活动', exact: true }).fill('保持室内安静')
  await page.getByRole('button', { name: '关闭编辑区' }).click()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    await locate('表演 01 · 确认落款')
    await screenshot(`cards-${width}.png`)
    await performance.getByRole('button', { name: '编辑此卡' }).click()
    const bounds = await drawer.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1)
    assert.equal(await drawer.getByRole('textbox', { name: '可见身体动作', exact: true }).inputValue(), '将信纸贴近胸口')
    await screenshot(`drawer-${width}.png`)
    await page.getByRole('button', { name: '关闭编辑区' }).click()
  }
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor()
  const stored = (await (await fetch(`${versions}/${version.id}`)).json()).data
  assert.equal(stored.content.design.performance.beats.length, 1)
  assert.equal(stored.content.design.performance.beats[0].physical_action.text, '将信纸贴近胸口')
  assert.equal(stored.content.design.staging.environment.text, '保持室内安静')
  assert.equal(stored.content.design.staging.activities[0].ongoing_task.text, '窗外行人经过')
  assert.equal(stored.content.design.staging.activities[1].ongoing_task.text, '整理好桌上的物件')
  assert.deepEqual(stored.content.design.direction.shots, version.content.design.direction.shots)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await locate('镜内活动 02 · 整理好桌上的物件')
  await activity2.getByRole('button', { name: '编辑此卡' }).click()
  await drawer.getByRole('textbox', { name: '持续任务', exact: true }).fill('自动保存期间继续整理物件')
  let automatic
  for (let i = 0; i < 50; i++) {
    automatic = (await (await fetch(`${versions}/${version.id}`)).json()).data
    if (automatic.content.design.staging.activities[1].ongoing_task.text === '自动保存期间继续整理物件') break
    await delay(200)
  }
  assert.equal(automatic.content.design.staging.activities[1].ongoing_task.text, '自动保存期间继续整理物件')
  assert.equal(await drawer.getByText('原对象不可用，请重新选择', { exact: true }).count(), 0)
  assert.equal(await drawer.getByRole('textbox', { name: '持续任务', exact: true }).inputValue(), '自动保存期间继续整理物件')
  await page.getByRole('button', { name: '关闭编辑区' }).click()
  await page.getByRole('button', { name: '返回导演画布' }).click()
  await page.locator('[data-layout-view="shot:shot2"]').waitFor()
  await page.route('**/directing/assets', route => route.abort('failed'))
  await page.reload()
  const locationCard = page.locator(`[data-canvas-node="location:${location.id}"]`)
  await locationCard.getByText(new RegExp(`读取失败 · 保留关联 ${location.id}`)).waitFor()
  await page.unroute('**/directing/assets')
  await locate('本场场所')
  await locationCard.getByRole('button', { name: '重试读取资产', exact: true }).click()
  await locationCard.getByText('旧书房', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(`PASS summary drilldown, scoped Modal and side editing, draft retention, save and responsive layout; evidence: ${output}`)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close(); await server?.close(); backend.kill('SIGTERM')
}
