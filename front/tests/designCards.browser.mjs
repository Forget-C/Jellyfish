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
  design.direction.shots.push({ ...structuredClone(design.direction.shots[0]), id: 'shot2', event_ids: [], blocking_state_ids: [], participant_ids: [], visible_result: note('望向门口') })
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
  design.staging.activities.push({ ...structuredClone(design.staging.activities[0]), trigger_event_id: null, ongoing_task: note('整理桌上的物件') })
  design.continuity[0].before = note('信件封好')
  design.continuity[0].after = note('信件打开')
  design.continuity[0].following_constraint = note('信件保持展开')
  design.continuity = ['space', 'appearance', 'hands_props', 'environment', 'camera', 'dialogue_sound'].map((domain, index) => ({ ...structuredClone(design.continuity[0]), id: `continuity-${index}`, domain }))
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
  const node = id => page.locator(`[data-canvas-node="${id}"]`)
  await page.locator('[data-layout-view="overview"]').waitFor()
  const performance = node('performance:beat1:person1')
  assert.equal(await performance.count(), 1, 'shared performance has one original')
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: await performance.locator('h2').innerText(), exact: true }).click()
  await performance.getByRole('button', { name: '编辑此卡' }).click()
  const drawer = page.locator('.canvas-quick-editor')
  await drawer.getByRole('textbox', { name: '可见身体动作', exact: true }).fill('轻轻展开信纸')
  await page.getByRole('button', { name: '关闭编辑区' }).click()
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: /镜头 01/ }).first().click()
  await node('shot:shot1').getByRole('button', { name: /进入子图/ }).click()
  await page.locator('[data-layout-view="shot:shot1"]').waitFor()
  const reference = node('beat:beat1')
  assert.equal(await reference.getByRole('button', { name: '编辑此卡' }).count(), 0)
  assert.match(await reference.innerText(), /共享引用/)
  await reference.getByRole('button', { name: '定位共享原卡' }).click()
  await page.locator('[data-layout-view="overview"]').waitFor()
  assert.match(await performance.innerText(), /轻轻展开信纸/)
  await page.getByRole('button', { name: '新增工作单', exact: true }).click()
  await page.getByRole('menuitem', { name: '新增镜内活动', exact: true }).click()
  assert.equal(await drawer.getByRole('button', { name: '建立工作单', exact: true }).isDisabled(), true)
  await drawer.getByRole('combobox', { name: '新建人物/物件', exact: true }).press('ArrowDown')
  await page.getByText('读信者', { exact: true }).last().click()
  await drawer.getByRole('button', { name: '建立工作单', exact: true }).click()
  await drawer.getByRole('textbox', { name: '持续任务', exact: true }).fill('检查信封')
  await page.getByText('当前编辑对象已移至未关联设计区', { exact: true }).waitFor()
  assert.equal(await drawer.getByRole('textbox', { name: '持续任务', exact: true }).inputValue(), '检查信封')
  await page.getByRole('button', { name: '关闭编辑区' }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const persisted = (await (await fetch(`${versions}/${version.id}`)).json()).data
  assert.equal(persisted.content.design.performance.beats[0].physical_action.text, '轻轻展开信纸')
  await page.reload()
  await page.locator('[data-layout-view="overview"]').waitFor()
  assert.match(await performance.innerText(), /轻轻展开信纸/)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await screenshot('shot-grouped-cards-mobile.png')
  assert.deepEqual(errors, [])
  console.log(`PASS shared original edit, virtual reference, save/reload and narrow cards; evidence: ${output}`)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close(); await server?.close(); backend.kill('SIGTERM')
}
