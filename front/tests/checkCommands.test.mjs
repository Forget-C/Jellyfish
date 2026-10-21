import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import net from 'node:net'

const runner = fileURLToPath(new URL('./run-browser.mjs', import.meta.url))
const execute = (args, cwd = tmpdir()) => new Promise(resolve => {
  const child = spawn(process.execPath, [runner, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  child.on('close', code => resolve({ code, output }))
})
const fixture = async cases => {
  const dir = await mkdtemp(join(tmpdir(), 'jellyfish-command-check-'))
  await writeFile(join(dir, 'preflight.mjs'), "console.log('fixture preflight')")
  const manifest = join(dir, 'suite.json')
  await writeFile(manifest, JSON.stringify({ preflight: 'preflight.mjs', cases, suites: { fixture: Object.keys(cases) } }))
  return { dir, args: ['fixture', '--manifest', manifest, '--output', join(dir, 'output')] }
}

test('browser command runs declared cases serially and captures noisy output from another cwd', async () => {
  const { dir, args } = await fixture({ first: { file: 'first.mjs', ports: [], timeoutMs: 5000 }, second: { file: 'second.mjs', ports: [], timeoutMs: 5000 } })
  await writeFile(join(dir, 'first.mjs'), "import { writeFile } from 'node:fs/promises'; await new Promise(resolve => setTimeout(resolve, 30)); await writeFile(new URL('./finished', import.meta.url), 'done'); console.log('x'.repeat(10000));")
  await writeFile(join(dir, 'second.mjs'), "import { readFile } from 'node:fs/promises'; await readFile(new URL('./finished', import.meta.url)); console.log('second finished')")
  const result = await execute(args)
  assert.equal(result.code, 0, result.output)
  assert.ok(result.output.length < 3000, 'successful logs stay on disk')
  assert.match(await readFile(join(dir, 'output', 'first', 'run.log'), 'utf8'), /x{10000}/)
  assert.match(await readFile(join(dir, 'output', 'second', 'run.log'), 'utf8'), /second finished/)
})

test('browser command rejects an occupied port without running the case or stopping its owner', async () => {
  const owner = net.createServer()
  await new Promise(resolve => owner.listen(0, '127.0.0.1', resolve))
  try {
    const { dir, args } = await fixture({ busy: { file: 'busy.mjs', ports: [owner.address().port], timeoutMs: 5000 } })
    await writeFile(join(dir, 'busy.mjs'), "console.log('must not execute')")
    const result = await execute(args)
    assert.notEqual(result.code, 0)
    assert.match(result.output, /端口.*占用/)
    assert.equal(owner.listening, true)
    assert.doesNotMatch(result.output, /must not execute/)
  } finally { await new Promise(resolve => owner.close(resolve)) }
})

test('browser command times out and releases ports owned by its child process tree', async () => {
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const { dir, args } = await fixture({ slow: { file: 'slow.mjs', ports: [port], timeoutMs: 1000 } })
  const childSource = `const net = require('node:net'); const fs = require('node:fs'); process.on('SIGTERM', () => {}); const server = net.createServer(); server.listen(${port}, '127.0.0.1', () => fs.writeFileSync(${JSON.stringify(join(dir, 'ready'))}, 'ready')); setTimeout(() => server.close(), 3000);`
  await writeFile(join(dir, 'slow.mjs'), `import { spawn } from 'node:child_process'; import { access } from 'node:fs/promises'; spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], {stdio:'ignore'}); for (let i = 0; i < 100; i++) { try { await access(${JSON.stringify(join(dir, 'ready'))}); console.log('grandchild ready'); break } catch {} await new Promise(resolve => setTimeout(resolve, 10)) } setTimeout(() => process.exit(0), 2500);`)
  const result = await execute(args)
  assert.notEqual(result.code, 0, result.output)
  assert.match(result.output, /超时/)
  assert.match(await readFile(join(dir, 'output', 'slow', 'run.log'), 'utf8'), /grandchild ready/)
  const released = net.createServer()
  await new Promise((accept, reject) => { released.once('error', reject); released.listen(port, '127.0.0.1', accept) })
  await new Promise(resolve => released.close(resolve))
})

const lint = fileURLToPath(new URL('../scripts/lint-baseline.mjs', import.meta.url))
const runLint = (dir, mode) => new Promise(resolve => {
  const child = spawn(process.execPath, [lint, '--root', dir, ...(mode ? [mode] : [])], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  child.on('close', code => resolve({ code, output }))
})

test('lint command rejects new diagnostics and only permits baseline shrinkage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jellyfish-lint-check-'))
  await writeFile(join(dir, '.eslintrc.json'), JSON.stringify({ root: true, parserOptions: { ecmaVersion: 2020 }, rules: { 'no-var': 'error' } }))
  const source = join(dir, 'source.ts')
  await writeFile(source, 'var existing = 1;\n')
  assert.equal((await runLint(dir, '--init')).code, 0)
  assert.equal((await runLint(dir)).code, 0)
  await writeFile(source, 'var existing = 1;\nvar introduced = 2;\n')
  assert.notEqual((await runLint(dir)).code, 0, 'new diagnostic must fail the guard')
  assert.notEqual((await runLint(dir, '--prune')).code, 0, 'baseline maintenance cannot accept new debt')
  await writeFile(source, 'const existing = 1;\n')
  assert.notEqual((await runLint(dir)).code, 0, 'resolved allowances must be removed')
  assert.equal((await runLint(dir, '--prune')).code, 0)
  assert.equal((await runLint(dir)).code, 0)
  await writeFile(source, 'var existing = 1;\n')
  assert.notEqual((await runLint(dir)).code, 0, 'resolved debt cannot silently return')
})

