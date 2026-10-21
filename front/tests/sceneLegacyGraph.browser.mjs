import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { closeWorkbenchDetails, selectWorkbenchOption } from './workbenchControls.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-legacy-graph-')
const api = 'http://127.0.0.1:8193'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: process.env.UV_CACHE_DIR || '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
captureBackend(backend, output)
try {
  let chapter
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error(backendOutput)
    try {
      const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`)
      if (response.ok) { chapter = (await response.json()).data; break }
    } catch { /* 等待独立测试后端启动。 */ }
    await delay(250)
  }
  assert.ok(chapter, `test backend did not become ready: ${backendOutput}`)
  const sequenceId = chapter.sequences[0].id
  const versionsUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/versions`
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const legacyResponse = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: crypto.randomUUID(), title: '无 ID 重复行编辑隔离' }) })
  const legacyVersion = (await legacyResponse.json()).data
  assert.equal(legacyResponse.status, 200)
  const seedLegacy = await fetch(`${api}/browser-test/scene-versions/${legacyVersion.id}/duplicate-legacy-activities`, { method: 'POST' })
  assert.equal(seedLegacy.status, 200)
  const legacyContext = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  await legacyContext.addInitScript(() => {
    window.__ENV = { BACKEND_URL: window.location.origin }
    localStorage.setItem('jellyfish:scene-autosave:local-user', 'off')
  })
  const legacyPage = await legacyContext.newPage()
  page = legacyPage
  await legacyPage.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${legacyVersion.id}`)
  await legacyPage.getByRole('button', { name: '附加信息', exact: true }).click()
  await selectWorkbenchOption(legacyPage, '定位设计对象', '镜内活动 01 · 手指停在旧信上')
  const firstLegacy = legacyPage.locator('[data-canvas-node="activity:0:r1"]')
  const secondLegacy = legacyPage.locator('[data-canvas-node="activity:1:r1"]')
  await firstLegacy.getByRole('button', { name: '编辑此卡', exact: true }).click()
  await legacyPage.getByRole('textbox', { name: '持续任务', exact: true }).fill('仅第一条的当前输入')
  await closeWorkbenchDetails(legacyPage)
  await legacyPage.route(`**/versions/${legacyVersion.id}`, async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '保留历史行编辑' }) })
    else await route.continue()
  })
  await legacyPage.getByRole('button', { name: '保存', exact: true }).click()
  await legacyPage.getByText('保存失败，输入已保留', { exact: true }).waitFor()
  assert.equal(await firstLegacy.getByRole('button', { name: '编辑此卡', exact: true }).isDisabled(), true, '旧快照重复时不能将剩下的同内容行提升为可靠身份')
  assert.equal(await secondLegacy.getByRole('button', { name: '编辑此卡', exact: true }).isDisabled(), true)
  await legacyPage.getByRole('button', { name: '附加信息', exact: true }).click()
  await selectWorkbenchOption(legacyPage, '编辑待同步对象', '镜内活动 01 · 仅第一条的当前输入')
  assert.equal(await legacyPage.getByRole('textbox', { name: '持续任务', exact: true }).inputValue(), '仅第一条的当前输入')
  await legacyPage.getByRole('textbox', { name: '持续任务', exact: true }).fill('第一条继续修改')
  await closeWorkbenchDetails(legacyPage)
  await legacyPage.getByRole('button', { name: '附加信息', exact: true }).click()
  await selectWorkbenchOption(legacyPage, '编辑待同步对象', '镜内活动 02 · 手指停在旧信上')
  assert.equal(await legacyPage.getByRole('textbox', { name: '持续任务', exact: true }).inputValue(), '手指停在旧信上', '继续编辑第一条不会写入第二条')
  const unchangedLegacy = (await (await fetch(`${versionsUrl}/${legacyVersion.id}`)).json()).data
  assert.deepEqual(unchangedLegacy.content.design.staging.activities.map(row => row.ongoing_task.text), ['手指停在旧信上', '手指停在旧信上'])
  await legacyContext.close()
  console.log(`PASS legacy duplicate rows keep current editing separate from saved graph; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Evidence: ${output}\n${backendOutput}`)
  throw error
} finally { await cleanup() }
