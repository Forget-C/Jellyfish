import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeWorkspace, clip } from './directing-fixtures.mjs'

const require = createRequire(import.meta.url)
const { buildSync } = createRequire(require.resolve('vite'))('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const directory = mkdtempSync(join(tmpdir(), 'jellyfish-cut-items-'))
const output = join(directory, 'cut-items.cjs')
buildSync({ entryPoints: [new URL('../src/pages/aiStudio/directing/WorkspaceHistory.tsx', import.meta.url).pathname], outfile: output, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external' })
symlinkSync(new URL('../node_modules', import.meta.url).pathname, join(directory, 'node_modules'), 'dir')
const { CutItems } = require(output)
rmSync(directory, { recursive: true, force: true })

test('historical cut reading preserves exact source ranges and distinguishes planned duration', () => {
  const workspace = makeWorkspace()
  const cut = { items: [clip('range', 't1', 1234, 5678), { id: 'preview', design_revision_id: workspace.designs[0].id, shot_id: 'shot1', estimated_duration_ms: 2500 }] }
  const before = structuredClone({ cut, workspace })
  const markup = renderToStaticMarkup(React.createElement(CutItems, { cut, workspace }))
  assert.match(markup, /1\.234–5\.678/)
  assert.match(markup, /预演/)
  assert.match(markup, /预计 2\.5 秒/)
  assert.deepEqual({ cut, workspace }, before)
})

test('historical cut reading shows an empty list without inventing footage', () => {
  const markup = renderToStaticMarkup(React.createElement(CutItems, { cut: { items: [] }, workspace: makeWorkspace() }))
  assert.match(markup, /没有剪辑项/)
  assert.doesNotMatch(markup, /源区间|预计/)
})
