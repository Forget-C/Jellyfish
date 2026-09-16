import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = process.env.SEQUENCE_EVIDENCE_DIR || '/tmp/jellyfish-sequence-workbench'
await mkdir(output, { recursive: true })
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=teal:s=640x360:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${output}/sample.mp4`])
const sample = await readFile(`${output}/sample.mp4`)
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4186, strictPort: true, open: false } })
const workspace = makeWorkspace()
workspace.sequence.title = '旧信重逢'
workspace.task_ids = []
const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'fixture', version: '1' }] })
const actions = ['他停在门边', '她抬眼打量', '他拿出旧信', '她看向信封', '他缓缓递出旧信', '旧信停在桌面', '她伸手碰触信角', '他松开手', '她认出笔迹', '她抬眼看他', '两人短暂沉默', '她收起旧信']
function populate(count) {
  const design = workspace.designs[1].content
  const template = structuredClone(design.direction.shots[0])
  design.direction.information_change = note('从试探走向确认')
  design.direction.beats = ['试探', '递信', '认出'].map((name, i) => ({ ...structuredClone(design.direction.beats[0]), id: `beat${i+1}`, objective: note(name) }))
  design.participants[0].name = '他'
  design.events[0].description = note('旧信被递出')
  design.criteria[0].requirement = note('观众看清旧信')
  design.direction.anchors[0].description = note('桌面中央')
  design.direction.shots = Array.from({ length: count }, (_, i) => ({ ...structuredClone(template), id: `shot${i+1}`, beat_ids: [`beat${i < 3 ? 1 : i < 8 ? 2 : 3}`], visible_result: note(actions[i % 12]), narrative_function: note(['建立距离','试探来意','引出线索','转移注意','建立连接','保留悬念','放下戒备','交出主动权','关键转折','确认身份','情绪停顿','结束本场'][i % 12]), estimated_duration_ms: [4000,3000,5000][i%3] }))
  const camera = structuredClone(design.cinematography[0])
  design.cinematography = design.direction.shots.map(shot => ({ ...structuredClone(camera), shot_id: shot.id, composition: note('旧信与双手'), lens_effect: note('手部特写'), movement_path: note('固定机位'), end_frame: note('旧信停在桌面中央') }))
}
populate(12)
const writes = [], errors = [], results = []
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1586, height: 992 } })
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) return respond(request.postDataJSON().sources.map(source => ({ source, status: 'ready', label: '人工填写', description: '隔离测试来源' })))
    if (request.method() !== 'GET') writes.push({ path, body: request.postDataJSON() })
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/s1/feedback')) return respond({ active_cut_revision_id: 'c-active', current_review_id: null, reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/revisions')) { const body = request.postDataJSON(); const row = workspace.designs.find(r => r.id === body.revision_id); row.content = body.document.content; row.version++; return respond(workspace) }
    if (path.endsWith('/s1/continuity')) return respond({ active_cut_revision_id: 'c-active', frames: [], seams: [], units: [] })
    if (path.endsWith('/media')) return respond({ take_id: path.split('/').at(-2), file_id: 'sample', duration_ms: 6000, url: '/api/sample.mp4' })
    if (path.endsWith('/sample.mp4')) {
      const range = request.headers().range?.match(/bytes=(\d+)-(\d*)/)
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), sample.length - 1) : sample.length - 1
      return route.fulfill({ status: range ? 206 : 200, body: sample.subarray(start, end + 1), contentType: 'video/mp4', headers: { 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), ...(range ? { 'content-range': `bytes ${start}-${end}/${sample.length}` } : {}) } })
    }
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(assets|styles|batches)$/.test(path)) return respond([])
    if (path.endsWith('/projects/p1')) return respond({ id: 'p1', name: '旧信', title: '旧信' })
    if (path.endsWith('/chapters/ch1')) return respond({ id: 'ch1', project_id: 'p1', title: '第二章' })
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4186/projects/p1/chapters/ch1/sequences/s1?view=design&design=d2'
  await page.goto(base)
  await page.getByRole('tab', { name: '镜头', exact: true }).click(); await page.getByRole('radio', { name: '清单', exact: true }).locator('..').click()
  await page.getByRole('grid', { name: '镜头清单' }).waitFor()
  await page.locator('[data-shot-id="shot5"]').click()
  await page.getByRole('tab', { name: '摄影', exact: true }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${output}/design-12.png` })
  const geometry = await page.evaluate(() => Object.fromEntries(['.app-topbar','.app-nav-rail','.sequence-navigation','.workspace-stage-tabs','.sequence-version-bar','.design-view-toolbar','.design-inspector','.sequence-status'].map(selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return [selector, r && { x:r.x,y:r.y,width:r.width,height:r.height }] })))
  results.push({ name: 'desktop geometry', geometry })
  assert.equal(geometry['.sequence-navigation'].width,208)
  assert.equal(geometry['.sequence-navigation'].y,48)
  assert.equal(geometry['.workspace-stage-tabs'].height,48)
  assert.equal(geometry['.sequence-version-bar'].height,64)
  assert.equal(geometry['.design-inspector'].width,344)
  const navigationWidth = () => page.locator('.sequence-navigation').evaluate(element => element.getBoundingClientRect().width)
  await page.getByRole('separator', { name: '调整场次导航宽度', exact: true }).focus(); await page.keyboard.press('ArrowRight')
  assert.equal(await navigationWidth(), 216)
  await page.getByRole('separator', { name: '调整详情宽度', exact: true }).focus(); await page.keyboard.press('ArrowLeft')
  assert.equal(await page.locator('.design-inspector').evaluate(element => element.getBoundingClientRect().width), 352)
  await page.getByRole('button', { name: '恢复默认布局', exact: true }).click()
  assert.equal(await navigationWidth(), 208)
  assert.equal(await page.locator('.design-inspector').evaluate(element => element.getBoundingClientRect().width), 344)
  await page.getByRole('button', { name: '收起场次导航', exact: true }).click(); assert.equal(await navigationWidth(), 48)
  await page.getByRole('button', { name: '展开场次导航', exact: true }).click(); assert.equal(await navigationWidth(), 208)
  results.push({ name: 'navigation and inspector resize, collapse and restore', passed: true })
  await page.getByRole('tab', { name: '关系', exact: true }).click()
  await page.locator('[data-beat-group="beat2"]').getByRole('button', { name: '进入节拍 2 关系', exact: true }).click()
  await page.getByRole('button', { name: '聚焦所选镜头', exact: true }).click()
  await page.locator('[data-graph-node="shot:shot5"]').waitFor()
  assert.equal(await page.locator('[data-relation="调度依据"]').count(), 1)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${output}/design-relations.png` })
  await page.locator('[data-graph-node="participant:person1"] .design-node-select').click()
  await page.locator('.design-inspector').getByText('人物 / 物件 01 · 他', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-graph-node="shot:shot5"]').count(), 1)
  await page.getByRole('tab', { name: '镜头', exact: true }).click(); await page.getByRole('radio', { name: '分镜', exact: true }).locator('..').click()
  await page.getByRole('button', { name: '分镜 5', exact: true }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${output}/design-storyboard.png` })
  assert.equal(await page.getByRole('button', { name: '分镜 5', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('tab', { name: '镜头', exact: true }).click(); await page.getByRole('radio', { name: '清单', exact: true }).locator('..').click()
  results.push({ name: 'graph branches and shared storyboard selection', passed: true })
  await page.locator('.design-navigation').getByRole('button', { name: /全场 ·/ }).click()
  for (const count of [1,60,200]) {
    populate(count); await page.reload(); await page.getByRole('grid', { name: '镜头清单' }).waitFor()
    const grid = page.getByRole('grid', { name: '镜头清单' }); await grid.focus(); await page.keyboard.press('End')
    await page.locator(`[data-shot-id="shot${count}"][aria-selected="true"]`).waitFor()
    assert.ok(await page.locator('[data-shot-id]').count() < 45)
    await page.screenshot({ path: `${output}/design-${count}.png` })
    results.push({ name: `${count} shots virtual navigation`, passed: true })
  }
  for (const width of [1279,1024,768,375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
    await page.waitForTimeout(200)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.getByRole('button', { name: '场次导航', exact: true }).click()
    const navigation = page.locator('.ant-drawer-open').filter({ has: page.locator('.ant-drawer-title').getByText('场次导航', { exact: true }) })
    await navigation.waitFor()
    await navigation.getByRole('button', { name: 'Close', exact: true }).click()
    await navigation.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '所选对象详情', exact: true }).click()
    await page.locator('.ant-drawer-open').filter({ hasText: '对象详情' }).waitFor()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${output}/design-${width}-detail.png` })
    await page.locator('.ant-drawer-open').filter({ hasText: '对象详情' }).getByRole('button', { name: 'Close', exact: true }).click()
    results.push({ name: `responsive ${width}`, passed: true })
  }
  await page.setViewportSize({ width: 1586, height: 992 })
  workspace.plans[0].content.units = ['递出旧信', '认出笔迹', '确认身份'].map((action, index) => ({ ...structuredClone(workspace.plans[0].content.units[0]), id: `u${index+1}`, coverage: [{ ...workspace.plans[0].content.units[0].coverage[0], action_scope: action }] }))
  workspace.prompts = [revision('preview-prompt', { plan_revision_id: 'p-old', unit_id: 'u1', text: '他在门边停住，取出旧信，缓缓递向桌对面的人。镜头保持在两人的手部与旧信，直到他松开手。环境声与对白另行安排。', decisions: [], sources: [], format_version: 'v4' })]
  for (const view of ['shoot','cut']) {
    await page.goto(base.replace('view=design', `view=${view}`) + '&plan=p-old&unit=u1&prompt=preview-prompt&cut=c-active&take=t1')
    await page.locator(`.${view === 'shoot' ? 'production' : 'cut'}-workbench`).waitFor()
    if (view === 'cut') {
      await page.getByLabel('当前候选播放器', { exact: true }).evaluate(async video => {
        await video.play()
        await new Promise(resolve => video.addEventListener('timeupdate', resolve, { once: true }))
        video.pause()
      })
    }
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${output}/${view}-desktop.png` })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    results.push({ name: `${view} desktop layout`, passed: true })
  }
  assert.deepEqual(errors, [])
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors, writes }, null, 2))
  console.log(JSON.stringify({ output, results }, null, 2))
} finally { await browser?.close(); await server.close() }
