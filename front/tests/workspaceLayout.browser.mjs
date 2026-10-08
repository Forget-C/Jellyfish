import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url)); process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-workspace-layout-'))
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=480x270:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'sample.mp4')])
const video = await readFile(join(output, 'sample.mp4'))
const workspace = makeWorkspace(), writes = [], errors = [], layouts = []
workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1', text: '固定指令：递出旧信', decisions: [], sources: [], format_version: 'v4' })]
workspace.plans = [workspace.plans[0]]
workspace.takes = Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(workspace.takes[0]), id: `t${index + 1}`, display_number: index + 1 }))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4214, strictPort: true, open: false } })
let browser, page
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) return respond([])
    if (request.method() !== 'GET') writes.push(path)
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/overview')) return respond({ sequences: [{ ...workspace.sequence, source_excerpt: '', confirmed_design_count: 1, plan_count: 1 }] })
    if (path.endsWith('/continuity')) return respond({ active_cut_revision_id: 'c-active', frames: [], seams: [], units: [] })
    if (path.endsWith('/feedback')) return respond({ active_cut_revision_id: 'c-active', reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/media')) return respond({ take_id: path.split('/').at(-2), file_id: 'video', url: '/api/sample-video', duration_ms: 1000 })
    if (path === '/api/sample-video') return route.fulfill({ contentType: 'video/mp4', body: video })
    if (path.endsWith('/models/model1')) return respond({ id: 'model1', name: '测试模型', category: 'video' })
    if (path.endsWith('/models')) return respond({ items: [{ id: 'model1', name: '测试模型', category: 'video' }], total: 1 })
    if (path.endsWith('/model-settings')) return respond({ default_video_model_id: 'model1' })
    if (path.endsWith('/reference-capabilities')) return respond({ model_id: 'model1', supported: true, max_images: 2, max_videos: 0, max_audio: 0, supports_subject_groups: false, supports_duration: true, supports_ratio: true })
    if (/\/(assets|styles|batches|categories)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4214/projects/p1/chapters/ch1/sequences/s1?design=d1&plan=p-old&unit=u1&prompt=prompt1&cut=c-active&take=t1'
  const stageTabs = page.locator('.workspace-stage-tabs')
  const enter = async stage => {
    await stageTabs.getByRole('tab', { name: { design: '导演设计', shoot: '单元试拍', cut: '剪辑验收' }[stage], exact: true }).click()
    await page.waitForURL(url => url.searchParams.get('view') === stage)
    await page.locator(`.${stage === 'design' ? 'design-stage-frame' : stage === 'shoot' ? 'production-workbench' : 'cut-workbench'}`).waitFor()
  }
  await page.goto(base + '&view=design')
  for (const width of [1440, 1280, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    for (const stage of ['design', 'shoot', 'cut']) {
      await enter(stage)
      const geometry = await page.evaluate(stage => {
        const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width }; }
        return { scene: box('.sequence-switcher'), stages: box('.workspace-stage-tabs'), content: box(stage === 'design' ? '.design-workspace' : stage === 'shoot' ? '.production-panels' : '.cut-work-area'), nav: stage === 'design' ? box('.design-view-toolbar') : stage === 'shoot' ? box('.production-step-navigation') : null };
      }, stage)
      assert.ok(geometry.scene.bottom <= geometry.stages.y + 1)
      assert.ok(geometry.stages.bottom <= geometry.content.y + 1)
      if (geometry.nav) {
        assert.ok(geometry.nav.bottom <= geometry.content.y + 1, 'stage-internal navigation remains above both columns')
        assert.ok(Math.abs(geometry.nav.width - geometry.content.width) < 1, 'internal navigation spans the entire work area')
      }
      assert.equal(new URL(page.url()).pathname.includes('/sequences/s1'), true)
      assert.equal(await stageTabs.getByRole('tab').count(), 3)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      if (stage === 'cut') {
        await page.getByRole('navigation', { name: '剪辑时间线', exact: true }).waitFor()
        await page.getByLabel('当前候选播放器', { exact: true }).waitFor()
      }
      layouts.push({ width, stage, geometry })
      await page.screenshot({ path: join(output, `${width}-${stage}.png`), animations: 'disabled' })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await enter('shoot')
  await page.getByRole('tab', { name: '试拍与候选', exact: true }).click()
  const content = page.locator('.production-content')
  await content.evaluate(async element => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); element.scrollTop = 120 })
  const top = await content.evaluate(element => element.scrollTop)
  assert.ok(top > 0, 'candidate content provides a real scroll position')
  await page.waitForFunction(() => !!JSON.parse(JSON.parse(sessionStorage.getItem('directing-context:p1:s1') || '{}').shootScroll || '{}').positions)
  await page.getByRole('tab', { name: '拍摄准备', exact: true }).click()
  await content.evaluate(element => { element.scrollTop = 0 })
  await page.getByRole('tab', { name: '试拍与候选', exact: true }).click()
  await page.waitForFunction(top => Math.abs(document.querySelector('.production-content')?.scrollTop - top) < 2, top)
  await enter('design'); await enter('shoot')
  await page.getByRole('tab', { name: '试拍与候选', exact: true, selected: true }).waitFor()
  await page.waitForFunction(top => Math.abs(document.querySelector('.production-content')?.scrollTop - top) < 2, top)
  await page.goBack(); await stageTabs.getByRole('tab', { name: '导演设计', exact: true, selected: true }).waitFor()
  await page.goForward(); await stageTabs.getByRole('tab', { name: '单元试拍', exact: true, selected: true }).waitFor()
  await page.reload(); await page.getByRole('tab', { name: '试拍与候选', exact: true, selected: true }).waitFor()
  await page.waitForFunction(top => Math.abs(document.querySelector('.production-content')?.scrollTop - top) < 2, top)
  await page.evaluate(() => {
    const key = 'directing-context:p1:s1', context = JSON.parse(sessionStorage.getItem(key))
    const identity = JSON.stringify(['p-old', 'u1', 'takes'])
    const position = JSON.parse(context.shootScroll).positions[identity]
    context.shootScroll = JSON.stringify({ identity, ...position }); sessionStorage.setItem(key, JSON.stringify(context))
  })
  await page.reload(); await page.waitForFunction(top => Math.abs(document.querySelector('.production-content')?.scrollTop - top) < 2, top)
  await page.setViewportSize({ width: 375, height: 900 })
  const auxiliary = page.getByRole('button', { name: '执行与候选详情', exact: true })
  await auxiliary.click(); await page.getByRole('dialog', { name: '执行与候选详情', exact: true }).waitFor()
  await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: '执行与候选详情', exact: true }).waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.textContent === '执行与候选详情')
  assert.deepEqual(writes, []); assert.deepEqual(errors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ layouts, scrollRestored: top, legacyScrollRestored: true, historyRestored: true, focusRestored: true, writes, errors }, null, 2))
  console.log(JSON.stringify({ output, result: 'PASS five widths, frame inheritance, stage navigation, independent step scrolling, legacy scroll, history, refresh, mobile auxiliary focus and zero writes' }))
} catch (error) { if (page) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: join(output, 'failure.png') }) } console.log(output); throw error } finally { await browser?.close(); await server.close() }
