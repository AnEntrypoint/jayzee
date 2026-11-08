import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runSsrScenario } from './lib/ssrScenario.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['client/core/SSR.js']
const dependencies = ['client/core/RenderControls.js', 'client/core/ProgramReadiness.js', 'client/core/WetnessTint.js', 'client/core/UnderwaterTint.js']
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const commit = execFileSync('git', ['log', '-1', '--format=%h', '--', ...files], { cwd: spointRoot }).toString().trim()

const mapped = {
  three: import.meta.resolve('three'),
  'three/tsl': import.meta.resolve('three/tsl'),
  'three/webgpu': import.meta.resolve('three/webgpu'),
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(mapped, specifier)) return { url: mapped[specifier], shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const spoint = (file) => import(pathToFileURL(join(spointRoot, file)).href)
const ssrMod = await spoint('client/core/SSR.js')
const wetMod = await spoint('client/core/WetnessTint.js')
const { RenderControls } = await spoint('client/core/RenderControls.js')

const keys = ['ssr', 'ssao', 'ssrIntensity', 'ssrMaxDistance', 'ssrBandHeight']
const controls = Object.fromEntries(keys.map((k) => [k, RenderControls.get(k)]))

const readDefault = RenderControls.get
const overrides = {}
RenderControls.get = (key) => (Object.hasOwn(overrides, key) ? overrides[key] : readDefault(key))

const { rows } = runSsrScenario({
  make: (renderer, scene, camera) => new ssrMod.SSR(renderer, scene, camera),
  buildSSRNodes: () => ssrMod.buildSSRNodes(),
  install: (ctx, renderer, scene, camera) => ssrMod.installSSR(ctx, renderer, scene, camera),
  setWetness: (w) => wetMod.setWetness(w, null),
  setControl: (key, value) => { overrides[key] = value },
})

const fixture = {
  source: { commit, files, sha256: Object.fromEntries(files.map((f) => [f, sha256(f)])) },
  dependencies: { files: dependencies, sha256: Object.fromEntries(dependencies.map((f) => [f, sha256(f)])) },
  controls,
  rows,
}
const out = join(here, 'fixtures', 'spoint', 'ssr.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + String.fromCharCode(10))
console.log('wrote ' + out + ' with ' + rows.length + ' rows at ' + commit + ' controls ' + JSON.stringify(controls))
