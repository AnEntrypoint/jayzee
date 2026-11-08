import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const NL = String.fromCharCode(10)
const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(here, 'fixtures', 'spoint')
const playerLodPath = join(spointRoot, 'client/core/PlayerLOD.js')
const stubPath = join(here, 'lib', 'instancedMesh2Stub.mjs')
const source = readFileSync(playerLodPath, 'utf8')

const find = (needle, from = 0) => {
  const i = source.indexOf(needle, from)
  if (i < 0) throw new Error('spoint client/core/PlayerLOD.js no longer has ' + needle)
  return i
}
const closeOf = (start) => find(NL + '}' + NL, start) + 3
const fallbackAt = find('const _dotFallbackScratch = []')
const installAt = find('export function installPlayerLOD(scene, opts = {})')
const tierSlice = source.slice(find('export const PLAYER_LOD_FULL_COUNT'), find(NL, find('function _byD2(a, b)')) + 1)
const dotSlice = source.slice(find('function makeDotGeo(size)'), closeOf(find('function createCrowdDotRendererWebGL(scene, opts)')))
const fallbackSlice = source.slice(fallbackAt, find(NL, fallbackAt) + 1)
const installSlice = source.slice(installAt, closeOf(installAt))
const prefix = [
  "import * as THREE from 'three'",
  "import { InstancedMesh2 } from '" + pathToFileURL(stubPath).href + "'",
  'const createCrowdDotRenderer = (scene, opts) => createCrowdDotRendererWebGL(scene, opts)',
].join(NL)
const substituted = [prefix, tierSlice, dotSlice, fallbackSlice, installSlice].join(NL)

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && fileURLToPath(url) === playerLodPath) return { format: 'module', source: substituted, shortCircuit: true }
    return nextLoad(url, context)
  },
})
const spoint = await import(playerLodPath)

const clone = (v) => JSON.parse(JSON.stringify(v))
const shape = (r) => ({ order: [...r.order], full: [...r.full], reduced: [...r.reduced], dot: [...r.dot], tierById: [...r.tierById.entries()] })
const makeScene = () => ({ children: [], add(o) { this.children.push(o) }, remove(o) { this.children = this.children.filter((c) => c !== o) } })
const origin = { x: 0, y: 0, z: 0 }
const viewerAt = (y) => ({ x: 0, y, z: 0 })
const player = (id, x, y = 0, z = 0) => ({ id, x, y, z })
const groundFn = (spec) => (spec === null ? null : (x, z) => spec.a + spec.b * x + spec.c * z)
const crowdDots = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'crowd-dots.json'), 'utf8')).crowd.dots
const sloped = { a: 0.5, b: 0.01, c: -0.02 }
const mixed = [player(1, 200), player(2, 5), player(3, 150), player(4, 8)]

const runTick = (inst, step, ground) => {
  if (step.override !== undefined) inst.setFullCountOverride(step.override)
  inst.tick(clone(step.entries), step.viewer, step.serverDots, groundFn(ground))
  const instances = clone(inst.dots.instancedMesh.instances)
  return { tiers: shape(inst.getTiers()), count: inst.dots.count, instances }
}

const scenarios = []
const add = (label, ground, steps) => {
  const inst = spoint.installPlayerLOD(makeScene(), {})
  scenarios.push({ label, ground, steps: steps.map((step) => ({ ...step, expect: runTick(inst, step, ground) })) })
}

add('server bucket dots with no ground use the viewer height', null, [{ entries: [], viewer: viewerAt(2), serverDots: crowdDots }])
add('server bucket dots over a sloped ground', sloped, [{ entries: [], viewer: viewerAt(2), serverDots: crowdDots }])
add('the fallback draws flat dots from the remote entries in remote order', null, [{ override: 0, entries: mixed, viewer: origin, serverDots: null }])
add('the fallback over a sloped ground', sloped, [{ override: 0, entries: mixed, viewer: origin, serverDots: [] }])
add('a bucket of 49 players and one of 400 are both capped at three dot sizes', null, [{ entries: [], viewer: viewerAt(0), serverDots: [[3, 4, 49], [0, 0, 1], [-2, -2, 400]] }])
add('growing past the 512 starting capacity keeps every instance', null, [{ override: 0, entries: Array.from({ length: 600 }, (_, i) => player(5000 + i, 200 + i * 0.5)), viewer: origin, serverDots: null }])
add('an empty tick after dots clears the instances', null, [{ entries: [], viewer: viewerAt(2), serverDots: crowdDots }, { entries: [], viewer: viewerAt(2), serverDots: null }])

let seed = 20260110
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const signed = (span) => (rand() * 2 - 1) * span
for (let s = 0; s < 20; s++) {
  const ground = rand() < 0.5 ? null : { a: signed(2), b: signed(0.05), c: signed(0.05) }
  const count = 1 + Math.floor(rand() * 3)
  const steps = []
  for (let k = 0; k < count; k++) {
    const step = {}
    const roll = rand()
    if (roll < 0.3) step.override = null
    else if (roll < 0.6) step.override = Math.floor(rand() * 41)
    const n = Math.floor(rand() * 61)
    step.entries = Array.from({ length: n }, (_, i) => player(20000 + s * 1000 + k * 100 + i, signed(300), signed(20), signed(300)))
    step.viewer = { x: signed(60), y: signed(4), z: signed(60) }
    const sd = rand()
    step.serverDots = sd < 0.4 ? null : sd < 0.55 ? [] : Array.from({ length: 1 + Math.floor(rand() * 6) }, () => [Math.floor(signed(20)), Math.floor(signed(20)), 1 + Math.floor(rand() * 60)])
    steps.push(step)
  }
  add('random frame ' + s, ground, steps)
}

const probe = spoint.installPlayerLOD(makeScene(), {}).dots.instancedMesh
const setup = {
  frustumCulled: probe.frustumCulled,
  matrixAutoUpdate: probe.matrixAutoUpdate,
  renderOrder: probe.renderOrder,
  material: { color: probe.material.color.getHex(), opacity: probe.material.opacity, transparent: probe.material.transparent, depthWrite: probe.material.depthWrite },
}
const commit = execFileSync('git', ['-C', spointRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
const fixture = {
  spointCommit: commit,
  source: { file: 'client/core/PlayerLOD.js', sha256: createHash('sha256').update(source).digest('hex') },
  path: 'createCrowdDotRendererWebGL',
  setup,
  scenarios,
}
mkdirSync(outDir, { recursive: true })
const out = join(outDir, 'player-lod-renderer.json')
writeFileSync(out, JSON.stringify(fixture) + NL)
console.log('wrote ' + out + ' with ' + scenarios.length + ' scenarios')
