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
  const first = await request(versions, 'POST', { request_id: 'legacy-version-a', title: '旧版交付甲' })
  const library = await request(`${versions}/${first.id}/take-library`)
  const take = library.find(item => item.task_id === 'legacy-video-task')
  assert.ok(take)
  first.content.timeline.items = [{ kind: 'media', id: 'retained-clip', take_kind: take.take_kind, take_id: take.take_id,
    file_id: take.file_id, fit: 'contain', media_range: { source_in_ms: 0, source_out_ms: 1000 }, timeline_start_ms: 0 }]
  const saved = await request(`${versions}/${first.id}`, 'PUT', {
    request_id: 'legacy-timeline', expected_revision: first.revision, content: first.content,
  })
  const delivery = await request(`${versions}/${first.id}/deliveries`, 'POST', { request_id: 'legacy-delivery', expected_revision: saved.revision })
  const task = await request(`${versions}/${first.id}/exports`, 'POST', { request_id: 'legacy-export', expected_revision: saved.revision, size: 720 })
  const second = await request(versions, 'POST', { request_id: 'legacy-version-b', title: '旧版方案乙' })
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
  const legacy = page.getByRole('region', { name: '场次画布工作台', exact: true })
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
  await newHost.getByRole('heading', { name: '本场画布', exact: true }).waitFor()
  assert.deepEqual(versionReads, [])
  await page.goto(`${prep}?version=${first.id}&canvas=edit`)
  await page.getByText('此画布不属于当前场次或已不可用', { exact: true }).waitFor()
  assert.deepEqual(versionReads, [])

  await page.goto(chapterPage)
  await newHost.getByRole('button', { name: '场次更多操作' }).click()
  await page.getByRole('link', { name: '旧版审片与剪辑', exact: true }).click()
  await page.waitForURL(old + '?canvas=edit')
  await legacy.getByRole('button', { name: '打开剪辑工作区', exact: true }).waitFor()
  await page.goto(`${old}?canvas=edit&version=${first.id}`)
  await legacy.getByText('旧版交付甲', { exact: true }).first().waitFor()
  await legacy.getByRole('button', { name: '更多操作', exact: true }).click()
  assert.equal(await legacy.getByRole('button', { name: /用于章节|更新到章节|章节当前使用/ }).count(), 0)
  await legacy.getByRole('button', { name: '定位时间线片段', exact: true }).waitFor()
  await legacy.getByRole('button', { name: '定位源素材', exact: true }).click()
  await page.getByRole('combobox', { name: '当前方案素材审查', exact: true }).waitFor()
  await page.goto(`${old}?version=${second.id}`)
  await legacy.getByText('旧版方案乙', { exact: true }).first().waitFor()

  const management = page.getByRole('region', { name: '工作台管理', exact: true })
  const retired = page.getByText('章节组合已停用，可在工作台管理中继续准备场次。', { exact: true })
  for (const link of [chapterPage + '&panel=assembly', old.replace('/' + sequence.id, '') + '?panel=assembly&sequence=' + sequence.id]) {
    await page.goto(link)
    await page.waitForURL(url => url.pathname === managementPath && !url.searchParams.has('panel'))
    await retired.waitFor()
    await management.getByRole('heading', { name: sequence.title, exact: true }).waitFor()
    assert.equal(await management.getByRole('button', { name: '按场次顺序播放', exact: true }).count(), 0)
  }
  await page.goto(chapterPage.replace('/projects/' + project, '/projects/wrong-project') + '&panel=assembly')
  await page.waitForURL(url => url.pathname === managementPath.replace(project, 'wrong-project'))
  await management.getByText('章节不属于当前项目', { exact: true }).waitFor()
  assert.equal(await management.getByRole('heading', { name: sequence.title, exact: true }).count(), 0)
  for (const [name, canvas] of [['旧版导演', 'director'], ['旧版试拍', 'units'], ['旧版审片与剪辑', 'edit']]) {
    await page.goto(origin + managementPath + '?sequence=' + sequence.id)
    await management.getByRole('button', { name: '场次更多操作' }).click()
    await page.getByRole('link', { name, exact: true }).click()
    await page.waitForURL(url => url.pathname === new URL(old).pathname && url.searchParams.get('canvas') === canvas)
    await legacy.waitFor()
  }

  await page.goto(prep)
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  const active = page.locator('.app-task-card').filter({ hasText: '导出整场视频' })
  await active.getByRole('button', { name: /查\s*看/ }).click()
  await page.waitForURL(url => url.pathname === new URL(old).pathname && url.searchParams.get('exportTask') === task.task_id)
  const query = new URL(page.url()).searchParams
  assert.equal(query.get('version'), first.id)
  assert.equal(query.get('exportVersion'), first.id)
  await page.getByRole('region', { name: '当前导出记录', exact: true }).waitFor()
  assert.equal((await used()).id, delivery.id)
  assert.equal((await used()).version_id, first.id)
  const history = await request(`${directing}/sequences/${sequence.id}/deliveries`)
  assert.deepEqual(history.map(item => item.id), [delivery.id])
  const file = await request(`${api}/api/v1/studio/files/${take.file_id}`)
  assert.ok(file.usages.some(usage => usage.source_ref === 'scene-delivery:' + delivery.id))
  assert.equal((await request(`${versions}/${first.id}`)).revision, saved.revision)
  assert.equal((await request(versions)).length, 2)
  console.log('legacy scene routes preserved', output)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await cleanup()
}
