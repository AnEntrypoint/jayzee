import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runPlayerVatScenario, VAT_GROUPS } from './lib/playerVatScenario.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['client/core/PlayerVAT.js', 'client/core/PlayerVATTSL.js', 'client/core/WebGPUInstancing.js']
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: spointRoot }).toString().trim()
const version = (pkg) => JSON.parse(readFileSync(join(here, '..', 'node_modules', pkg, 'package.json'), 'utf8')).version
const mapped = {
  'three': import.meta.resolve('three'),
  'three/tsl': import.meta.resolve('three/tsl'),
  'three/webgpu': import.meta.resolve('three/webgpu'),
  '@three.ez/instanced-mesh': import.meta.resolve('@three.ez/instanced-mesh'),
}
const vatUrl = pathToFileURL(join(spointRoot, 'client/core/PlayerVAT.js')).href
const appended = String.fromCharCode(10) + 'export { _advanceVatPhase as advanceVatPhase, _vatBlendRates as vatBlendRates }' + String.fromCharCode(10)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(mapped, specifier)) return { url: mapped[specifier], shortCircuit: true }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === vatUrl) {
      const loaded = nextLoad(url, context)
      return { format: 'module', source: String(loaded.source) + appended, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})
const spointVat = await import(vatUrl)
const spointTsl = await import(pathToFileURL(join(spointRoot, 'client/core/PlayerVATTSL.js')).href)
const api = {
  advance: spointVat.advanceVatPhase,
  rates: spointVat.vatBlendRates,
  createRenderer: spointVat.createVATCrowdRenderer,
  createMaterial: spointVat.createVATMaterial,
  createMaterialTSL: spointTsl.createVATMaterialTSL,
}
const rows = runPlayerVatScenario(api)
const labels = VAT_GROUPS.flatMap((g) => g.labels)
if (rows.length !== labels.length) throw new Error('scenario emitted ' + rows.length + ' rows for ' + labels.length + ' labels')
const out = join(here, 'fixtures', 'spoint', 'player-vat.json')
writeFileSync(out, JSON.stringify({ source: { commit, three: version('three'), instancedMesh: version('@three.ez/instanced-mesh'), files, sha256: Object.fromEntries(files.map((f) => [f, sha256(f)])) }, rows }, null, 2) + String.fromCharCode(10))
console.log('wrote ' + out + ' with ' + rows.length + ' rows')

