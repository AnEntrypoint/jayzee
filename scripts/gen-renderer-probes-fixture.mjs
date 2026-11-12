import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { HOST_GLOBALS, runRendererProbes } from './lib/rendererProbeScenario.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['client/core/SceneSetup.js', 'client/core/WebGPUCullingProbe.js']
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const commit = execFileSync('git', ['log', '-1', '--format=%h', '--', ...files], { cwd: spointRoot }).toString().trim()

registerHooks({
  resolve(specifier, context, nextResolve) {
    const bare = !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:') && !specifier.startsWith('node:')
    if (bare) {
      const [name, ...rest] = specifier.split('/')
      const packageDir = join(spointRoot, 'packages', name)
      if (existsSync(join(packageDir, 'package.json'))) {
        const exportsMap = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).exports
        const target = exportsMap[rest.length ? './' + rest.join('/') : '.']
        if (typeof target === 'string') return { url: pathToFileURL(join(packageDir, target)).href, shortCircuit: true }
      }
      try {
        return { url: import.meta.resolve(specifier), shortCircuit: true }
      } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})
const sceneSetup = await import(pathToFileURL(join(spointRoot, files[0])).href)
const cullingProbe = await import(pathToFileURL(join(spointRoot, files[1])).href)

const withGlobals = (probe) => async (host) => {
  const saved = HOST_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
  for (const name of HOST_GLOBALS) Object.defineProperty(globalThis, name, { value: host[name], configurable: true, writable: true })
  try {
    return await probe()
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
}

const rows = await runRendererProbes({
  probeWebGL2: withGlobals(() => sceneSetup.probeWebGL2()),
  probeOffscreenCanvasWorkerRendering: withGlobals(() => sceneSetup.probeOffscreenCanvasWorkerRendering()),
  probeWebGPU: withGlobals(() => cullingProbe.probeWebGPU()),
})

const fixture = { source: { commit, files, sha256: Object.fromEntries(files.map((f) => [f, sha256(f)])), note: 'spoint probeWebGL2, probeOffscreenCanvasWorkerRendering and probeWebGPU read browser globals, so each case installs the fake host of scripts/lib/rendererProbeScenario.mjs on globalThis for the call.' }, rows }
fixture.sha256 = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
const out = join(here, 'fixtures', 'spoint', 'renderer-probes.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + String.fromCharCode(10))
console.log('wrote ' + out + ' with ' + rows.length + ' rows at ' + commit)
