import { browserOutput, browserCleanup } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = await browserOutput('jellyfish-workbench-ui-')
const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4195, strictPort: true, open: false } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.goto('http://127.0.0.1:4195/dev/workbench-ui')
  const examples = page.locator('.wb-examples')
  await examples.getByRole('heading', { name: '工作台组件标准', exact: true }).waitFor()
  const main = examples.getByRole('button', { name: '生成设计', exact: true })
  const secondary = examples.getByRole('button', { name: '发起新设计', exact: true })
  const colors = async locator => locator.evaluate(node => { const s = getComputedStyle(node); return { background: s.backgroundColor, color: s.color, outline: s.outlineWidth } })
  assert.notEqual((await colors(main)).background, (await colors(secondary)).background)
  assert.equal(await examples.getByRole('button', { name: '不可应用', exact: true }).isDisabled(), true)
  assert.equal(await examples.getByRole('button', { name: '生成中', exact: true }).getAttribute('data-variant'), 'primary')
  const danger = await colors(examples.getByRole('button', { name: '删除', exact: true }))
  const channels = danger.color.match(/\d+/g).map(Number)
  assert.ok(channels[0] > channels[1] && channels[0] > channels[2], danger.color)
  await main.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  assert.equal((await colors(main)).outline, '1px')
  await examples.getByRole('button', { name: '刷新', exact: true }).hover()
  await page.getByRole('tooltip').getByText('刷新', { exact: true }).waitFor()
  const selection = examples.getByRole('button', { name: '选择范围', exact: true })
  await selection.click()
  assert.equal(await selection.getAttribute('aria-pressed'), 'true')
  assert.equal(await examples.getByRole('button', { name: '展开短文', exact: true }).count(), 0)
  await examples.getByRole('button', { name: '展开示例原文', exact: true }).click()
  assert.equal(await examples.getByRole('button', { name: '收起示例原文', exact: true }).getAttribute('aria-expanded'), 'true')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await examples.getByRole('button', { name: '打开示例弹窗', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '组件状态示例', exact: true })
    const expand = dialog.locator('.canvas-text-preview button')
    await expand.waitFor()
    if (await expand.getAttribute('aria-expanded') !== 'true') await expand.click()
    assert.equal(await expand.getAttribute('aria-expanded'), 'true')
    const body = dialog.locator('.ant-modal-body')
    assert.equal(await body.evaluate(node => getComputedStyle(node).scrollbarGutter), 'stable')
    await body.evaluate(node => { node.scrollTop = 200 })
    const action = dialog.getByRole('button', { name: '完成检查', exact: true })
    await action.click({ trial: true })
    const bounds = await action.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 960)
    await page.screenshot({ path: join(output, `components-${width}.png`), animations: 'disabled' })
    await action.focus()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
  }
  console.log(`PASS workbench component states, accessible actions, long text and responsive modal; evidence: ${output}`)
} finally { await cleanup() }
