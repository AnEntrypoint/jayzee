import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runDotWebGPUScenario } from './lib/dotWebGPUScenario.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['client/core/PlayerLOD.js', 'client/core/PlayerLODTSL.js', 'client/core/WebGPUInstancing.js']
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: spointRoot }).toString().trim()
const threeVersion = JSON.parse(readFileSync(join(here, '..', 'node_modules', 'three', 'package.json'), 'utf8')).version
const mapped = {
  'three': import.meta.resolve('three'),
  'three/tsl': import.meta.resolve('three/tsl'),
  'three/webgpu': import.meta.resolve('three/webgpu'),
  '@three.ez/instanced-mesh': pathToFileURL(join(here, 'lib', 'instancedMesh2Stub.mjs')).href,
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(mapped, specifier)) return { url: mapped[specifier], shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const spoint = await import(pathToFileURL(join(spointRoot, 'client/core/PlayerLOD.js')).href)
const crowdDots = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'crowd-dots.json'), 'utf8')).crowd.dots
const rows = runDotWebGPUScenario((scene, opts) => spoint.createCrowdDotRenderer(scene, opts), crowdDots)
const out = join(here, 'fixtures', 'spoint', 'player-lod-renderer-webgpu.json')
writeFileSync(out, JSON.stringify({ source: { commit, three: threeVersion, files, sha256: Object.fromEntries(files.map((f) => [f, sha256(f)])) }, rows }, null, 2) + '\n')
console.log('wrote ' + out + ' with ' + rows.length + ' rows')
