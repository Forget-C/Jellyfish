import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-scene-canvas-legacy-routes-')
const api = 'http://127.0.0.1:8331', origin = 'http://127.0.0.1:4331'
const project = 'canvas-project', chapter = 'canvas-chapter'
const directing = `${api}/api/v1/studio/projects/${project}/directing`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8331',
    SCENE_BROWSER_TEST_LEGACY_TAKE: '1', SCENE_BROWSER_TEST_LEGACY_FRAMING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}

try {
  let data
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { data = await request(`${directing}/chapters/${chapter}`); break } catch {}
    await delay(250)
  }
  assert.ok(data)
  const sequence = data.sequences[0]
  const versions = `${directing}/sequences/${sequence.id}/versions`
  const { delivery, file_id: fileId } = await request(`${api}/browser-test/legacy-delivery/${sequence.id}`, 'POST')
  assert.equal((await fetch(versions)).status, 404)
  assert.equal((await fetch(`${versions}/${delivery.version_id}`)).status, 404)
  const chapters = `${origin}/projects/${project}?tab=chapters`
  const chapterPage = chapters + '&chapter=' + chapter
  const managementPath = `/projects/${project}/chapters/${chapter}/workbench-management`
  const old = `${origin}/projects/${project}/chapters/${chapter}/sequences/${sequence.id}`
  const prep = old + '/canvas-workbench'
  const used = async () => (await request(`${directing}/chapters/${chapter}/deliveries`)).sequences[0].delivery

  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4331, strictPort: true, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const newHost = page.getByRole('region', { name: '工作台管理', exact: true })
  const versionReads = []
  page.on('request', request => {
    if (request.url().includes(`/directing/sequences/${sequence.id}/versions`)) versionReads.push(request.url())
  })

  await page.goto(chapters)
  const openManagement = page.getByRole('button', { name: '工作台管理', exact: true })
  await openManagement.waitFor()
  assert.equal(await page.getByRole('button', { name: '章节组合', exact: true }).count(), 0)
  await openManagement.click()
  await page.waitForURL(url => url.pathname === managementPath)
  await page.goto(prep)
  await page.waitForURL(url => url.pathname === managementPath && url.searchParams.get('sequence') === sequence.id)
  await newHost.getByText('本场尚无画布，可生成新分镜画布开始设计', { exact: true }).waitFor()
  await newHost.getByRole('button', { name: '生成新分镜画布', exact: true }).waitFor()
  assert.equal(await newHost.getByRole('button', { name: '场次更多操作', exact: true }).count(), 0)
  assert.deepEqual(versionReads, [])
  await page.goto(`${prep}?version=${delivery.version_id}&canvas=edit`)
  await page.getByText('此画布不属于当前场次或已不可用', { exact: true }).waitFor()
  assert.deepEqual(versionReads, [])

  const management = page.getByRole('region', { name: '工作台管理', exact: true })
  const retired = page.getByText('章节组合已停用，可在工作台管理中继续准备场次。', { exact: true })
  for (const link of [chapterPage + '&panel=assembly', old.replace('/' + sequence.id, '') + '?panel=assembly&sequence=' + sequence.id]) {
    await page.goto(link)
    await page.waitForURL(url => url.pathname === managementPath && !url.searchParams.has('panel'))
    await retired.waitFor()
    await management.getByRole('button', { name: `1. ${sequence.title}`, exact: true }).waitFor()
    assert.equal(await management.getByRole('button', { name: '按场次顺序播放', exact: true }).count(), 0)
  }
  await page.goto(chapterPage.replace('/projects/' + project, '/projects/wrong-project') + '&panel=assembly')
  await page.waitForURL(url => url.pathname === managementPath.replace(project, 'wrong-project'))
  await management.getByText('章节不属于当前项目', { exact: true }).waitFor()
  assert.equal(await management.getByRole('heading', { name: sequence.title, exact: true }).count(), 0)
  assert.equal((await used()).id, delivery.id)
  assert.equal((await used()).version_id, delivery.version_id)
  const history = await request(`${directing}/sequences/${sequence.id}/deliveries`)
  assert.deepEqual(history.map(item => item.id), [delivery.id])
  const file = await request(`${api}/api/v1/studio/files/${fileId}`)
  assert.ok(file.usages.some(usage => usage.source_ref === 'scene-delivery:' + delivery.id))
  assert.equal(history[0].revision, delivery.revision)
  console.log('management routes and retained backend records verified', output)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await cleanup()
}