test('browser command stops after failure and preserves the failing log and result', async () => {
  const { dir, args } = await fixture({ broken: { file: 'broken.mjs', ports: [], timeoutMs: 5000 }, later: { file: 'later.mjs', ports: [], timeoutMs: 5000 } })
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const childSource = `const fs = require('node:fs'); const server = require('node:net').createServer(); server.listen(${port}, '127.0.0.1', () => fs.writeFileSync(${JSON.stringify(join(dir, 'child.pid'))}, String(process.pid))); setTimeout(() => server.close(), 10000);`
  await writeFile(join(dir, 'broken.mjs'), `import { spawn } from 'node:child_process'; import { access } from 'node:fs/promises'; spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], {stdio:'ignore'}).unref(); for (;;) { try { await access(${JSON.stringify(join(dir, 'child.pid'))}); break } catch {} await new Promise(resolve => setTimeout(resolve, 10)) } console.error('controlled failure'); process.exit(7)`)

  await writeFile(join(dir, 'later.mjs'), "console.log('should not run')")
  const result = await execute(args)
  const released = net.createServer()
  try {
    await new Promise((accept, reject) => { released.once('error', reject); released.listen(port, '127.0.0.1', accept) })
  } catch (error) {
    process.kill(Number(await readFile(join(dir, 'child.pid'), 'utf8')), 'SIGKILL')
    throw error
  } finally { if (released.listening) await new Promise(resolve => released.close(resolve)) }
  assert.equal(result.code, 1)
  assert.match(result.output, /controlled failure/)
  assert.match(await readFile(join(dir, 'output', 'broken', 'run.log'), 'utf8'), /controlled failure/)
  const records = JSON.parse(await readFile(join(dir, 'output', 'results.json'), 'utf8'))
  assert.deepEqual(records.map(row => [row.name, row.status]), [['preflight', 'passed'], ['broken', 'failed']])
})

test('interrupting the browser command stops its active case and records the signal', async () => {
  const { dir, args } = await fixture({ active: { file: 'active.mjs', ports: [], timeoutMs: 10000 } })
  await writeFile(join(dir, 'active.mjs'), "console.log('case ready'); setTimeout(() => {}, 10000)")
  const child = spawn(process.execPath, [runner, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const exited = new Promise(resolve => child.on('close', resolve))
  try {
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await readFile(join(dir, 'output', 'active', 'run.log'), 'utf8')).includes('case ready') } catch {}
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(ready, true, output)
    child.kill('SIGTERM')
    assert.equal(await exited, 143, output)
    assert.match(output, /SIGTERM/)
    const records = JSON.parse(await readFile(join(dir, 'output', 'results.json'), 'utf8'))
    assert.equal(records.at(-1).status, 'failed')
  } finally { if (child.exitCode === null) child.kill('SIGTERM') }
})
