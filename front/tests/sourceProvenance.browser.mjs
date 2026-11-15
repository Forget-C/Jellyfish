import { execFileSync, spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserCleanup, browserOutput, captureBackend } from './browser-runtime.mjs'
import { setTimeout as delay } from 'node:timers/promises'
import { directorObject, workbenchShot } from './workbenchControls.mjs'
import { makeWorkspace } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url)); process.chdir(root)
const output = await browserOutput('jellyfish-sources-')
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=320x180:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'source.mp4')])
const media = await readFile(join(output, 'source.mp4'))
const api = 'http://127.0.0.1:8193'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
const server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false, proxy: { '/api': api } } })
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}
const workspace = makeWorkspace(), design = workspace.designs[1].content
const source = (kind, reference, extra = {}) => ({ kind, reference, version: '1', ...extra })
const model = source('model', 'generation-identity'), retry = source('model', 'retry'), late = source('model', 'late')
design.sources = [source('human', 'local-user'), source('chapter', 'chapter-snapshot'), source('file', 'reference', { file_id: 'reference-file', media_range: { source_in_ms: 1000, source_out_ms: 2000 } }), source('revision', 'd1', { version: '2' }), source('model', 'missing')]
const calls = [], writes = [], errors = [], checks = []
let failSource = true, releaseLate, browser, page, mediaFailure = true, holdLate = false
const record = source => ({ source, status: source.reference === 'missing' ? 'unavailable' : 'ready', label: ({ 'generation-identity': 'AI建议 · 历史设计', retry: 'AI建议 · 重试记录', late: 'AI建议 · 迟到记录', missing: '历史生成记录暂不可用', 'local-user': '人工填写', 'chapter-snapshot': '章节原文 · 场次摘录', reference: '参考文件 · 原始视频', d1: '继承自设计' })[source.reference], description: source.kind === 'model' ? '这是生成上下文，并非逐句引用依据。' : '记录的历史来源', ...(source.kind === 'model' && source.reference !== 'missing' ? { model_name: '生成时模型名称', task_id: 'historical-task', context_text: `当时原文：${source.reference}`, created_at: '2026-09-01T09:30:00' } : {}), ...(source.kind === 'chapter' ? { context_text: '当时原文摘录，与当前章节不同', chapter_name: '当前章节名称' } : {}), ...(source.kind === 'file' ? { file_id: source.file_id, file_name: '原始视频', media_kind: 'video' } : {}), ...(source.kind === 'revision' ? { revision_id: 'd1', revision_kind: 'design' } : {}) })
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let chapter
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited; see backend.log')
    try { chapter = await request(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`); break } catch {}
    await delay(250)
  }
  assert.ok(chapter, 'isolated backend did not become ready')
  const sequenceId = chapter.sequences[0].id
  const versionsUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/versions`
  let version = await request(versionsUrl, 'POST', { request_id: 'source-provenance', title: '来源追溯回归' })
  version.content.design.direction.shots = [1, 2].map(index => ({ id: `shot${index}`, beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], criterion_ids: [], estimated_duration_ms: 4000,
    visible_result: { state: 'proposal', text: index === 1 ? '递出信件' : '停下动作', sources: [source('human', 'local-user')] }, narrative_function: { state: 'proposal', text: '建立悬念', sources: [source('human', 'local-user')] } }))
  version = await request(`${versionsUrl}/${version.id}`, 'PUT', { request_id: 'seed-sources', expected_revision: version.revision, content: version.content })
  // 在版本读取响应中注入历史来源；画布投影沿用真实后端生成的版本契约。
  version.content.design.direction.shots[0].visible_result.sources = [model, ...design.sources]
  version.content.design.direction.shots[0].narrative_function.sources = [retry]
  version.content.design.direction.shots[1].visible_result.sources = [late]
  await server.listen(); browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); page = await browser.newPage({ viewport: { width: 1586, height: 992 } }); page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin }; localStorage.setItem('jellyfish:scene-autosave:local-user', 'off') })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname, respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) {
      const sources = req.postDataJSON().sources; calls.push(sources)
      if (holdLate && sources.some(source => source.reference === 'late')) await new Promise(resolve => { releaseLate = resolve })
      return respond(sources.filter(source => (source.reference !== 'late' || holdLate) && (source.reference !== 'retry' || !failSource)).map(record))
    }
    // export-inspection 是现行画布的只读校验 POST，不属于业务写入。
    if (req.method() !== 'GET' && !path.endsWith('/export-inspection')) writes.push(path)
    if (path.endsWith('/versions')) return respond([version])
    if (path.endsWith(`/versions/${version.id}`)) return respond(version)
    if (path.endsWith('/tasks/historical-task')) return respond({ task_id: 'historical-task', kind: 'directing_design', status: 'succeeded' })
    if (path.endsWith('/feedback')) return respond({ active_cut_revision_id: 'c-active', current_review_id: null, reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(assets|styles|batches)$/.test(path)) return respond([])
    if (path.includes('/download')) {
      if (mediaFailure) return route.fulfill({ status: 503, body: 'temporary media failure' })
      const range = req.headers().range, match = range?.match(/bytes=(\d+)-(\d*)/), start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), media.length - 1) : media.length - 1
      return route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4', body: media.subarray(start, end + 1), headers: { 'accept-ranges': 'bytes', 'content-length': String(end-start+1), ...(range ? { 'content-range': `bytes ${start}-${end}/${media.length}` } : {}) } })
    }
    return route.continue()
  })
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  const openShot = async index => {
    await (await workbenchShot(page, `镜头 ${index}：`)).click()
    const label = new RegExp(`^镜头 ${String(index).padStart(2, '0')}`)
    await page.locator('.director-canvas-object').getByRole('heading', { name: label }).waitFor()
    return directorObject(page, label, `镜头 ${String(index).padStart(2, '0')}`)
  }
  let inspector = await openShot(1)
  await inspector.getByRole('button', { name: /查看来源 1：AI建议 · 历史设计/ }).waitFor()
  await inspector.getByRole('spinbutton', { name: '预计时长（毫秒）' }).fill('6200')
  await inspector.getByRole('button', { name: /查看来源 1：AI建议 · 历史设计/ }).click()
  await inspector.getByText('生成时模型：生成时模型名称').waitFor()
  assert.equal(await inspector.locator('.source-technical').getAttribute('open'), null)
  await inspector.getByText('查看生成时原文上下文', { exact: true }).click()
  await inspector.getByText('当时原文：generation-identity', { exact: true }).waitFor()
  await inspector.getByRole('button', { name: '查看生成记录', exact: true }).click()
  await inspector.getByText('状态：已完成', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'model-source.png') })
  await inspector.getByRole('button', { name: /查看来源 1：AI建议 · 历史设计/ }).click()
  assert.equal(await inspector.getByRole('spinbutton', { name: '预计时长（毫秒）' }).inputValue(), '6200')
  checks.push('可读模型名称与原始上下文、生成记录可达，返回不丢编辑内容')
  await inspector.getByRole('button', { name: '查看来源 1：AI建议', exact: true }).click()
  await inspector.getByText('来源读取失败', { exact: true }).waitFor()
  failSource = false
  await inspector.getByRole('button', { name: '重试', exact: true }).click()
  await inspector.getByRole('heading', { name: 'AI建议 · 重试记录', exact: true }).waitFor()
  await inspector.getByRole('button', { name: '查看来源 1：AI建议', exact: true }).click()
  for (const label of ['人工填写', '章节原文 · 场次摘录', '参考文件 · 原始视频', '继承自设计', '历史生成记录暂不可用']) {
    await inspector.getByRole('button', { name: new RegExp(`查看来源 .*：${label}$`) }).click()
    await inspector.getByRole('heading', { name: label, exact: true }).waitFor()
    if (label.startsWith('章节')) { await inspector.getByText('查看当时原文摘录', { exact: true }).click(); await inspector.getByText('当时原文摘录，与当前章节不同', { exact: true }).waitFor() }
    if (label.startsWith('参考')) {
      await inspector.getByText('原始视频 · 1.000–2.000 秒', { exact: true }).waitFor()
      assert.ok((await inspector.locator('video').getAttribute('src')).includes('reference-file'))
      await inspector.getByText('来源媒体暂时无法读取，可能已删除或无法访问', { exact: true }).waitFor()
      mediaFailure = false
      await inspector.getByRole('button', { name: '重试预览', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.source-card video')?.readyState >= 2)
      await inspector.getByRole('button', { name: '播放记录区间', exact: true }).click()
      await page.waitForFunction(() => { const video = document.querySelector('.source-card video'); return video?.paused && video.currentTime >= 2 && video.currentTime < 2.4 })
      checks.push('媒体失败可重试；真实合成媒体从记录入点播放，到出点暂停')
    }
    if (label === '继承自设计') {
      await page.route(`**/directing/sequences/${sequenceId}`, route => route.fulfill({ json: { success: true, data: workspace } }))
      await inspector.getByRole('button', { name: '查看只读历史', exact: true }).click()
      const history = inspector.getByRole('region', { name: '来源版本 · 只读', exact: true })
      await history.getByRole('textbox', { name: '本场信息变化', exact: true }).waitFor()
      assert.equal(await history.getByRole('textbox', { name: '本场信息变化', exact: true }).isDisabled(), true)
      assert.equal(await history.getByRole('button', { name: /保存/ }).count(), 0)
      await history.getByRole('button', { name: '返回来源', exact: true }).click()
    }
    await inspector.getByRole('button', { name: new RegExp(`查看来源 .*：${label}$`) }).click()
  }
  checks.push('五种来源详情、缺失状态、失败重试和只读历史可达')
  holdLate = true
  inspector = await openShot(2)
  await inspector.getByRole('button', { name: '查看来源 1：AI建议', exact: true }).click()
  inspector = await openShot(1)
  await inspector.getByRole('button', { name: /查看来源 1：AI建议 · 历史设计/ }).click()
  assert.ok(releaseLate)
  const lateResponse = page.waitForResponse(response => response.url().endsWith('/sources/resolve') && response.request().postDataJSON().sources.some(source => source.reference === 'late'))
  releaseLate()
  await (await lateResponse).finished()
  await inspector.getByRole('heading', { name: 'AI建议 · 历史设计', exact: true }).waitFor()
  assert.equal(await inspector.getByRole('heading', { name: 'AI建议 · 迟到记录', exact: true }).count(), 0)
  // 未选中对象已卸载；重新打开，正向确认缓存已消费迟到结果，再核对原对象。
  inspector = await openShot(2)
  await inspector.getByRole('button', { name: '查看来源 1：AI建议 · 迟到记录', exact: true }).click()
  await inspector.getByRole('heading', { name: 'AI建议 · 迟到记录', exact: true }).waitFor()
  inspector = await openShot(1)
  await inspector.getByRole('button', { name: /查看来源 1：AI建议 · 历史设计/ }).click()
  await inspector.getByRole('heading', { name: 'AI建议 · 历史设计', exact: true }).waitFor()
  assert.equal(await inspector.getByRole('heading', { name: 'AI建议 · 迟到记录', exact: true }).count(), 0)
  assert.equal(await inspector.getByRole('spinbutton', { name: '预计时长（毫秒）' }).inputValue(), '6200')
  assert.equal(calls.flat().filter(source => source.reference === 'late').length, 2, '初始未返回记录及一次挂起请求；重开应复用已完成结果')
  assert.equal(calls.flat().filter(source => source.reference === 'generation-identity').length, 1)
  assert.deepEqual(writes, []); assert.deepEqual(errors, [])
  checks.push('请求去重、迟到响应不覆盖当前来源，追溯操作没有业务写入')
  await writeFile(join(output, 'results.json'), JSON.stringify({ checks, calls, writes, errors }, null, 2))
  console.log(JSON.stringify({ output, checks }, null, 2))
} catch (error) { if (page) { await page.screenshot({ path: join(output, 'failure.png') }); console.error((await page.locator('body').innerText()).slice(-4000)); console.error(JSON.stringify({ calls, writes, errors })) } throw error }
finally { releaseLate?.(); await cleanup() }
