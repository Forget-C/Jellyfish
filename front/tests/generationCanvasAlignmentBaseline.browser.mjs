import { makeWorkspace } from './directing-fixtures.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
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
const api = 'http://127.0.0.1:8526'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, PYTHONPATH:join(root,'../backend'), UV_CACHE_DIR: process.env.UV_CACHE_DIR || '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8526', SCENE_BROWSER_TEST_LEGACY_TAKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
captureBackend(backend, output)
const errors = []
async function menu(name) {
  const trigger = page.getByRole('button', { name, exact: true })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
}
async function screenshot(name) {
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))) })
  await page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' })
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4526, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message) })
  page.on('response', response => { if (response.status() >= 400) console.error('HTTP ERROR', response.status(), response.url()) })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const url = `http://127.0.0.1:4526/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}`
  await page.goto(url)
  await page.getByRole('button', { name: '版本管理', exact: true }).waitFor()
  await menu('版本管理')
  await page.getByRole('button', { name: '新建场次版本', exact: true }).click()
  await page.locator('[data-layout-view="overview"]').waitFor()
  const versions = (await (await fetch(versionsUrl)).json()).data
  const version = versions[0]
  const design = makeWorkspace().designs[0].content
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'browser', version: '1' }] })
  design.direction.information_change = note('读到旧信')
  design.participants[0].name = '读信者'
  design.direction.shots[0].visible_result = note('打开旧信')
  design.direction.shots.push({ ...structuredClone(design.direction.shots[0]), id: 'shot2', visible_result: note('望向门口') })
  design.criteria = Array.from({ length: 5 }, (_, i) => ({ id: `criterion${i + 1}`, requirement: note(`验收要求 ${i + 1}：保持动作与画面关系清楚`) }))
  design.direction.shots.forEach(shot => { shot.criterion_ids = design.criteria.map(row => row.id) })
  design.performance.beats[0].physical_action = note('缓慢展开信纸')
  design.performance.beats[0].dialogue_ids = ['dialogue1']
  design.cinematography[0].composition = note('让信纸位于画面中央')
  design.staging.activities[0].ongoing_task = note('窗外行人经过')
  design.staging.activities.push({ ...structuredClone(design.staging.activities[0]), trigger_event_id: null, ongoing_task: note('整理桌上的物件') })
  // This test creates new rows through the editable-version API, so each row needs a stable identity.
  ;[design.performance.situations, design.performance.beats, design.staging.activities, design.cinematography].forEach((rows, group) => {
    rows.forEach((row, index) => { row.id = `layout-${group}-${index}` })
  })
  const seeded = await fetch(`${versionsUrl}/${version.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({request_id:crypto.randomUUID(),expected_revision:version.revision,content:{...version.content,design}}) })
  assert.ok(seeded.ok,await seeded.text())
  await page.reload()
  await page.locator('[data-layout-view="overview"]').waitFor()
  await page.getByRole('button', { name: '展开关系树', exact: true }).waitFor()
  assert.equal(await page.locator('.scene-relations-tree-content').count(), 0)
  for (const [name, width, height] of [['desktop',1440,960],['mobile',390,844],['wide',3830,1688]]) {
    await page.setViewportSize({ width, height })
    await screenshot(`director-${name}`)
    const measured = await page.locator('.canvas-workbench-toolbar').evaluate(node => ({ height: node.getBoundingClientRect().height, background: getComputedStyle(document.querySelector('.canvas-workbench')).backgroundColor, buttons: [...node.querySelectorAll('button')].filter(b => b.getClientRects().length && !b.closest('[hidden]')).map(b => ({ name: b.getAttribute('aria-label'),height:b.getBoundingClientRect().height,border:getComputedStyle(b).borderRadius })) }))
    await writeFile(join(output, `director-${name}.json`), JSON.stringify(measured,null,2))
  }
  await page.setViewportSize({width:1440,height:960})
  await page.getByRole('button',{name:'适应全部',exact:true}).click()
  await screenshot('director-fit-desktop')
  await page.locator('.director-node-open:not(:disabled)').first().press('Enter')
  await page.locator('.wb-details:visible').waitFor()
  await screenshot('director-details')
  assert.deepEqual(errors, [])
} finally { await cleanup() }
