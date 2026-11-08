import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runBloomScenario } from './lib/bloomScenario.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['client/core/Bloom.js']
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
const bloomMod = await import(pathToFileURL(join(spointRoot, 'client/core/Bloom.js')).href)
const controlsMod = await import(pathToFileURL(join(spointRoot, 'client/core/RenderControls.js')).href)
const keys = ['bloom', 'bloomThreshold', 'bloomIntensity', 'bloomResolutionScale', 'bloomBlurPasses']
const controls = Object.fromEntries(keys.map((k) => [k, controlsMod.RenderControls.get(k)]))

const { rows } = runBloomScenario({
  make: (renderer) => new bloomMod.Bloom(renderer),
  buildBloomNodes: () => bloomMod.buildBloomNodes(),
})

const fixture = { source: { commit, files, sha256: Object.fromEntries(files.map((f) => [f, sha256(f)])) }, controls, rows }
const out = join(here, 'fixtures', 'spoint', 'bloom.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + String.fromCharCode(10))
console.log('wrote ' + out + ' with ' + rows.length + ' rows at ' + commit + ' controls ' + JSON.stringify(controls))
