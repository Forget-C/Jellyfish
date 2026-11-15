import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-retired-labs-')
let server, browser
const cleanup = browserCleanup(() => ({ server, browser }))
try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4184, strictPort: true } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage()
  await page.route('**/api/**', route => route.fulfill({ json: { success: true, data: { items: [], total: 0 } } }))
  for (const mode of ['text', 'image', 'video']) {
    await page.goto(`http://127.0.0.1:4184/${mode}-lab?session=old-session&keep=1`)
    await page.getByText('404', { exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, `/${mode}-lab`)
    await page.screenshot({ path: `${output}/${mode}-retired.png` })
  }
  console.log('Three retired lab addresses return the not-found page.')
} finally {
  await cleanup()
}
