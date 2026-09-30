import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url)); process.chdir(root)
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4202, strictPort: true, open: false } })
const workspace = makeWorkspace(), writes = [], errors = [], results = []
const output = await mkdtemp(join(tmpdir(), 'jellyfish-version-management-'))
workspace.designs[1].parent_id = workspace.designs[0].id
workspace.designs[1].created_at = '2026-09-29T02:30:00Z'
workspace.designs[1].content.direction.information_change.text = '历史方案中的变化'
workspace.sequence.title = '用于验证窄屏不挤压版本入口的很长场次名称与明确的章节位置'
let browser, page, failSave = false, failOverview = false, unavailableAdoption = false, failWorkspace = false
const base = 'http://127.0.0.1:4202/projects/p1/chapters/ch1/sequences/s1'
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (path.endsWith('/sources/resolve')) return respond(req.postDataJSON().sources.map(source => ({ source, status: 'ready', label: '人工', description: '测试' })))
    if (req.method() !== 'GET') writes.push({ path, body: req.postDataJSON() })
    if (path.endsWith('/revisions') && req.method() === 'POST') {
      const body = req.postDataJSON()
      if (failSave) return route.fulfill({ status: 409, json: { detail: '版本保存冲突，修改已保留' } })
      const revisions = { design: workspace.designs, plan: workspace.plans, cut: workspace.cuts }[body.document.kind]
      if (body.revision_id) {
        const draft = revisions.find(row => row.id === body.revision_id)
        assert.equal(draft.confirmed_at, null); assert.equal(body.expected_version, draft.version)
        draft.content = body.document.content; draft.version++
      } else {
        const parent = revisions.find(row => row.id === body.parent_id)
        if (body.parent_id) assert.ok(parent?.confirmed_at)
        revisions.push({ ...revision(`${body.document.kind}-saved-${writes.length}`, body.document.content, false), parent_id: body.parent_id || null, created_at: '2026-09-30T10:00:00Z' })
      }
      return respond(workspace)
    }
    if (path.endsWith('/s1')) return failWorkspace ? route.fulfill({ status: 503, json: { detail: '工作区暂不可用' } }) : respond(workspace)
    if (path.endsWith('/feedback')) return respond({ active_cut_revision_id: unavailableAdoption ? 'missing-active' : 'c-active', reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/continuity')) return respond({ active_cut_revision_id: 'c-active', frames: [], seams: [], units: [] })
    if (path.endsWith('/overview')) return failOverview ? route.fulfill({ status: 503, json: { detail: '列表暂不可用' } }) : respond({ sequences: [{ ...workspace.sequence, source_excerpt: '', confirmed_design_count: 1, plan_count: 2 }] })
    if (/\/(assets|styles|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const dialog = page.getByRole('dialog', { name: '版本与依据', exact: true })
  const row = id => dialog.locator(`tr[data-row-key="${id}"]`)
  const tab = kind => dialog.getByRole('tab', { name: { design: '设计版本', plan: '生产计划版本', cut: '剪辑版本' }[kind], exact: true }).click()
  const open = async kind => { await page.locator('.workspace-versions-entry').click(); if (kind) await tab(kind) }
  const edit = async (kind, id) => { await tab(kind); await row(id).getByRole('button', { name: /^(基于此版本编辑|继续编辑草稿)$/ }).click() }
  const close = async () => { await dialog.getByRole('button', { name: /^关\s*闭$/ }).click(); await dialog.waitFor({ state: 'hidden' }) }
  const back = () => dialog.getByRole('button', { name: '返回版本列表', exact: true }).click()
  const checkUrl = async (key, value) => page.waitForFunction(({ key, value }) => new URL(location.href).searchParams.get(key) === value, { key, value })
  await page.goto(`${base}?view=design&design=d1&plan=p-old&cut=c-active`)
  await open()
  assert.equal(await dialog.getByRole('tab', { name: '设计版本' }).getAttribute('aria-selected'), 'true')
  await row('d2').getByRole('button', { name: '查看版本', exact: true }).click()
  await dialog.getByText('设计派生自：设计 1', { exact: true }).waitFor()
  const createdTime = await page.evaluate(value => new Date(value).toLocaleString('zh-CN', { hour12: false }), workspace.designs[1].created_at)
  await dialog.getByText(`设计创建时间：${createdTime} · 修订 1`, { exact: true }).waitFor()
  await back()
  for (const id of ['d1', 'd2']) await row(id).getByRole('button', { name: '加入比较', exact: true }).click()
  await dialog.getByRole('button', { name: '比较所选版本', exact: true }).click()
  await dialog.locator('.revision-differences').getByText('历史方案中的变化', { exact: true }).waitFor()
  await back(); await tab('cut')
  await row('c-active').getByRole('button', { name: '查看版本', exact: true }).click()
  await dialog.getByText('预演预计共 3 秒，不能代表真实素材覆盖。', { exact: true }).waitFor()
  await close(); await checkUrl('design', 'd1'); assert.equal(writes.length, 0)
  results.push('V03: read-only snapshots, comparison, provenance and close preserve context without writes')

  await open('design'); await edit('design', 'd2'); await checkUrl('design', 'd2')
  await checkUrl('plan', ''); await checkUrl('cut', 'c-active')
  await open('plan'); await edit('plan', 'p-old'); await checkUrl('plan', 'p-old'); await checkUrl('design', 'd1'); await checkUrl('view', 'shoot')
  await open('cut'); await edit('cut', 'c-old'); await checkUrl('cut', 'c-old'); await checkUrl('view', 'cut')
  assert.ok((await page.locator('.cut-version-bar').innerText()).includes('当前采用：剪辑 2'))
  await checkUrl('plan', 'p-old'); assert.equal(writes.length, 0)
  results.push('V08/V09: design clears conflicting plan, plan restores fixed design, cut stays independent')

  await page.getByRole('tab', { name: '导演设计', exact: true }).click()
  await page.getByRole('button', { name: '全场概览', exact: true }).click()
  await page.locator('textarea[aria-label="本场信息变化"]').fill('保存后仍切换到明确选择的旧设计')
  await open('cut'); await row('c-active').getByRole('button', { name: '查看版本' }).click(); await back()
  assert.equal(await page.getByRole('dialog', { name: '有未保存的修改', exact: true }).count(), 0)
  await edit('cut', 'c-active'); await page.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
  assert.equal(writes.length, 0); await checkUrl('cut', 'c-old')
  await edit('cut', 'c-active'); failSave = true
  await page.getByRole('button', { name: '保存后继续', exact: true }).click()
  await page.getByText('拍摄方案未保存成功，请处理页面中的提示后重试。', { exact: true }).waitFor()
  await checkUrl('design', 'd1'); await checkUrl('cut', 'c-old')
  assert.equal(await page.locator('textarea[aria-label="本场信息变化"]').inputValue(), '保存后仍切换到明确选择的旧设计')
  failSave = false; await page.getByRole('button', { name: '保存后继续', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' }); await checkUrl('cut', 'c-active'); await checkUrl('design', 'd1')
  assert.equal(workspace.designs.at(-1).parent_id, 'd1'); assert.equal(workspace.designs[0].content.direction.information_change.text, '递出旧信，认出对方')
  assert.equal(writes.length, 2)
  results.push('V05/V06/V07: browsing dirty work, cancel, conflict, retry and confirmed design derivation preserve explicit target')

  await page.getByRole('tab', { name: '单元试拍', exact: true }).click()
  await page.getByRole('tab', { name: '拍摄准备', exact: true }).click()
  await page.getByRole('button', { name: '镜头范围', exact: true }).click()
  await page.locator('[data-workspace-target="unit:u1"] textarea').first().fill('计划另存后返回选定的历史依据')
  await open('cut'); await edit('cut', 'c-old'); await page.getByRole('button', { name: '保存后继续', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' }); await checkUrl('cut', 'c-old'); await checkUrl('plan', 'p-old')
  assert.equal(workspace.plans.at(-1).parent_id, 'p-old'); assert.equal(writes.length, 3)
  await open('cut'); await edit('cut', 'c-draft'); await checkUrl('cut', 'c-draft')
  await page.getByRole('button', { name: '保存剪辑草稿', exact: true }).click()
  assert.equal(workspace.cuts.at(-1).version, 2); assert.equal(writes.at(-1).body.revision_id, 'c-draft')
  await open('cut'); await edit('cut', 'c-old'); await checkUrl('cut', 'c-old')
  await page.getByRole('button', { name: '保存为新剪辑草稿', exact: true }).click()
  await page.waitForFunction(() => new URL(location.href).searchParams.get('cut')?.startsWith('cut-saved'))
  assert.equal(workspace.cuts.at(-1).parent_id, 'c-old'); assert.equal(workspace.cuts[0].content.items[0].take_id, 't2')
  await open('cut'); await dialog.getByRole('button', { name: '新剪辑草稿', exact: true }).click(); await checkUrl('cut', '')
  assert.ok((await page.locator('.cut-version-bar').innerText()).includes('当前采用：剪辑 2'))
  results.push('V07/V09: confirmed plan/cut derive, draft saves in place, new empty cut never adopts')

  await page.goto(`${base}?view=design&design=missing-design&plan=&cut=`)
  await open(); await dialog.getByText('所选设计不存在或不属于本场', { exact: true }).waitFor()
  await checkUrl('design', 'missing-design'); await edit('design', 'd1'); await checkUrl('design', 'd1')
  await page.goto(`${base}?view=cut&design=d1&plan=p-old&cut=missing-cut`)
  await open(); await dialog.getByText('所选剪辑不存在或不属于本场', { exact: true }).waitFor()
  await checkUrl('cut', 'missing-cut'); await edit('cut', 'c-old'); await checkUrl('cut', 'c-old')
  results.push('V10: invalid deep links retain identity until an explicit valid edit')

  // Sort and pagination must not renumber revisions or lose list state during inspection.
  for (let index = 0; index < 10; index++) workspace.designs.push({ ...revision(`extra-${index}`, structuredClone(workspace.designs[0].content)), created_at: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00Z` })
  await page.goto(`${base}?view=design&design=d1&plan=p-old&cut=c-active`)
  await open(); await dialog.locator('.ant-pagination-item-2').click()
  const secondPageId = await dialog.locator('tr[data-row-key]').first().getAttribute('data-row-key')
  const secondName = await row(secondPageId).locator('strong').innerText()
  await row(secondPageId).getByRole('button', { name: '查看版本' }).click(); await back()
  assert.equal(await dialog.locator('.ant-pagination-item-active').innerText(), '2')
  assert.equal(await row(secondPageId).locator('strong').innerText(), secondName)
  await close()
  workspace.designs.splice(3)
  results.push('V04: sorted/paginated list names stay stable and snapshot return preserves page')

  // Actual hit testing and screenshots at all planned widths, including long names and failed navigation reads.
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 }); failOverview = width === 375
    await page.goto(`${base}?view=design&design=d1&plan=p-old&cut=c-active`)
    const header = page.locator('.sequence-switcher-row'); await header.waitFor()
    if (failOverview) await page.getByRole('button', { name: '重试场次列表', exact: true }).waitFor()
    const boxes = await Promise.all(['.sequence-return', '.sequence-selector', '.sequence-step:nth-of-type(2)', '.sequence-step:nth-of-type(3)', '.workspace-versions-entry'].map(selector => header.locator(selector).boundingBox()))
    assert.ok(boxes.every(Boolean)); assert.ok(Math.max(...boxes.map(box => box.y + box.height / 2)) - Math.min(...boxes.map(box => box.y + box.height / 2)) < 2)
    const bounds = await header.boundingBox(); assert.ok(Math.abs(boxes.at(-1).x + boxes.at(-1).width - bounds.x - bounds.width) < 2)
    for (const selector of ['.sequence-return', '.sequence-selector', '.workspace-versions-entry']) assert.ok(await header.locator(selector).evaluate(element => { const box = element.getBoundingClientRect(); return box.x >= 0 && box.right <= innerWidth && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) }), `${width}: ${selector} unobscured`)
    assert.equal(await page.getByRole('button', { name: '上一场', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: '下一场', exact: true }).isDisabled(), true)
    if (width === 1440) {
      await page.getByRole('button', { name: '收起场次导航', exact: true }).click()
      let headerBounds = await header.boundingBox(), versionBounds = await page.locator('.workspace-versions-entry').boundingBox()
      assert.ok(Math.abs(versionBounds.x + versionBounds.width - headerBounds.x - headerBounds.width) < 2)
      await page.getByRole('button', { name: '展开场次导航', exact: true }).click()
      await page.getByRole('separator', { name: '调整场次导航宽度', exact: true }).press('ArrowRight')
      headerBounds = await header.boundingBox(); versionBounds = await page.locator('.workspace-versions-entry').boundingBox()
      assert.ok(Math.abs(versionBounds.x + versionBounds.width - headerBounds.x - headerBounds.width) < 2)
      await page.getByRole('separator', { name: '调整场次导航宽度', exact: true }).press('Home')
    }
    assert.equal((await page.locator('.workspace-versions-entry').innerText()).trim(), width < 768 ? '版本' : '版本与依据')
    await page.screenshot({ animations: 'disabled', path: join(output, `navigation-${width}.png`) })
    await open(); await row('d2').getByRole('button', { name: '查看版本' }).waitFor()
    await page.waitForFunction(() => { const element = document.querySelector('.workspace-version-dialog'); return element && getComputedStyle(element).opacity === '1' && !/zoom-(enter|appear)/.test(element.className) })
    await page.screenshot({ animations: 'disabled', path: join(output, `versions-${width}.png`) })
    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${width}: dialog does not overflow`)
    await row('d2').getByRole('button', { name: '查看版本' }).click()
    await page.screenshot({ animations: 'disabled', path: join(output, `detail-${width}.png`) }); await back()
    for (const id of ['d1', 'd2']) await row(id).getByRole('button', { name: '加入比较' }).click()
    await dialog.getByRole('button', { name: '比较所选版本' }).click()
    await page.screenshot({ animations: 'disabled', path: join(output, `compare-${width}.png`) })
    await close(); await page.waitForFunction(() => document.activeElement?.classList.contains('workspace-versions-entry'))
    await page.locator('.workspace-versions-entry').press('Enter'); await dialog.waitFor(); await dialog.getByRole('button', { name: /^关\s*闭$/ }).focus(); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: document fits`)
    if (failOverview) { failOverview = false; await page.getByRole('button', { name: '重试场次列表', exact: true }).click(); await page.getByRole('button', { name: '重试场次列表', exact: true }).waitFor({ state: 'hidden' }) }
    results.push(`V01/V02: ${width}px row alignment, right edge, hit targets, long name, disabled boundaries and keyboard`)
  }
  const beforeReadOnlyCases = writes.length
  await page.setViewportSize({ width: 1440, height: 900 })
  const secondUnit = { ...structuredClone(workspace.plans[0].content.units[0]), id: 'u2' }
  secondUnit.coverage[0].action_scope = '第二单元独立范围'
  workspace.plans[0].content.units.push(secondUnit)
  await page.goto(`${base}?view=design&design=d1&plan=p-old&cut=c-active`)
  await open('plan')
  const designFilter = dialog.getByRole('combobox', { name: '按固定设计筛选', exact: true }).locator('../..')
  await designFilter.click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: /^设计 2$/ }).click()
  await dialog.getByText('此设计暂无计划', { exact: true }).waitFor()
  await designFilter.hover(); await dialog.locator('.workspace-version-tools .ant-select-clear').click()
  await row('p-old').getByRole('button', { name: '查看版本' }).click()
  await dialog.getByRole('combobox', { name: '查看计划单元', exact: true }).locator('../..').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '单元 2 · u2' }).click()
  await dialog.locator('[data-workspace-target="unit:u2"]').waitFor()
  assert.equal(await dialog.locator('[data-workspace-target="unit:u2"] textarea').first().isDisabled(), true)
  assert.equal(await dialog.locator('[data-workspace-target="unit:u2"] textarea').first().inputValue(), '第二单元独立范围')
  await back(); await close(); workspace.plans[0].content.units.pop()

  // Broken fixed designs and foreign revisions remain explicit; viewing never substitutes current content.
  workspace.plans.push(revision('missing-basis', { ...structuredClone(workspace.plans[0].content), design_revision_id: 'not-found' }))
  workspace.designs.push({ ...revision('foreign', structuredClone(workspace.designs[0].content)), sequence_id: 'another' })
  workspace.takes[1].plan_revision_id = 'p-new'
  workspace.cuts[1].content.items[1].take_id = 't2'
  unavailableAdoption = true
  await page.goto(`${base}?view=design&design=d1&plan=p-old&cut=c-active`)
  await open('plan'); await dialog.getByText('当前采用待核对', { exact: true }).waitFor()
  assert.equal(await row('missing-basis').getByRole('button', { name: '基于此版本编辑' }).isDisabled(), true)
  await row('missing-basis').getByRole('button', { name: '查看版本' }).click()
  await dialog.getByText('此计划的固定设计暂不可用，当前设计不会代替历史依据', { exact: true }).waitFor()
  await tab('design'); assert.equal(await row('foreign').getByRole('button', { name: '基于此版本编辑' }).isDisabled(), true)
  await row('foreign').getByRole('button', { name: '查看版本' }).click()
  await dialog.getByText('指定的历史版本不存在或不属于本场次，请选择可用版本。', { exact: true }).waitFor()
  await tab('cut'); await row('c-active').getByRole('button', { name: '查看版本' }).click()
  await dialog.getByText('素材依据：计划 1、计划 2、预演 · 设计 1', { exact: true }).waitFor()
  assert.equal(await dialog.getByText('当前采用', { exact: true }).count(), 0)
  await close(); unavailableAdoption = false
  workspace.plans.pop(); workspace.designs.pop(); workspace.takes[1].plan_revision_id = 'p-old'; workspace.cuts[1].content.items[1].take_id = 't1'
  const designs = workspace.designs; workspace.designs = []
  await page.goto(`${base}?view=design&design=&plan=&cut=`); await open()
  await dialog.getByText('暂无版本', { exact: true }).waitFor(); await close(); workspace.designs = designs
  failWorkspace = true
  await page.goto(`${base}?view=design&design=d1&plan=p-old&cut=c-active`)
  await page.getByText('工作区暂不可用', { exact: true }).waitFor()
  assert.equal(await page.getByText('暂无版本', { exact: true }).count(), 0)
  failWorkspace = false
  assert.equal(writes.length, beforeReadOnlyCases)
  results.push('V04/V09/V10: all plan units are read-only; missing/foreign bases blocked; mixed-plan media traced; unknown adoption, empty list and failed reads are distinct')

  workspace.sequence.is_current = false
  await page.goto(`${base}?view=design&design=d1&plan=p-old&cut=c-active`)
  await page.getByText('历史场次 · 只读', { exact: true }).waitFor()
  await page.getByRole('button', { name: '返回版本列表', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: /^(继续编辑草稿|基于此版本编辑|新剪辑草稿)$/ }).count(), 0)
  await page.getByRole('tab', { name: '设计版本', exact: true }).click()
  await page.locator('tr[data-row-key="d2"]').getByRole('button', { name: '查看版本' }).click()
  await page.getByText('设计派生自：设计 1', { exact: true }).waitFor()
  results.push('V11: historical sequence shares list and snapshots with no edit actions')
  assert.deepEqual(errors, []); assert.ok(writes.every(row => row.path.endsWith('/revisions')))
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, writes, errors }, null, 2))
  console.log(JSON.stringify({ output, results, writes: writes.length, errors }))
} catch (error) {
  if (page) { await page.screenshot({ animations: 'disabled', path: join(output, 'failure.png') }).catch(() => {}); await writeFile(join(output, 'failure.txt'), await page.locator('body').innerText()).catch(() => {}) }
  console.error('Evidence:', output); throw error
} finally { await browser?.close(); await server.close() }
