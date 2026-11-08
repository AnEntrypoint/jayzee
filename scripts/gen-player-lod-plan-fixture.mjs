import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const NL = String.fromCharCode(10)
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')
const playerLodPath = join(spointRoot, 'client/core/PlayerLOD.js')
const source = readFileSync(playerLodPath, 'utf8')

const tierStart = source.indexOf('export const PLAYER_LOD_FULL_COUNT')
const byD2 = source.indexOf('function _byD2(a, b)')
const fallbackStart = source.indexOf('const _dotFallbackScratch = []')
const installStart = source.indexOf('export function installPlayerLOD')
const installClose = installStart < 0 ? -1 : source.indexOf(NL + '}' + NL, installStart)
if (tierStart < 0 || byD2 < 0 || fallbackStart < 0 || installStart < 0 || installClose < 0) throw new Error('spoint client/core/PlayerLOD.js no longer carries installPlayerLOD in the expected shape')
const slice = [
  'const createCrowdDotRenderer = (scene, opts) => globalThis.__spointDotRenderer',
  source.slice(tierStart, source.indexOf(NL, byD2) + 1),
  source.slice(fallbackStart, source.indexOf(NL, fallbackStart) + 1),
  source.slice(installStart, installClose + 3),
].join(NL)

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && fileURLToPath(url) === playerLodPath) return { format: 'module', source: slice, shortCircuit: true }
    return nextLoad(url, context)
  },
})
const spoint = await import(playerLodPath)

const updates = []
globalThis.__spointDotRenderer = { update: (dots) => { updates.push(dots) }, dispose() {} }

const clone = (v) => JSON.parse(JSON.stringify(v))
const shape = (r) => ({ order: [...r.order], full: [...r.full], reduced: [...r.reduced], dot: [...r.dot], tierById: [...r.tierById.entries()] })
const origin = { x: 0, y: 0, z: 0 }
const at = (id, x, y = 0, z = 0) => ({ id, x, y, z })
const ladder = (n) => Array.from({ length: n }, (_, i) => at(100 + i, 10 + i * 3))

const runStep = (inst, step) => {
  if (step.override !== undefined) inst.setFullCountOverride(step.override)
  updates.length = 0
  inst.tick(clone(step.entries), step.viewer, step.serverDots, () => 0)
  const arg = updates[updates.length - 1]
  const mode = arg === null ? 'none' : arg === step.serverDots ? 'server' : 'fallback'
  const list = mode === 'none' ? null : mode === 'server' ? clone(arg) : arg.map(({ id, x, y, z }) => ({ id, x, y, z }))
  return { tiers: shape(inst.getTiers()), dot: { mode, list } }
}

const scenarios = []
const add = (label, steps) => {
  const inst = spoint.installPlayerLOD({})
  scenarios.push({ label, steps: steps.map((step) => ({ ...step, expect: runStep(inst, step) })) })
}

const mixed = [at(1, 200), at(2, 5), at(3, 150), at(4, 8)]
add('no server dots and no dot-tier player gives no dots', [{ entries: ladder(20), viewer: origin, serverDots: null }])
add('empty scene and no server dots gives none', [{ entries: [], viewer: origin, serverDots: null }])
add('no server dots: dot-tier players fall back in remote order', [{ override: 0, entries: mixed, viewer: origin, serverDots: null }])
add('empty server dots fall back to the dot-tier players', [{ override: 0, entries: mixed, viewer: origin, serverDots: [] }])
add('server dots replace the fallback even with dot-tier players', [{ override: 0, entries: mixed, viewer: origin, serverDots: [[1, -2, 2], [0, 0, 1]] }])
add('the override persists until set again or cleared', [
  { override: 3, entries: ladder(5), viewer: origin, serverDots: null },
  { entries: ladder(5), viewer: origin, serverDots: null },
  { override: null, entries: ladder(5), viewer: origin, serverDots: null },
])
add('an override larger than the scene makes everyone full', [{ override: 50, entries: [at(5, 200), at(6, 150), at(7, 300)], viewer: origin, serverDots: null }])
add('an override of zero leaves nobody full', [{ override: 0, entries: ladder(6), viewer: origin, serverDots: null }])
add('a scene of 35 players, default count: 30 full and the rest reduced', [{ entries: ladder(35), viewer: origin, serverDots: null }])

let seed = 20260109
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const signed = (span) => (rand() * 2 - 1) * span
for (let s = 0; s < 30; s++) {
  const count = 2 + Math.floor(rand() * 3)
  const steps = []
  for (let k = 0; k < count; k++) {
    const step = {}
    const roll = rand()
    if (roll < 0.3) step.override = null
    else if (roll < 0.6) step.override = Math.floor(rand() * 41)
    const n = Math.floor(rand() * 61)
    step.entries = Array.from({ length: n }, (_, i) => at(10000 + s * 1000 + k * 100 + i, signed(300), signed(20), signed(300)))
    step.viewer = { x: signed(60), y: signed(4), z: signed(60) }
    const sd = rand()
    step.serverDots = sd < 0.4 ? null : sd < 0.6 ? [] : Array.from({ length: 1 + Math.floor(rand() * 4) }, () => [Math.floor(signed(20)), Math.floor(signed(20)), 1 + Math.floor(rand() * 5)])
    steps.push(step)
  }
  add('random plan ' + s + ' over ' + count + ' ticks', steps)
}

const commit = execFileSync('git', ['-C', spointRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
const fixture = {
  spointCommit: commit,
  source: { file: 'client/core/PlayerLOD.js', sha256: createHash('sha256').update(source).digest('hex') },
  scenarios,
}
mkdirSync(outDir, { recursive: true })
const out = join(outDir, 'player-lod-plan.json')
writeFileSync(out, JSON.stringify(fixture, null, 1) + NL)
console.log('wrote ' + out + ' with ' + scenarios.length + ' scenarios')
