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
const api = 'http://127.0.0.1:8520'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: process.env.UV_CACHE_DIR || '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8520', SCENE_BROWSER_TEST_LEGACY_TAKE: '1' },
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4520, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message) })
  page.on('response', response => { if (response.status() >= 400) console.error('HTTP ERROR', response.status(), response.url()) })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const url = `http://127.0.0.1:4520/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}`
  await page.goto(url)
  await page.getByRole('button', { name: '版本管理', exact: true }).waitFor()
  await menu('版本管理')
  await page.getByRole('button', { name: '新建场次版本', exact: true }).click()
  await page.locator('[data-layout-view="overview"]').waitFor()
  await page.getByRole('button', { name: '展开关系树', exact: true }).waitFor()
  assert.equal(await page.locator('.scene-relations-tree-content').count(), 0)
  for (const [name, width, height] of [['desktop',1440,960],['mobile',390,844]]) {
    await page.setViewportSize({ width, height })
    await screenshot(`director-${name}`)
    const measured = await page.locator('.canvas-workbench-toolbar').evaluate(node => ({ height: node.getBoundingClientRect().height, background: getComputedStyle(document.querySelector('.canvas-workbench')).backgroundColor, buttons: [...node.querySelectorAll('button')].filter(b => b.getClientRects().length && !b.closest('[hidden]')).map(b => ({ name: b.getAttribute('aria-label'),height:b.getBoundingClientRect().height,border:getComputedStyle(b).borderRadius })) }))
    await writeFile(join(output, `director-${name}.json`), JSON.stringify(measured,null,2))
  }
  assert.deepEqual(errors, [])
} finally { await cleanup() }
