import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-write-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4183, strictPort: true, open: false } })
let browser, pendingSave
const workspace = makeWorkspace(), styles = [], errors = [], checks = []
const feedback = { active_cut_revision_id: 'c-active', current_review_id: null, reviews: [], repairs: [], knowledge: [] }
const continuity = { active_cut_revision_id: 'c-active', units: [], seams: [{ left_item_id: 'a', right_item_id: 'b', status: 'pending' }], frames: [
  { id: 'left-frame', item_id: 'a', edge: 'end', current: true, at_ms: 1999, file_id: 'left-image' },
  { id: 'right-frame', item_id: 'b', edge: 'start', current: true, at_ms: 4000, file_id: 'right-image' },
] }
let mediaFails = true, writes = 0
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) return respond(request.postDataJSON().sources.map(source => ({ source, status: source.kind === 'human' ? 'ready' : 'unavailable', label: source.kind === 'human' ? '人工填写' : '历史来源', description: '隔离来源记录' })))
    if (request.method() !== 'GET') {
      writes++
      const body = request.postDataJSON()
      // Hold the response until the test attempts a second edit or navigation.
      await new Promise(resolve => {
        pendingSave = async (fail = false) => {
          pendingSave = undefined
          if (fail) await route.fulfill({ status: 409, json: { detail: '专项回归：保存冲突，修改已保留' } })
          else if (path.endsWith('/revisions') || path.endsWith('/feedback') || path.endsWith('/styles')) {
            const group = path.endsWith('/styles') ? styles : path.endsWith('/feedback') ? feedback.knowledge : ({ design: workspace.designs, plan: workspace.plans, cut: workspace.cuts })[body.document.kind]
            let row = group.find(row => row.id === body.revision_id)
            if (row) { row.content = body.document.content; row.version++ }
            else { row = revision(`saved-${group.length}`, body.content || body.document.content, false); group.push(row) }
            await respond(path.endsWith('/styles') ? styles : path.endsWith('/feedback') ? feedback : workspace)
          } else if (/\/takes\/[^/]+$/.test(path)) {
            const take = workspace.takes.find(row => row.id === path.split('/').at(-1))
            take.annotation = body.annotation; take.version++
            await respond(workspace)
          } else if (path.endsWith('/seam-reviews')) {
            continuity.seams[0].rationale = body.rationale; continuity.seams[0].status = body.verdict
            await respond(continuity)
          } else throw new Error(`Unexpected write: ${path}`)
          resolve()
        }
      })
      return
    }
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/s1/feedback')) return respond(feedback)
    if (path.endsWith('/s1/continuity')) return respond(continuity)
    if (path.endsWith('/styles')) return respond(styles)
    if (path.endsWith('/media')) return mediaFails ? route.fulfill({ status: 503, json: { detail: '媒体临时不可用' } }) : respond({ take_id: path.split('/').at(-2), file_id: 'file', duration_ms: 6000, url: '/api/sample.mp4' })
    if (path.endsWith('/sample.mp4')) return route.fulfill({ status: 204 })
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(assets|batches|models)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4183/projects/p1/chapters/ch1/sequences/s1'
  async function waiting() {
    for (let i = 0; !pendingSave && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(pendingSave, 'save request started')
    await page.locator('fieldset[inert]').first().waitFor()
  }
  async function release(fail = false) {
    await pendingSave(fail)
    await page.locator('fieldset[inert]').first().waitFor({ state: 'detached' })
  }
  async function choose(label, option) {
    await page.getByRole('combobox', { name: label, exact: true }).locator('../..').click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: option }).first().click()
  }
  async function checkTextSave(name, field, button, persisted) {
    await field.fill(`${name}：第一次修改`)
    await page.getByRole('button', { name: button, exact: true }).click(); await waiting()
    assert.equal(await field.isEditable(), false)
    assert.equal(await field.fill('不应写入', { timeout: 250 }).then(() => true, () => false), false)
    await release(true)
    assert.equal(await field.inputValue(), `${name}：第一次修改`)
    await field.fill(`${name}：失败后修订`)
    await page.getByRole('button', { name: button, exact: true }).click(); await waiting()
    assert.equal(await field.isEditable(), false)
    await release()
    assert.equal(await field.inputValue(), `${name}：失败后修订`)
    assert.equal(persisted(), `${name}：失败后修订`)
    assert.equal(await field.isEditable(), true)
    checks.push(`${name}：延迟成功/失败期间禁止新输入，失败保留并可重试，成功恢复编辑`)
  }
  await page.goto(base + '?view=shoot&design=d2&plan=p-new&unit=u1')
  await page.getByRole('tab', { name: '导演设计', exact: true }).click()
  await page.getByRole('tab', { name: '清单', exact: true }).click()
  await page.locator('.design-intent').getByRole('button', { name: /全场概览/ }).click()
  const field = page.locator('textarea[aria-label="本场信息变化"]')
  await checkTextSave('设计', field, '保存设计草稿', () => workspace.designs[1].content.direction.information_change.text)

  // Browser back is outside the inert workspace. It must not discard an in-flight write.
  await field.fill('导航期间保存')
  await page.getByRole('button', { name: '保存设计草稿', exact: true }).click(); await waiting()
  const beforeWrites = writes
  await page.evaluate(() => history.back())
  const modal = page.locator('.ant-modal-content')
  await modal.getByText('当前操作尚未完成', { exact: true }).waitFor()
  assert.equal(await modal.getByRole('button', { name: '放弃修改并继续' }).isDisabled(), true)
  assert.equal(await modal.getByRole('button', { name: '保存后继续' }).isDisabled(), true)
  await modal.getByRole('button', { name: '留在当前页' }).click()
  assert.equal(writes, beforeWrites)
  await release()
  assert.equal(await field.inputValue(), '导航期间保存')
  checks.push('浏览器后退被保护，等待中不能放弃或重复保存，取消切换保留当前页')
  await field.fill('保存完成后继续导航')
  await page.getByRole('button', { name: '保存设计草稿', exact: true }).click(); await waiting()
  await page.evaluate(() => history.back())
  await modal.getByText('当前操作尚未完成', { exact: true }).waitFor()
  await release()
  await modal.getByText('当前操作已结束', { exact: true }).waitFor()
  const completedWrites = writes
  await modal.getByRole('button', { name: /^继\s*续$/ }).click()
  await page.waitForURL(url => url.searchParams.get('view') === 'shoot')
  assert.equal(writes, completedWrites)
  checks.push('等待中的导航在保存完成后可继续，不重复提交已保存内容')

  await page.goto(base + '?view=shoot&plan=p-new&unit=u1')
  await page.getByRole('button', { name: '镜头范围', exact: true }).click()
  await checkTextSave('生产计划', page.locator('[data-workspace-target="unit:u1"] textarea').first(), '保存生产计划草稿', () => workspace.plans[1].content.units[0].coverage[0].action_scope)

  await page.goto(base + '?view=design&design=d2')
  await page.getByRole('button', { name: /^本场资产/ }).click()
  await page.getByRole('button', { name: '新建风格候选', exact: true }).click()
  await checkTextSave('项目风格', page.locator('input[aria-label="风格标题"]'), '保存风格草稿', () => styles.at(-1).content.title)

  await page.goto(base + '?view=feedback')
  await page.getByRole('button', { name: '新建经验候选', exact: true }).click()
  await checkTextSave('反馈', page.locator('[aria-label="适用条件"]'), '保存反馈草稿', () => feedback.knowledge.at(-1).content.conditions)

  await page.goto(base + '?view=cut&cut=c-draft&take=t1')
  await page.getByText('部分素材暂时无法读取；其余素材仍可审片，缺失素材请在保存修改后重新加载页面重试。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '添加节奏预演', exact: true }).click()
  await choose('预演设计版本', '设计 1'); await choose('预演镜头', 'shot1')
  await page.getByRole('button', { name: '添加预演卡', exact: true }).click()
  await page.locator('.ant-drawer-open').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '保存剪辑草稿', exact: true }).click(); await waiting()
  const add = page.locator('button').filter({ hasText: /^添加预演卡$/ })
  assert.equal(await add.isDisabled(), true)
  assert.equal(await add.click({ timeout: 250 }).then(() => true, () => false), false)
  await release(true)
  assert.equal(await page.locator('[data-timeline-item]').count(), 1)
  await page.getByRole('button', { name: '添加节奏预演', exact: true }).click()
  await add.click()
  await page.locator('.ant-drawer-open').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '保存剪辑草稿', exact: true }).click(); await waiting()
  assert.equal(await add.isDisabled(), true)
  await release()
  assert.equal(await page.locator('[data-timeline-item]').count(), 2)
  assert.equal(workspace.cuts.find(row => row.id === 'c-draft').content.items.length, 2)
  checks.push('剪辑：延迟响应期间不能增删片段，失败保留草稿，继续编辑并重试后两张预演卡完整保存')

  mediaFails = false
  await page.reload(); await page.getByLabel('当前候选播放器', { exact: true }).waitFor()
  checks.push('媒体：提示明确要求保存后重新加载页面，重新加载后恢复素材读取')
  await page.locator('textarea[aria-label="实际观察"]').waitFor()
  await checkTextSave('素材审片', page.locator('textarea[aria-label="实际观察"]'), '保存审片', () => workspace.takes[0].annotation.rationale.text)
  await page.goto(base + '?view=continuity')
  await choose('前段落幅', '落幅 1'); await choose('后段入幅', '入幅 1')
  await checkTextSave('接缝审查', page.locator('textarea[aria-label="接缝审查说明"]'), '保存人工接缝审查', () => continuity.seams[0].rationale)
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2))
  console.log(JSON.stringify({ checks, output }, null, 2))
} finally { await pendingSave?.(true); await browser?.close(); await server.close() }
