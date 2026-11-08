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

const sliceStart = source.indexOf('export const PLAYER_LOD_FULL_COUNT')
const byD2 = source.indexOf('function _byD2(a, b)')
if (sliceStart < 0 || byD2 < 0) throw new Error('spoint client/core/PlayerLOD.js no longer carries the client tier split in the expected shape')
const slice = source.slice(sliceStart, source.indexOf(NL, byD2) + 1)

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && fileURLToPath(url) === playerLodPath) return { format: 'module', source: slice, shortCircuit: true }
    return nextLoad(url, context)
  },
})
const spoint = await import(playerLodPath)

const shape = (r) => ({ order: [...r.order], full: [...r.full], reduced: [...r.reduced], dot: [...r.dot], tierById: [...r.tierById.entries()] })
const clone = (v) => JSON.parse(JSON.stringify(v))
const origin = { x: 0, y: 0, z: 0 }
const at = (id, x, y = 0, z = 0) => ({ id, x, y, z })
const scenarios = []
const record = (label, entries, viewer, fullCount, reducedD2) => {
  const expect = shape(spoint.classifyPlayerTiers(clone(entries), viewer, fullCount, reducedD2))
  scenarios.push({ label, entries: clone(entries), viewer: clone(viewer), fullCount: fullCount ?? null, reducedD2: reducedD2 ?? null, expect })
}

record('empty scene', [], origin)
record('one player at the viewer', [at(7, 0, 0, 0)], origin)
record('boundary: 120 m and 119.5 m with no full slots', [at(1, 120), at(2, 119.5), at(3, 0)], origin, 0)
record('boundary: 120 m straight up is a dot', [at(4, 0, 120)], origin)
record('ties keep the spoint order', [at(5, 3, 4), at(6, 4, 3), at(8, 0, 0, 5)], origin, 1)
record('nearest players are full even beyond 120 m', [at(9, 200), at(10, 150), at(11, 300)], origin, 2)
record('fullCount larger than the scene', [at(12, 3), at(13, 40), at(14, 150)], origin, 50)
const ladder = Array.from({ length: 31 }, (_, i) => at(100 + i, 10 + i * 4))
record('31 players in a ladder, default counts', ladder, origin)
record('31 players in a ladder, reducedD2 zero', ladder, origin, undefined, 0)
record('viewer off origin', [at(20, 5, 0, 5), at(21, 130, 0, 0)], { x: 10, y: 1, z: -3 }, 1)

let seed = 20260108
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const signed = (span) => (rand() * 2 - 1) * span
for (let s = 0; s < 40; s++) {
  const n = Math.floor(rand() * 76)
  const entries = Array.from({ length: n }, (_, i) => at(1000 + s * 100 + i, signed(300), signed(20), signed(300)))
  const viewer = { x: signed(80), y: signed(5), z: signed(80) }
  record('random scene ' + s + ' with ' + n + ' players', entries, viewer, s % 2 === 0 ? undefined : Math.floor(rand() * 41), s % 3 === 0 ? undefined : rand() * 20000)
}

const commit = execFileSync('git', ['-C', spointRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
const fixture = {
  spointCommit: commit,
  source: { file: 'client/core/PlayerLOD.js', sha256: createHash('sha256').update(source).digest('hex') },
  constants: { fullCount: spoint.PLAYER_LOD_FULL_COUNT, reducedD: spoint.PLAYER_LOD_REDUCED_D, reducedD2: spoint.PLAYER_LOD_REDUCED_D2, TIER_FULL: spoint.TIER_FULL, TIER_REDUCED: spoint.TIER_REDUCED, TIER_DOT: spoint.TIER_DOT },
  scenarios,
}
mkdirSync(outDir, { recursive: true })
const out = join(outDir, 'client-tiers.json')
writeFileSync(out, JSON.stringify(fixture, null, 1) + NL)
console.log('wrote ' + out + ' with ' + scenarios.length + ' scenarios')
