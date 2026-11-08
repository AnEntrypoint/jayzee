import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/client-tiers.json', import.meta.url), 'utf8'))
const lib = await import('../src/client-pure/playerTierSplit.js').catch((error) => ({ loadError: error.message }))
const classify = (...args) => {
  if (!lib.classifyPlayerTiers) throw new Error('src/client-pure/playerTierSplit.js does not export classifyPlayerTiers: ' + (lib.loadError ?? 'no export'))
  return lib.classifyPlayerTiers(...args)
}
const clone = (v) => JSON.parse(JSON.stringify(v))
const shape = (r) => ({ order: [...r.order], full: [...r.full], reduced: [...r.reduced], dot: [...r.dot], tierById: [...r.tierById.entries()] })
const origin = { x: 0, y: 0, z: 0 }
const at = (id, x, y = 0, z = 0) => ({ id, x, y, z })

gate('the fixture was generated from spoint client/core/PlayerLOD.js with a 64-hex source digest', () => {
  assert.equal(fixture.source.file, 'client/core/PlayerLOD.js')
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/)
  assert.match(fixture.spointCommit, /^[0-9a-f]{7,}$/)
})

gate('the tier constants equal spoint: 30 nearest full, 120 m reduced, tiers 0, 1 and 2', () => {
  assert.deepEqual(fixture.constants, { fullCount: 30, reducedD: 120, reducedD2: 14400, TIER_FULL: 0, TIER_REDUCED: 1, TIER_DOT: 2 })
  assert.equal(lib.PLAYER_LOD_FULL_COUNT, 30)
  assert.equal(lib.PLAYER_LOD_REDUCED_D2, 14400)
  assert.deepEqual([lib.TIER_FULL, lib.TIER_REDUCED, lib.TIER_DOT], [0, 1, 2])
})

gate('the fixture covers the empty scene, the boundaries, ties, explicit counts and forty random scenes', () => {
  const labels = fixture.scenarios.map((s) => s.label)
  assert.equal(fixture.scenarios.length, 50)
  for (const label of ['empty scene', 'boundary: 120 m and 119.5 m with no full slots', 'ties keep the spoint order', 'viewer off origin']) assert.ok(labels.includes(label), label)
  assert.equal(labels.filter((l) => l.startsWith('random scene')).length, 40)
  assert.ok(fixture.scenarios.some((s) => s.entries.length > 30), 'a scene past the 30 full slots')
})

gate('every scenario equals spoint: order, full, reduced, dot and tierById', () => {
  for (const s of fixture.scenarios) {
    assert.deepEqual(shape(classify(clone(s.entries), s.viewer, s.fullCount ?? undefined, s.reducedD2 ?? undefined)), s.expect, s.label)
  }
})

gate('a player at exactly 120 m is a dot and one at 119.5 m is reduced', () => {
  const r = classify([at(1, 120), at(2, 119.5)], origin, 0)
  assert.deepEqual([...r.dot], [1])
  assert.deepEqual([...r.reduced], [2])
})

gate('a player 120 m straight up is a dot, because the split uses 3D distance', () => {
  assert.deepEqual([...classify([at(4, 0, 120)], origin, 0).dot], [4])
})

gate('the nearest fullCount players are full even beyond 120 m', () => {
  const r = classify([at(9, 200), at(10, 150), at(11, 300)], origin, 2)
  assert.deepEqual([...r.full], [10, 9])
  assert.deepEqual([...r.dot], [11])
})

gate('results do not alias: a later call leaves an earlier result unchanged', () => {
  const first = classify([at(1, 5)], origin, 1)
  const before = shape(first)
  classify([at(2, 500)], origin, 0)
  assert.deepEqual(shape(first), before)
})

gate('classification does not write to the entries', () => {
  const entries = [at(1, 5), at(2, 50)]
  const before = clone(entries)
  classify(entries, origin, 1)
  assert.deepEqual(entries, before)
})

gate('an empty scene gives empty tiers', () => {
  assert.deepEqual(shape(classify([], origin)), { order: [], full: [], reduced: [], dot: [], tierById: [] })
})

gate('refuses a NaN or missing position, a null entry, a non-array scene, a bad viewer and a bad count', () => {
  assert.throws(() => classify([at(1, NaN)], origin), RangeError)
  assert.throws(() => classify([{ id: 2, x: 1, z: 1 }], origin), RangeError)
  assert.throws(() => classify([null], origin), RangeError)
  assert.throws(() => classify({ length: 0 }, origin), TypeError)
  assert.throws(() => classify([], undefined), RangeError)
  assert.throws(() => classify([], { x: 0, y: NaN, z: 0 }), RangeError)
  assert.throws(() => classify([], origin, -1), RangeError)
  assert.throws(() => classify([], origin, 1.5), RangeError)
  assert.throws(() => classify([], origin, Infinity), RangeError)
  assert.throws(() => classify([], origin, 30, NaN), RangeError)
})

finish()
