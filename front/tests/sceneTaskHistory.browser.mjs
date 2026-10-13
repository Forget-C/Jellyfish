import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(join(tmpdir(), 'jellyfish-scene-version-'))
const api = 'http://127.0.0.1:8193'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
try {
  let chapter
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error(backendOutput)
    try {
      const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`)
      if (response.ok) { chapter = (await response.json()).data; break }
    } catch { /* The dedicated test server is still starting. */ }
    await delay(250)
  }
  assert.ok(chapter, `test backend did not become ready: ${backendOutput}`)
  const sequenceId = chapter.sequences[0].id
  const versionsUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/versions`
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '覆盖编辑验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'coverage-browser', version: '1' }] })
  const content = version.content
  content.design.direction.beats = ['beat-one', 'beat-two'].map((id, index) => ({ id, event_ids: [], objective: note(`目标 ${index + 1}`), obstacle: {}, expected_change: {}, must_show: {} }))
  content.design.events = [{ id: 'event-one', description: note('拆开信封') }]
  content.design.participants = [{ id: 'reader', name: '读信者' }]
  content.design.direction.shots = [{ id: 'shot-one', beat_ids: ['beat-one', 'beat-two'], event_ids: ['event-one'], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: note('读信反应') }]
  content.units = [{ id: 'unit-one', model_id: 'browser-video-model', duration_ms: 5000, ratio: '16:9', coverage: [
    { id: 'coverage-one', shot_id: 'shot-one', beat_ids: ['beat-one'], event_ids: [], action_scope: '拆开信封' },
    { id: 'coverage-two', shot_id: 'shot-one', beat_ids: [], event_ids: [], action_scope: '' },
  ] }]
  content.units[0].coverage = content.units[0].coverage.slice(0, 1)
  content.units.push({ ...structuredClone(content.units[0]), id: 'unit-two' })
  const stylesUrl = `${api}/api/v1/studio/projects/canvas-project/directing/styles`
  const styleSource = { kind: 'human', reference: 'browser-style', version: '1' }
  const styleCreate = await fetch(stylesUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: {
    title: '指令输入风格', sources: [styleSource], rules: [{ id: 'camera-rule', role: 'cinematography', requirement: '当次风格：镜头保持稳定', status: 'confirmed', sources: [styleSource] }],
  } }) })
  assert.equal(styleCreate.status, 200)
  const fixedStyle = (await styleCreate.json()).data[0]
  assert.equal((await fetch(`${stylesUrl}/${fixedStyle.id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_version: fixedStyle.version }) })).status, 200)
  content.design.style_revision_id = fixedStyle.id
  content.design.direction.viewpoint = note('当次设计：从收信者观察')
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  let original = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  const submitted = await fetch(`${versionsUrl}/${version.id}/units/unit-one/instruction-suggestions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: original.revision, content: original.content }) })
  assert.equal(submitted.status, 200, await submitted.clone().text())
  const taskId = (await submitted.json()).data.task_id
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${taskId}/complete`, { method: 'POST' })).status, 200)
  const designResponse = await fetch(`${versionsUrl}/${version.id}/design-suggestions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: original.revision, content: original.content, instruction: '历史设计要求' }) })
  assert.equal(designResponse.status, 200, await designResponse.clone().text())
  const designTask = (await designResponse.json()).data.task_id
  assert.equal((await fetch(`${api}/browser-test/design-tasks/${designTask}/complete`, { method: 'POST' })).status, 200)
  const checkContent = structuredClone(original.content)
  checkContent.units[0].instruction = '检查时的固定正文'
  const unitUrl = `${versionsUrl}/${version.id}/units/unit-one`
  const basis = await fetch(`${unitUrl}/instruction-basis/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: original.revision, content: checkContent }) })
  assert.equal(basis.status, 200, await basis.clone().text())
  checkContent.units[0].instruction_basis_id = (await basis.json()).data.basis_id
  const checkResponse = await fetch(`${unitUrl}/instruction-checks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: original.revision, content: checkContent }) })
  assert.equal(checkResponse.status, 200, await checkResponse.clone().text())
  const checkTask = (await checkResponse.json()).data.task_id
  assert.equal((await fetch(`${api}/browser-test/instruction-checks/${checkTask}/complete`, { method: 'POST' })).status, 200)
  const checkConfirmed = await fetch(`${unitUrl}/instruction-checks/${checkTask}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: checkContent }) })
  assert.equal(checkConfirmed.status, 200, await checkConfirmed.clone().text())
  checkContent.units[0].instruction_check_task_id = checkTask
  const videoSaved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: original.revision, content: checkContent }) })
  assert.equal(videoSaved.status, 200, await videoSaved.clone().text())
  original = (await videoSaved.json()).data
  const videoResponse = await fetch(`${unitUrl}/video`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: original.revision }) })
  assert.equal(videoResponse.status, 200, await videoResponse.clone().text())
  const videoTask = (await videoResponse.json()).data.task_id
  assert.equal((await fetch(`${api}/api/v1/film/tasks/${videoTask}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200)
  const createdB = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '当前版本 B' }) })
  assert.equal(createdB.status, 200)
  const versionB = (await createdB.json()).data
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${versionB.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '编辑叙事视点', exact: true }).click()
  await page.getByRole('textbox', { name: '叙事视点', exact: true }).fill('B 尚未保存的观察视点')
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await page.getByRole('button', { name: /历\s*史/ }).click()
  await page.getByRole('row').filter({ hasText: '生成当前单元指令建议' }).getByRole('button', { name: /查\s*看/ }).click()
  const history = page.getByRole('dialog', { name: '任务固定记录 · 只读', exact: true })
  await history.waitFor({ timeout: 5000 })
  assert.equal(new URL(page.url()).searchParams.get('version'), versionB.id)
  await history.getByText('建议正文：固定中景，手指拆开信封，人物抬眼看向门口。', { exact: true }).waitFor()
  assert.ok((await history.textContent()).includes(version.id))
  assert.ok((await history.textContent()).includes('unit-one'))
  assert.equal(await history.getByRole('button', { name: '应用指令建议', exact: true }).count(), 0)
  await page.setViewportSize({ width: 390, height: 844 })
  await history.getByText('查看本次固定输入', { exact: true }).click()
  const returnButton = await history.getByRole('button', { name: '返回当前工作', exact: true }).boundingBox()
  assert.ok(returnButton && returnButton.y >= 0 && returnButton.y + returnButton.height <= 844)
  assert.ok(await history.locator('.ant-modal-body').evaluate(node => node.scrollHeight > node.clientHeight))
  await page.setViewportSize({ width: 1440, height: 960 })

  const historyUrl = `**/versions/${version.id}/units/unit-one/instruction-suggestions`
  await page.route(historyUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '原记录暂时不可读' }) }))
  await history.getByRole('button', { name: '重新读取任务与检查', exact: true }).click()
  await history.getByText('总览记录读取失败', { exact: true }).waitFor()
  assert.equal(await history.getByText('建议正文：固定中景，手指拆开信封，人物抬眼看向门口。', { exact: true }).count(), 0)
  await page.unroute(historyUrl)
  await history.getByRole('button', { name: '重新读取任务与检查', exact: true }).click()
  await history.getByText('建议正文：固定中景，手指拆开信封，人物抬眼看向门口。', { exact: true }).waitFor()
  let releaseOrigin
  const originHeld = new Promise(resolve => { releaseOrigin = resolve })
  let originRequested
  const originStarted = new Promise(resolve => { originRequested = resolve })
  await page.route(`**/versions/${version.id}`, async route => {
    const response = await route.fetch()
    originRequested()
    await originHeld
    await route.fulfill({ response })
  })
  await history.getByRole('button', { name: '打开所属版本继续编辑', exact: true }).click()
  await originStarted
  await history.getByRole('button', { name: '返回当前工作', exact: true }).click()
  const lateResponse = page.waitForResponse(response => response.url().endsWith(`/versions/${version.id}`))
  releaseOrigin()
  await (await lateResponse).finished()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.getByRole('button', { name: '取消，继续编辑', exact: true }).count(), 0)
  assert.equal(new URL(page.url()).searchParams.get('version'), versionB.id)
  await page.unroute(`**/versions/${version.id}`)
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await page.getByRole('button', { name: /历\s*史/ }).click()
  await page.getByRole('row').filter({ hasText: '生成当前单元指令建议' }).getByRole('button', { name: /查\s*看/ }).click()
  await history.getByRole('button', { name: '打开所属版本继续编辑', exact: true }).click()
  await page.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
  assert.equal(new URL(page.url()).searchParams.get('version'), versionB.id)
  await history.getByRole('button', { name: '返回当前工作', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '叙事视点', exact: true }).inputValue(), 'B 尚未保存的观察视点')
  assert.deepEqual((await (await fetch(`${versionsUrl}/${versionB.id}`)).json()).data, versionB)
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, original)
  for (const [title, fixedText, id] of [['AI 提取设计 · 整场', '当时要求：历史设计要求', designTask], ['检查当前单元指令', '当时指令：检查时的固定正文', checkTask], ['视频生成', '当时指令：检查时的固定正文', videoTask]]) {
    await page.getByRole('button', { name: '任务中心', exact: true }).click()
    await page.getByRole('button', { name: /历\s*史/ }).click()
    await page.getByRole('row').filter({ hasText: title }).getByRole('button', { name: /查\s*看/ }).click()
    await history.getByText(fixedText, { exact: true }).waitFor()
    assert.ok((await history.textContent()).includes(id))
    if (id === checkTask) assert.equal(await history.getByText('检查夹具：动作表达一致', { exact: true }).count(), 6)
    assert.equal(new URL(page.url()).searchParams.get('version'), versionB.id)
    await history.getByRole('button', { name: '返回当前工作', exact: true }).click()
    assert.equal(await page.getByRole('textbox', { name: '叙事视点', exact: true }).inputValue(), 'B 尚未保存的观察视点')
  }

  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await page.getByRole('button', { name: /历\s*史/ }).click()
  await page.getByRole('row').filter({ hasText: '生成当前单元指令建议' }).getByRole('button', { name: /查\s*看/ }).click()
  const removedContent = structuredClone(original.content)
  removedContent.units = removedContent.units.filter(row => row.id !== 'unit-one')
  const removedResponse = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: original.revision, content: removedContent }) })
  assert.equal(removedResponse.status, 200, await removedResponse.clone().text())
  const removed = (await removedResponse.json()).data
  await history.getByRole('button', { name: '重新读取任务与检查', exact: true }).click()
  await history.getByText('建议正文：固定中景，手指拆开信封，人物抬眼看向门口。', { exact: true }).waitFor()
  await history.getByRole('button', { name: '打开所属版本继续编辑', exact: true }).click()
  await history.getByText('原单元或关联镜头已不可用，未切换或选择替代对象。', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('version'), versionB.id)
  const restored = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: removed.revision, content: original.content }) })
  assert.equal(restored.status, 200, await restored.clone().text())
  await history.getByRole('button', { name: '打开所属版本继续编辑', exact: true }).click()
  await page.route(`**/versions/${versionB.id}`, route => route.request().method() === 'PUT' ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '保存暂时失败' }) }) : route.continue())
  await page.getByRole('button', { name: '保存并切换', exact: true }).click()
  await page.getByText('保存未完成，请重试或取消切换', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('version'), versionB.id)
  await page.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
  await page.unroute(`**/versions/${versionB.id}`)
  await history.getByRole('button', { name: '打开所属版本继续编辑', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并切换', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('version') === version.id)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal(new URL(page.url()).searchParams.has('sceneTask'), false)
  assert.deepEqual((await (await fetch(`${versionsUrl}/${versionB.id}`)).json()).data, versionB)
  console.log(`PASS instruction task history opens original fixed record without switching or saving current work; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
