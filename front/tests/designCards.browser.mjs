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
  design.direction.shots.push({ ...structuredClone(design.direction.shots[0]), id: 'shot2', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], visible_result: note('望向门口') })
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
  const choose = async (name, label) => {
    await page.getByRole('combobox', { name, exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select")][1]').click()
    if (name === '定位设计对象') await page.getByRole('combobox', { name, exact: true }).fill(label)
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: label }).click()
  }
  const locate = async label => { await page.getByRole('button', { name: '定位画布节点', exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click() }
  await page.locator('[data-layout-view="outer:all"]').waitFor()
  assert.equal(await page.locator('[data-canvas-node^="domain:"]').count(), 7)
  await node('domain:performance').getByRole('heading', { name: '聚合子图 · 表演指导', exact: true }).waitFor()
  await node('current-shot').getByRole('heading', { name: '聚合子图 · 摘要引用', exact: true }).waitFor()
  assert.match(await node('current-shot').innerText(), /编辑当前镜头 01/)
  assert.equal(await node('domain:performance').getByRole('button', { name: '进入表演指导', exact: true }).count(), 0)
  const preview = node('domain:performance').locator('svg.director-subgraph-preview')
  assert.ok(await preview.locator('rect').count() > 0)
  assert.equal(await preview.locator('text').count(), 0)
  assert.equal(await preview.getAttribute('aria-hidden'), 'true')
  for (const id of ['participant:person1', 'event:event1', 'criterion:criterion1', 'location']) assert.equal(await node(id).count(), 1)
  assert.equal(await node('performance:beat1:person1').count(), 0)
  await locate('表演指导')
  await screenshot('subgraph-entry-desktop.png')
  const initialPreviewBoxes = await node('domain:performance').locator('.director-subgraph-preview rect').evaluateAll(rects => rects.map(rect => ['x', 'y', 'width', 'height'].map(name => Number(rect.getAttribute(name))).join(',')).sort())
  const observeMotion = () => page.evaluate(() => new Promise(resolve => {
    const transforms = [], started = performance.now()
    const sample = () => {
      const content = document.querySelector('.director-canvas-content')
      if (content) transforms.push({ view: content.parentElement.dataset.layoutView, transform: getComputedStyle(content).transform })
      if (performance.now() - started < 750) requestAnimationFrame(sample)
      else resolve(transforms)
    }
    requestAnimationFrame(sample)
  }))
  const motion = observeMotion()
  await node('domain:performance').getByRole('heading', { name: '聚合子图 · 表演指导', exact: true }).click()
  await page.screenshot({ path: join(output, 'subgraph-focus-motion.png'), animations: 'allow' })
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-layout-view="performance:all"] .director-canvas-content')
    return element?.getAnimations().some(animation => {
      const timing = animation.effect.getComputedTiming()
      return timing.progress > .1 && timing.progress < .85 && animation.effect.getKeyframes().some(frame => frame.transform)
    })
  }, undefined, { timeout: 5000 })
  await page.screenshot({ path: join(output, 'subgraph-expand-motion.png'), animations: 'allow' })
  const enteredFrames = await motion
  assert.ok(new Set(enteredFrames.map(frame => frame.transform)).size >= 4, '下钻应呈现连续的中间相机位置，不能直接替换视图')
  assert.ok(new Set(enteredFrames.filter(frame => frame.view === 'outer:all').map(frame => frame.transform)).size >= 3, '切换目标前应先连续聚焦源卡')
  await page.locator('[data-layout-view="performance:all"]').waitFor()
  assert.deepEqual(await page.locator('.director-canvas-object').evaluateAll(cards => cards.map(card => [card.offsetLeft, card.offsetTop, card.offsetWidth, card.offsetHeight].join(',')).sort()), initialPreviewBoxes, '首次进入的实际布局与入口预览一致')
  const returning = observeMotion()
  await page.getByRole('button', { name: '返回上一处', exact: true }).click()
  assert.ok(new Set((await returning).map(frame => frame.transform)).size >= 4, '返回应反向穿出并恢复源视角')
  await page.locator('[data-layout-view="outer:all"]').waitFor()
  const historyForward = observeMotion()
  await page.goForward()
  assert.ok(new Set((await historyForward).map(frame => frame.transform)).size >= 4, '浏览器前进应沿原入口连续下钻')
  const historyBack = observeMotion()
  await page.goBack()
  assert.ok(new Set((await historyBack).map(frame => frame.transform)).size >= 4, '浏览器后退应反向穿出')
  await node('domain:performance').getByRole('button', { name: '进入子图：表演指导', exact: true }).click()
  await page.waitForFunction(() => { const surface = document.querySelector('[data-layout-view="performance:all"]'); return surface && surface.getAttribute('aria-busy') !== 'true' })
  await locate('表演 01 · 确认落款')
  assert.match(await node('performance:beat1:person1').innerText(), /缓慢展开信纸/)
  const criterion = node('criterion:criterion1')
  assert.match(await criterion.innerText(), /来自外层.*只读引用/)
  assert.equal(await criterion.getByRole('button', { name: '编辑此卡' }).count(), 0)
  await node('performance:beat1:person1').getByRole('button', { name: '编辑此卡' }).click()
  const drawer = page.locator('.canvas-quick-editor')
  await drawer.getByRole('textbox', { name: '可见身体动作', exact: true }).fill('轻轻展开信纸')
  await page.getByRole('button', { name: '关闭编辑区' }).click()
  await locate('对白 01 · 这封信终于到了')
  await node('dialogue:dialogue1').getByRole('heading', { name: '聚合子图 · 对白与声音', exact: true }).waitFor()
  await node('dialogue:dialogue1').getByRole('button', { name: '进入子图：对白 01 · 这封信终于到了', exact: true }).click()
  await page.locator('[data-layout-view="sound:all"]').waitFor()
  await node('dialogue:dialogue1').getByRole('button', { name: '编辑此卡' }).waitFor()
  await page.getByRole('button', { name: '返回上一处' }).click()
  await page.locator('[data-layout-view="performance:all"]').waitFor()
  assert.match(await node('performance:beat1:person1').innerText(), /轻轻展开信纸/)
  await choose('查看范围', '当前镜头')
  await page.locator('[data-layout-view="performance:shot:shot1"]').waitFor()
  await choose('设计域', '镜内执行')
  await page.locator('[data-layout-view="staging:shot:shot1"]').waitFor()
  assert.equal(await page.locator('[data-canvas-node^="activity:"]').count(), 1)
  await choose('定位设计对象', '镜内活动 02 · 整理桌上的物件')
  await page.getByText('范围外 · 临时查看', { exact: true }).first().waitFor()
  assert.equal(await page.locator('[data-canvas-node^="activity:"]').count(), 2)
  assert.equal(new URL(page.url()).searchParams.get('directorScope'), 'shot')
  const temporaryActivity = page.locator('[data-canvas-node^="activity:"]').filter({ has: page.getByRole('heading', { name: '镜内活动 02 · 整理桌上的物件', exact: true }) })
  const temporaryPosition = await temporaryActivity.evaluate(card => ({ x: card.offsetLeft, y: card.offsetTop }))
  await temporaryActivity.getByRole('button', { name: '编辑此卡' }).click()
  await drawer.getByRole('textbox', { name: '持续任务', exact: true }).fill('整理桌上的信件')
  const renamedActivity = page.locator('[data-canvas-node^="activity:"]').filter({ has: page.getByRole('heading', { name: '镜内活动 02 · 整理桌上的信件', exact: true }) })
  assert.deepEqual(await renamedActivity.evaluate(card => ({ x: card.offsetLeft, y: card.offsetTop })), temporaryPosition)
  assert.equal(await page.getByText('原对象不可用，请重新选择', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '关闭编辑区' }).click()
  await page.getByRole('button', { name: '结束临时查看' }).click()
  assert.equal(await page.locator('[data-canvas-node^="activity:"]').count(), 1)
  await page.getByRole('button', { name: '新增工作单', exact: true }).click()
  await page.getByRole('menuitem', { name: '新增镜内活动', exact: true }).click()
  assert.equal(await drawer.getByRole('button', { name: '建立工作单', exact: true }).isDisabled(), true)
  await drawer.getByRole('combobox', { name: '新建人物/物件', exact: true }).press('ArrowDown')
  await page.getByText('读信者', { exact: true }).last().click()
  await drawer.getByRole('button', { name: '建立工作单', exact: true }).click()
  await drawer.getByRole('textbox', { name: '持续任务', exact: true }).fill('暂未指定触发事件的活动')
  await page.getByText('范围外 · 临时查看', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: '关闭编辑区' }).click()
  await page.getByRole('button', { name: '结束临时查看' }).click()
  assert.equal(await page.locator('[data-canvas-node^="activity:"]').count(), 1)
  await choose('查看范围', '整场')
  assert.equal(await page.locator('[data-canvas-node^="activity:"]').count(), 3)
  await page.setViewportSize({ width: 390, height: 844 })
  await screenshot('domains-mobile.png')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.getByRole('navigation', { name: '导演画布选择' }).getByRole('button', { name: '导演画布', exact: true }).click()
  await page.locator('[data-layout-view="outer:all"]').waitFor()
  await locate('人物 / 物件 01 · 读信者')
  await node('participant:person1').getByRole('button', { name: '编辑资产绑定' }).click()
  await drawer.getByRole('combobox', { name: '读信者角色关联', exact: true }).waitFor()
  assert.equal(await drawer.getByRole('combobox', { name: '本场场所资产', exact: true }).count(), 0)
  await page.getByRole('button', { name: '关闭编辑区' }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const persisted = (await (await fetch(`${versions}/${version.id}`)).json()).data
  assert.equal(persisted.content.design.performance.beats[0].physical_action.text, '轻轻展开信纸')
  assert.equal(persisted.content.design.staging.activities[1].ongoing_task.text, '整理桌上的信件')
  assert.equal(persisted.content.design.staging.activities[2].trigger_event_id, null)
  await page.reload()
  await page.locator('[data-layout-view="outer:all"]').waitFor()
  await locate('本场场所')
  assert.match(await node('location').innerText(), /旧书房/)
  await choose('设计域', '场记与连续性')
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  for (const label of ['空间', '造型', '手部与道具', '环境', '摄影', '对白与声音']) {
    await page.getByRole('menuitem', { name: `连续性 · ${label}分区 · 1`, exact: true }).waitFor()
  }
  await page.keyboard.press('Escape')
  await choose('选择镜头', '镜头 02 · 望向门口')
  await choose('查看范围', '当前镜头')
  await choose('设计域', '表演指导')
  await page.getByRole('complementary', { name: '设计域空状态', exact: true }).getByText('当前镜头暂无明确关联的工作单', { exact: true }).waitFor()
  assert.equal(await node('performance').count(), 1, '全场适用规则仍保留')
  const waitView = async view => {
    await page.waitForFunction(view => { const surface = document.querySelector(`[data-layout-view="${view}"]`); return surface && surface.getAttribute('aria-busy') !== 'true' }, view)
  }
  await choose('设计域', '导演画布')
  await waitView('outer:shot:shot2')
  await page.evaluate(() => {
    document.querySelector('[data-canvas-node="domain:direction"] .director-node-open').click()
    requestAnimationFrame(() => document.querySelector('[data-canvas-node="domain:sound"] .director-node-open').click())
  })
  await waitView('sound:shot:shot2')
  assert.equal(new URL(page.url()).searchParams.get('directorView'), 'sound', '快速连续操作以最后一次导航为准')
  assert.equal(await page.locator('.director-snapshot-content').count(), 0, '完成后没有残留视觉副本')
  await page.goBack()
  await waitView('outer:shot:shot2')
  assert.equal(new URL(page.url()).searchParams.get('directorView'), 'outer', '取消的首次入口不留下额外子图浏览记录')
  await choose('查看范围', '整场')
  await choose('设计域', '总导演')
  await waitView('direction:all')
  const searchTransition = page.evaluate(() => new Promise(resolve => {
    let transitioned = false
    const start = performance.now()
    const sample = () => {
      transitioned ||= document.querySelector('[data-layout-view="direction:all"]')?.getAttribute('aria-busy') === 'true'
      if (performance.now() - start < 1000) requestAnimationFrame(sample)
      else resolve(transitioned)
    }
    requestAnimationFrame(sample)
  }))
  await choose('定位设计对象', '镜头 02 · 望向门口')
  assert.equal(await searchTransition, true, '同一子图搜索定位也使用短过渡')
  await waitView('direction:all')
  await choose('设计域', '导演画布')
  await waitView('outer:all')
  await locate('表演指导')
  await node('domain:performance').getByRole('button', { name: '进入子图：表演指导', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-layout-view="performance:all"] .director-canvas-content')?.getAnimations().some(animation => {
    const progress = animation.effect.getComputedTiming().progress
    return progress > .1 && progress < .85
  }))
  const interruption = await page.evaluate(() => {
    const content = document.querySelector('.director-canvas-content')
    const before = getComputedStyle(content)
    const transform = before.transform, opacity = before.opacity
    document.querySelector('[data-canvas-node="dialogue:dialogue1"] .director-node-open').click()
    const preserved = [...document.querySelectorAll('.director-snapshot-content')].some(layer => {
      const style = getComputedStyle(layer)
      return style.transform === transform && style.opacity === opacity
    })
    return { preserved, opacity: Number(opacity) }
  })
  assert.ok(interruption.opacity > 0 && interruption.opacity < 1, '中断发生在展开中间帧')
  assert.equal(interruption.preserved, true, '再次进入子图保留中断前的可见相机与透明度')
  await page.screenshot({ path: join(output, 'subgraph-interrupted-expand.png'), animations: 'allow' })
  await waitView('sound:all')
  await choose('设计域', '导演画布')
  await waitView('outer:all')
  await locate('表演指导')
  await page.getByRole('combobox', { name: '设计域', exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select")][1]').click()
  const focusInterruption = await page.evaluate(() => new Promise(resolve => {
    document.querySelector('[data-canvas-node="domain:performance"] .director-node-open').click()
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const before = new DOMMatrix(getComputedStyle(document.querySelector('.director-canvas-content')).transform)
      const option = [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].find(option => option.textContent.trim() === '镜内执行')
      option.click()
      requestAnimationFrame(() => resolve([...document.querySelectorAll('.director-snapshot-content')].some(layer => {
        const after = new DOMMatrix(getComputedStyle(layer).transform)
        return Math.abs(before.e - after.e) < 2 && Math.abs(before.f - after.f) < 2 && Math.abs(before.a - after.a) < .02
      })))
    }))
  }))
  assert.equal(focusInterruption, true, '聚焦途中工具栏导航保留中断相机，不跳回稳定视角')
  await waitView('staging:all')
  await page.screenshot({ path: join(output, 'subgraph-focus-interruption-settled.png'), animations: 'allow' })
  await choose('设计域', '导演画布')
  await choose('查看范围', '当前镜头')
  await waitView('outer:shot:shot2')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedFrames = observeMotion()
  await node('domain:sound').getByRole('button', { name: '进入子图：对白与声音', exact: true }).click()
  assert.ok(new Set((await reducedFrames).map(frame => frame.transform)).size <= 3, '减少动态效果时不执行连续相机缩放')
  await waitView('sound:shot:shot2')
  await page.reload()
  await waitView('sound:shot:shot2')
  assert.equal(await page.locator('.director-snapshot-content').count(), 0, '刷新直接恢复现场')
  await choose('设计域', '导演画布')
  await waitView('outer:shot:shot2')
  assert.match(await node('domain:cinematography').innerText(), /尚无工作单/)
  await node('domain:cinematography').getByRole('button', { name: '进入子图：摄影指导', exact: true }).click()
  await waitView('cinematography:shot:shot2')
  await page.getByRole('complementary', { name: '设计域空状态', exact: true }).waitFor()
  assert.equal(await page.locator('.director-canvas-object').count(), 0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  assert.deepEqual(errors, [])
  console.log(`PASS seven domains, shared ownership, current-shot scope, cross-domain return, temporary target, editing, asset binding and 390px layout; evidence: ${output}`)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close(); await server?.close(); backend.kill('SIGTERM')
}
