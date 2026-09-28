import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-shoot-steps-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4198, strictPort: true, open: false } })
const workspace = makeWorkspace(), requests = [], errors = [], results = []
workspace.designs[0].content.participants[0].character_id = 'role1'
const personId = workspace.designs[0].content.participants[0].id
const asset = { id: 'role1', kind: 'character', name: '张三', description: '', image_file_ids: ['image1', 'image2'], unavailable_image_count: 0 }
let browser, page, failConfirm = true, failCapability = true, failFiles = true, finishUpload, markUpload
const uploadStarted = new Promise(resolve => { markUpload = resolve })
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) return respond(req.postDataJSON().sources.map(source => ({ source, status: 'ready', label: '人工选择' })))
    if (path.endsWith('/files/upload')) {
      markUpload()
      await new Promise(resolve => { finishUpload = resolve })
      return respond({ id: 'late-upload', type: 'image' })
    }
    if (path.endsWith('/files') && req.method() === 'GET') {
      if (failFiles) return route.fulfill({ status: 422, json: { detail: '模拟素材读取失败' } })
      return respond({ items: [{ id: 'extra-image', name: '临时构图', type: 'image' }], pagination: { total: 1 } })
    }
    if (req.method() !== 'GET') requests.push({ path, body: req.postDataJSON() })
    if (path.endsWith('/s1/revisions')) {
      const body = req.postDataJSON(), plan = workspace.plans.find(row => row.id === body.revision_id)
      assert.equal(body.expected_version, plan.version)
      plan.content = body.document.content; plan.version += 1
      return respond(workspace)
    }
    if (path.endsWith('/p-new/confirm')) {
      assert.equal(req.postDataJSON().expected_version, workspace.plans[1].version)
      if (failConfirm) { failConfirm = false; return route.fulfill({ status: 422, json: { detail: '模拟确认失败' } }) }
      workspace.plans[1].confirmed_at = '2026-09-16T01:00:00'
      return respond(workspace)
    }
    if (path.endsWith('/reference-capabilities')) {
      if (failCapability) { return route.fulfill({ status: 422, json: { detail: '模拟能力读取失败' } }) }
      const textOnly = path.includes('/model2/')
      return respond({ model_id: textOnly ? 'model2' : 'model1', frame_roles: textOnly ? [] : ['first_frame', 'last_frame'], max_frames: textOnly ? 0 : 2, subject_images: !textOnly, subject_videos: false, combine_subjects_and_frames: false, max_subjects: 7, max_images_per_subject: 3, max_media_per_subject: 3, limits_status: 'known' })
    }
    if (path.endsWith('/assets')) return respond([asset])
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/s1/feedback')) return respond({ reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/models')) return respond({ items: [{ id: 'model1', name: '测试模型', category: 'video' }, { id: 'model2', name: '纯文本模型', category: 'video' }], total: 1 })
    if (path.endsWith('/model-settings')) return respond({ default_video_model_id: 'model1' })
    if (path.endsWith('/download')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="skyblue"/></svg>' })
    if (/\/(styles|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4198/projects/p1/chapters/ch1/sequences/s1?view=shoot&design=d1&plan=p-new&unit=u1&prompt=&review='
  await page.goto(base)
  await page.getByRole('tab', { name: '拍摄准备', exact: true }).waitFor()
  assert.deepEqual(requests, [])
  await page.getByRole('button', { name: '重试读取能力', exact: true }).waitFor()
  failCapability = false
  await page.getByRole('button', { name: '重试读取能力', exact: true }).click()
  await page.getByText(/支持主体图片，每个主体最多 3 张/).waitFor()
  await page.getByRole('button', { name: '添加参考', exact: true }).click()
  const picker = page.getByRole('dialog').filter({ has: page.getByText('添加参考', { exact: true }) })
  await page.setViewportSize({ width: 375, height: 812 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: join(output, '375-reference-picker.png'), animations: 'disabled' })
  await picker.getByRole('button', { name: '选入 张三 图片 1', exact: true }).click()
  await picker.getByRole('button', { name: '选入 张三 图片 2', exact: true }).press('Enter')
  assert.ok(await picker.getByRole('button', { name: '选入 张三 图片 2', exact: true }).isDisabled())
  await picker.getByRole('button', { name: '完成选择', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  await page.getByText('拟发送：提示词 + 2 张图片 · 1 组主体参考', { exact: true }).waitFor()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('combobox', { name: '视频模型', exact: true }).locator('../..').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '纯文本模型' }).click()
  await page.getByText('当前模型不支持主体图片参考，请替换参考或模型', { exact: true }).waitFor()
  await page.getByText('拟发送：提示词 + 2 张图片 · 1 组主体参考', { exact: true }).waitFor()
  await page.getByRole('button', { name: '添加参考', exact: true }).click()
  await picker.getByText('当前模型接入仅支持纯文本，请更换模型后添加参考', { exact: true }).waitFor()
  await picker.getByRole('button', { name: '完成选择', exact: true }).click()
  await page.getByRole('combobox', { name: '视频模型', exact: true }).locator('../..').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '测试模型' }).click()
  await page.getByText(/支持主体图片，每个主体最多 3 张/).waitFor()
  await page.getByText('拟发送：提示词 + 2 张图片 · 1 组主体参考', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, '1440-reference-input.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByText('拟发送：提示词 + 2 张图片 · 1 组主体参考', { exact: true }).scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: join(output, '375-reference-input.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '添加参考', exact: true }).click()
  await picker.getByRole('tab', { name: '已有素材', exact: true }).click()
  await picker.getByText('模拟素材读取失败', { exact: true }).waitFor()
  failFiles = false
  await picker.getByRole('button', { name: '刷新素材', exact: true }).click()
  await picker.getByRole('button', { name: /^选\s*入$/ }).click()
  await picker.getByRole('button', { name: '完成选择', exact: true }).click()
  await page.getByText('拟发送：提示词 + 3 张图片 · 2 组主体参考', { exact: true }).waitFor()
  await page.getByRole('button', { name: /^移\s*除$/ }).last().click()
  await page.getByText('拟发送：提示词 + 2 张图片 · 1 组主体参考', { exact: true }).waitFor()
  await page.getByRole('button', { name: '添加参考', exact: true }).click()
  await picker.getByRole('tab', { name: '上传', exact: true }).click()
  await picker.locator('input[type=file]').setInputFiles({ name: 'temporary.png', mimeType: 'image/png', buffer: Buffer.from('test image') })
  await uploadStarted
  await picker.getByRole('button', { name: '完成选择', exact: true }).click()
  const uploadFinished = page.waitForResponse(response => response.url().endsWith('/files/upload'))
  finishUpload()
  await uploadFinished
  await page.getByText('拟发送：提示词 + 2 张图片 · 1 组主体参考', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存并确认拍摄准备', exact: true }).click()
  await page.getByText(/计划草稿已保存，确认尚未完成/).first().waitFor()
  const saved = requests.find(row => row.path.endsWith('/s1/revisions')).body.document.content
  assert.equal(saved.references, undefined)
  assert.deepEqual(saved.units[0].references.map(ref => ref.file_id), ['image1', 'image2'])
  assert.equal(saved.units[0].references[0].input_role, 'subject')
  assert.equal(saved.units[0].references[0].subject_group_id, saved.units[0].references[1].subject_group_id)
  assert.deepEqual(saved.units[0].references[0].asset_origin, { kind: 'character', id: 'role1', name: '张三' })
  assert.equal(saved.units[0].references[0].purpose, 'identity')
  assert.deepEqual(saved.units[0].references[0].participant_ids, [personId])
  await page.getByRole('button', { name: '保存并确认拍摄准备', exact: true }).click()
  await page.getByRole('button', { name: '进入指令检查', exact: true }).click()
  await page.getByRole('button', { name: '生成试拍指令', exact: true }).waitFor()
  assert.equal(requests.filter(row => row.path.endsWith('/s1/revisions')).length, 1)
  assert.equal(requests.filter(row => row.path.endsWith('/p-new/confirm')).length, 2)
  assert.ok(!requests.some(row => /\/(compile|shoot|tasks)$/.test(row.path)))
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.reload()
    for (const name of ['拍摄准备', '指令检查', '试拍与候选']) {
      if (width < 768) {
        await page.locator('.production-step-select').click()
        await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: name }).click()
      } else await page.getByRole('tab', { name, exact: true }).click()
      await page.getByRole('tabpanel', { name, exact: true }).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: join(output, `${width}-${name}.png`), animations: 'disabled' })
      results.push({ width, name })
    }
  }
  assert.deepEqual(workspace.plans[0].content.units[0].references, [])
  await page.goto(base.replace('plan=p-new', 'plan=p-old'))
  await page.getByText('拟发送：提示词 + 0 张图片', { exact: true }).waitFor()
  await page.goto(base)
  await page.getByText('拟发送：提示词 + 2 张图片 · 1 组主体参考', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, requests, errors }, null, 2))
  console.log(JSON.stringify({ output, result: 'PASS explicit asset reference, save-success/confirm-failure retry, no implicit generation, three steps at four widths' }))
} catch (error) { if (page) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: join(output, 'failure.png') }) } console.log(output); throw error } finally { await browser?.close(); await server.close() }
