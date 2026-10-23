import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/services/eventStream.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } })
// Generated header/auth code remains real; compile its local imports for Node's test runner.
const modules = new Map()
async function moduleUrl(path) {
  if (modules.has(path)) return modules.get(path)
  let { outputText } = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } })
  for (const match of [...outputText.matchAll(/from ['"](\.[^'"]+)['"]/g)]) outputText = outputText.replace(match[0], `from '${await moduleUrl(new URL(`${match[1]}.ts`, path))}'`)
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  modules.set(path, url); return url
}
let compiled = outputText
for (const match of [...compiled.matchAll(/from ['"](\.[^'"]+)['"]/g)]) compiled = compiled.replace(match[0], `from '${await moduleUrl(new URL(`../src/services/${match[1]}.ts`, import.meta.url))}'`)
const { connectEventStream } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('stream delivers split unicode and multiline SSE before EOF, then reconnects using the confirmed cursor and generated auth', async () => {
  let connections = 0, transport, timer
  const headers = []
  const server = createServer((request, response) => {
    headers.push(request.headers)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    connections++
    if (connections === 1) {
      assert.equal(new URL(request.url, 'http://localhost').searchParams.has('cursor'), false)
      const bytes = Buffer.from(': heartbeat\r\nid: 7\r\nevent: text.delta\r\ndata: {"cursor":7,\r\ndata: "text":"片😀"}\r\n\r\n')
      const emoji = bytes.indexOf(Buffer.from('😀'))
      response.write(bytes.subarray(0, emoji + 2))
      timer = setTimeout(() => response.write(bytes.subarray(emoji + 2)), 10)
      // EOF occurs only after the consumer has already seen the increment.
      timer = setTimeout(() => response.end(), 100)
    } else {
      assert.equal(new URL(request.url, 'http://localhost').searchParams.get('cursor'), '7')
      response.write('id: 7\ndata: {"cursor":7,"text":"duplicate"}\n\nid: 8\ndata: {"cursor":8,"text":"后续"}\n\n')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const events = []
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('stream stalled')), 3000)
      transport = connectEventStream({ url: () => Promise.resolve(`http://127.0.0.1:${server.address().port}/events`),
        config: { BASE: '', VERSION: '1', WITH_CREDENTIALS: true, CREDENTIALS: 'include', TOKEN: async () => 'token', HEADERS: async () => ({ 'X-Project': 'test' }) }, reconnectMs: 5,
        onEvent: event => {
          events.push(event)
          if (events.length === 1) assert.equal(connections, 1, 'increment is visible while first response is open')
          if (event.cursor === 8) { clearTimeout(deadline); resolve() }
        } })
    })
    assert.deepEqual(events.map(event => event.text), ['片😀', '后续'])
    assert.equal(headers[0].authorization, 'Bearer token')
    assert.equal(headers[0]['x-project'], 'test')
    assert.equal(headers[0].accept, 'text/event-stream')
  } finally { transport?.close(); clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
