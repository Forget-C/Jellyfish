import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite'))('esbuild')

/** Bundle the actual local dependencies, including translation resources, for Node's unit runner. */
export async function loadFrontendModule(path) {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL('../src/' + path + '.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm',
  })
  return import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'))
}
