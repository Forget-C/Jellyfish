import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const checker = fileURLToPath(new URL('./check-browser-manifest.mjs', import.meta.url))
const run = manifest => spawnSync(process.execPath, [checker, ...(manifest ? ['--manifest', manifest] : [])], { encoding: 'utf8' })
const fixture = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jellyfish-manifest-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manifest = { preflight: 'preflight.mjs', cases: { sample: { file: 'sample.browser.mjs', ports: [4205], timeoutMs: 180000 } }, suites: { workbench: ['sample'] }, excludedFiles: {}, nonDefaultCases: {} }
  for (const file of ['preflight.mjs', 'sample.browser.mjs']) await writeFile(join(dir, file), '')
  const check = async () => {
    const path = join(dir, 'browser-suites.json')
    await writeFile(path, JSON.stringify(manifest))
    const result = run(path)
    return { code: result.status, output: result.stdout + result.stderr }
  }
  return { dir, manifest, check }
}

test('manifest command accepts a registered reachable browser test', async t => {
  const { check } = await fixture(t)
  const result = await check()
  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /PASS/)
})

test('manifest command rejects new unregistered browser files, including nested files', async t => {
  const { dir, manifest, check } = await fixture(t)
  await mkdir(join(dir, 'nested'))
  await writeFile(join(dir, 'nested/new.browser.mjs'), '')
  let result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /未登记.*nested\/new.browser.mjs/)
  manifest.excludedFiles['nested/new.browser.mjs'] = '存量未登记，接入状态尚未核验'
  result = await check()
  assert.equal(result.code, 0, result.output)
  manifest.excludedFiles['nested/new.browser.mjs'] = '  '
  result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /理由.*nested\/new.browser.mjs/)
})

test('manifest command rejects stale and conflicting file declarations', async t => {
  const { manifest, check } = await fixture(t)
  manifest.excludedFiles['gone.browser.mjs'] = '历史遗漏'
  let result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /排除文件不存在.*gone.browser.mjs/)
  delete manifest.excludedFiles['gone.browser.mjs']
  manifest.excludedFiles['sample.browser.mjs'] = '历史遗漏'
  result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /登记与排除冲突.*sample.browser.mjs/)
  delete manifest.excludedFiles['sample.browser.mjs']
  manifest.cases.sample.file = 'gone.browser.mjs'
  result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /用例文件不存在.*gone.browser.mjs/)
})

test('manifest command requires default reachability or an explicit non-default reason', async t => {
  const { manifest, check } = await fixture(t)
  manifest.suites.workbench = []
  let result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /套件不可达.*sample/)
  manifest.nonDefaultCases.sample = '存量已登记但未加入套件，接入状态尚未核验'
  result = await check()
  assert.equal(result.code, 0, result.output)
  manifest.nonDefaultCases.sample = ''
  result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /理由.*sample/)
  manifest.nonDefaultCases.sample = '历史遗漏'
  manifest.suites.workbench = ['sample']
  result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /默认执行与排除冲突.*sample/)
  delete manifest.nonDefaultCases.sample
  manifest.nonDefaultCases.gone = '历史遗漏'
  result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /排除用例不存在.*gone/)
  delete manifest.nonDefaultCases.gone
  manifest.suites.workbench.push('gone')
  result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /套件引用不存在.*gone/)
})

test('manifest command rejects invalid runner metadata and duplicate registrations', async t => {
  const { dir, manifest, check } = await fixture(t)
  for (const [field, value] of [['ports', [0]], ['timeoutMs', 0], ['file', '../outside.browser.mjs']]) {
    const saved = manifest.cases.sample[field]
    manifest.cases.sample[field] = value
    const result = await check()
    assert.notEqual(result.code, 0)
    assert.match(result.output, /无效用例.*sample/)
    manifest.cases.sample[field] = saved
  }
  manifest.cases.duplicate = { ...manifest.cases.sample }
  let result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /重复登记.*sample.browser.mjs/)
  delete manifest.cases.duplicate
  manifest.suites.workbench = 'sample'
  result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /无效套件.*workbench/)
  manifest.suites.workbench = ['sample']
  await rm(join(dir, 'preflight.mjs'))
  result = await check()
  assert.notEqual(result.code, 0)
  assert.match(result.output, /预检文件不存在/)
})

test('repository manifest accounts for every browser file and target regressions run by default', () => {
  const result = run()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const runner = fileURLToPath(new URL('./run-browser.mjs', import.meta.url))
  for (const selection of ['all', 'workbench']) {
    const listed = spawnSync(process.execPath, [runner, selection, '--list'], { encoding: 'utf8' })
    assert.equal(listed.status, 0, listed.stderr)
    const cases = JSON.parse(listed.stdout)
    for (const file of ['chapterListEditor.browser.mjs', 'sceneCanvasLegacyRoutes.browser.mjs']) {
      assert.equal(cases.filter(item => item.file === file).length, 1, `${selection}: ${file}`)
    }
  }
})
